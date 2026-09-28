package service

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// AutomaticVideoBillingMode identifies durable reservations awaiting trusted
	// output metrics. Workers may repair metrics without repeating generation.
	AutomaticVideoBillingMode         = "actual_video_duration"
	videoBillingSnapshotVersion       = 1
	videoCreditRatePrecision    int64 = 10000
	videoCreditDiscountScale    int64 = 10000
	// Muxed stream tails can slightly exceed the nominal generated duration.
	// Accept at most 100 ms and bill no more than the supported maximum.
	videoMetricDurationToleranceSeconds = 0.1
)

var (
	ErrAutomaticVideoPolicyUnavailable = errors.New("自动时长暂时无法确认模型计费上限，请选择固定时长和分辨率")
	ErrVideoBillingMetricsPending      = errors.New("video billing awaits trusted output metrics")
)

// VideoBillingPolicy is supplied by authenticated server-side model resolution,
// never decoded from request payload. Durations and resolutions must describe
// the selected provider/model, including live SD-video capabilities.
type VideoBillingPolicy struct {
	MaxDurationSeconds int64
	Resolutions        []string
}

type videoRateSnapshot struct {
	BasePerSecond      float64 `json:"base_per_second"`
	ReferencePerSecond float64 `json:"reference_per_second"`
	PerSecondScaled    int64   `json:"per_second_scaled"`
}

type automaticVideoPriceSnapshot struct {
	Version             int    `json:"version"`
	MaxDurationSeconds  int64  `json:"max_duration_seconds"`
	RequestedResolution string `json:"requested_resolution"`
	// SettlementResolution is the server-selected tier used when the request
	// leaves resolution automatic or omitted. It is frozen with the quote so a
	// non-standard output geometry cannot leave credits reserved forever or
	// make settlement guess a supplier tier after the fact.
	SettlementResolution string                       `json:"settlement_resolution"`
	Rates                map[string]videoRateSnapshot `json:"rates"`
	DiscountBps          int64                        `json:"discount_bps"`
}

func IsAutomaticVideoDuration(payload model.JSONB) bool {
	var body map[string]any
	return json.Unmarshal(payload, &body) == nil && videoCreditDuration(body) <= 0
}

// QuoteForJobWithVideoPolicy preserves all explicit-duration/image pricing.
// Automatic video duration reserves the maximum at frozen submission prices;
// automatic resolution reserves the highest supported rate in the same snapshot.
func (p *CreditPricer) QuoteForJobWithVideoPolicy(jobType string, payload model.JSONB, policy *VideoBillingPolicy) (int64, string, map[string]any, bool, error) {
	if jobType != model.JobTypeVideoGenerate || !IsAutomaticVideoDuration(payload) {
		credits, taskType, params, chargeable := p.QuoteForJob(jobType, payload)
		return credits, taskType, params, chargeable, nil
	}
	if policy == nil || policy.MaxDurationSeconds <= 0 || len(policy.Resolutions) == 0 {
		return 0, "", nil, true, ErrAutomaticVideoPolicyUnavailable
	}
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil || body == nil {
		return 0, "", nil, true, ErrAutomaticVideoPolicyUnavailable
	}
	pricingModel := p.creditModelName(jsonString(body["model"]))
	taskType := model.TaskTypeVideoStandard
	rules := p.loadRules()
	fallback := rules.VideoStandard.PerSecond
	if isFastVideoPayload(body) || strings.Contains(pricingModel, "fast") {
		taskType, fallback = model.TaskTypeVideoFast, rules.VideoFast.PerSecond
	}
	resolution := strings.ToLower(videoCreditResolution(body))
	if resolution == "auto" {
		resolution = ""
	}
	snapshot := automaticVideoPriceSnapshot{Version: videoBillingSnapshotVersion, MaxDurationSeconds: policy.MaxDurationSeconds, RequestedResolution: resolution, Rates: map[string]videoRateSnapshot{}, DiscountBps: videoCreditDiscountScale}
	params := map[string]any{"pricing_model": pricingModel, "billing_mode": AutomaticVideoBillingMode, "settlement_basis": "output_duration", "reserve_duration_sec": policy.MaxDurationSeconds, "duration_sec": policy.MaxDurationSeconds, "has_video_reference": hasVideoCreditReference(body)}
	// Read the activity once and persist its ratio, not the mutable campaign.
	p.applyActivityDiscount(videoCreditDiscountScale, taskType, params)
	if discount, ok := params["activity_discount_bps"].(int); ok {
		snapshot.DiscountBps = int64(discount)
	}
	catalog := LoadModelCreditPrices(p.billing)
	var highest int64
	var reservedResolution string
	for _, supported := range policy.Resolutions {
		key := strings.ToLower(strings.TrimSpace(supported))
		if key == "" || key == "auto" || (resolution != "" && resolution != key) {
			continue
		}
		rate := videoRateSnapshot{BasePerSecond: float64(fallback), PerSecondScaled: fallback * videoCreditRatePrecision}
		prices := catalog.Videos[pricingModel][key]
		if len(prices) == 3 {
			index := 0
			if hasVideoCreditReference(body) {
				index, rate.ReferencePerSecond = 1, prices[2]
			}
			if pricingModel == "seedance-1.5-pro" {
				index = 0
				if audio, _ := body["generate_audio"].(bool); audio {
					index = 1
				}
			}
			rate.BasePerSecond = prices[index]
			rate.PerSecondScaled = int64(math.Round((rate.BasePerSecond + rate.ReferencePerSecond) * float64(videoCreditRatePrecision)))
		}
		if rate.PerSecondScaled < 0 {
			return 0, "", nil, true, ErrAutomaticVideoPolicyUnavailable
		}
		snapshot.Rates[key] = rate
		if reservedResolution == "" || rate.PerSecondScaled > highest {
			highest, reservedResolution = rate.PerSecondScaled, key
		}
	}
	if len(snapshot.Rates) == 0 {
		return 0, "", nil, true, ErrAutomaticVideoPolicyUnavailable
	}
	reserved := automaticVideoCredits(highest, float64(policy.MaxDurationSeconds), snapshot.DiscountBps)
	if reserved < 0 {
		return 0, "", nil, true, ErrAutomaticVideoPolicyUnavailable
	}
	if snapshot.RequestedResolution == "" {
		// Automatic output dimensions are not a pricing contract. Freeze the
		// highest supported tier used for the reservation and settle that same
		// tier, while still settling the measured duration. This avoids guessing
		// from square/ultrawide pixels and prevents a permanent credit hold.
		snapshot.SettlementResolution = reservedResolution
	}
	rate := snapshot.Rates[reservedResolution]
	params["pricing_source"], params["auto_video_pricing"] = "automatic_video_reservation", snapshot
	params["reserve_credits"], params["resolution"] = reserved, strings.ToUpper(reservedResolution)
	params["base_per_second"], params["reference_per_second"] = rate.BasePerSecond, rate.ReferencePerSecond
	params["per_second"] = float64(rate.PerSecondScaled) / float64(videoCreditRatePrecision)
	return reserved, taskType, params, true, nil
}

func automaticVideoCredits(rate int64, seconds float64, discount int64) int64 {
	if rate < 0 || discount < 0 || seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return -1
	}
	// ffprobe durations are decimal seconds. Recover that exact decimal before
	// multiplying; float products such as 70*1.1 can otherwise ceil to 78.
	duration, ok := new(big.Rat).SetString(strconv.FormatFloat(seconds, 'f', -1, 64))
	if !ok {
		return -1
	}
	amount := new(big.Rat).Mul(duration, big.NewRat(rate, videoCreditRatePrecision))
	amount.Mul(amount, big.NewRat(discount, videoCreditDiscountScale))
	whole, remainder := new(big.Int), new(big.Int)
	whole.QuoRem(amount.Num(), amount.Denom(), remainder)
	if remainder.Sign() > 0 {
		whole.Add(whole, big.NewInt(1))
	}
	if !whole.IsInt64() {
		return -1
	}
	return whole.Int64()
}

// SettleCompletedJob uses only a frozen price snapshot and Worker-owned ffprobe
// measurements. Missing/invalid metrics preserve the reservation for recovery.
func (s *CreditLedgerService) SettleCompletedJob(job model.Job) (repository.SettleOutcome, error) {
	if job.Status != model.JobStatusSucceeded {
		return repository.SettleOutcome{}, ErrVideoBillingMetricsPending
	}
	consumption, err := s.credits.GetConsumptionByJobID(job.ID)
	if err != nil {
		return repository.SettleOutcome{}, err
	}
	var params map[string]any
	if json.Unmarshal(consumption.Params, &params) != nil || params["billing_mode"] != AutomaticVideoBillingMode {
		return s.Settle(job.ID)
	}
	if consumption.Status != model.TaskConsumptionStatusReserved {
		return repository.SettleOutcome{Consumption: consumption}, nil
	}
	var result struct {
		Metrics struct {
			Version  int     `json:"version"`
			Source   string  `json:"source"`
			Duration float64 `json:"duration_seconds"`
			Width    int     `json:"width"`
			Height   int     `json:"height"`
		} `json:"video_metrics"`
	}
	var snapshot automaticVideoPriceSnapshot
	raw, _ := json.Marshal(params["auto_video_pricing"])
	if json.Unmarshal(raw, &snapshot) != nil || snapshot.Version != videoBillingSnapshotVersion || snapshot.MaxDurationSeconds <= 0 || snapshot.DiscountBps <= 0 || snapshot.DiscountBps > videoCreditDiscountScale {
		return repository.SettleOutcome{}, ErrVideoBillingMetricsPending
	}
	if json.Unmarshal(job.Result, &result) != nil || result.Metrics.Version != 1 || result.Metrics.Source != "ffprobe" || result.Metrics.Duration <= 0 || math.IsNaN(result.Metrics.Duration) || math.IsInf(result.Metrics.Duration, 0) || result.Metrics.Width <= 0 || result.Metrics.Height <= 0 || result.Metrics.Duration > float64(snapshot.MaxDurationSeconds)+videoMetricDurationToleranceSeconds {
		return repository.SettleOutcome{}, ErrVideoBillingMetricsPending
	}
	resolution := snapshot.RequestedResolution
	settlementBasis := "requested_resolution"
	if resolution == "" {
		resolution = snapshot.SettlementResolution
		settlementBasis = "reserved_automatic_tier"
	}
	rate, ok := snapshot.Rates[resolution]
	if !ok || rate.PerSecondScaled < 0 {
		return repository.SettleOutcome{}, ErrVideoBillingMetricsPending
	}
	billableDuration := math.Min(result.Metrics.Duration, float64(snapshot.MaxDurationSeconds))
	actual := automaticVideoCredits(rate.PerSecondScaled, billableDuration, snapshot.DiscountBps)
	if actual < 0 || actual > consumption.CreditsQuoted {
		return repository.SettleOutcome{}, ErrVideoBillingMetricsPending
	}
	params["actual_duration_sec"], params["duration_sec"] = result.Metrics.Duration, result.Metrics.Duration
	params["billable_duration_sec"] = billableDuration
	params["released_credits"] = consumption.CreditsQuoted - actual
	params["actual_width"], params["actual_height"] = result.Metrics.Width, result.Metrics.Height
	params["per_second"] = float64(rate.PerSecondScaled) / float64(videoCreditRatePrecision)
	params["settlement_resolution"] = resolution
	params["settlement_resolution_basis"] = settlementBasis
	params["base_per_second"], params["reference_per_second"] = rate.BasePerSecond, rate.ReferencePerSecond
	params["settlement_status"] = "settled"
	updatedParams, err := json.Marshal(params)
	if err != nil {
		return repository.SettleOutcome{}, err
	}
	return s.credits.SettleAmount(job.ID, actual, model.JSONB(updatedParams), s.now())
}
