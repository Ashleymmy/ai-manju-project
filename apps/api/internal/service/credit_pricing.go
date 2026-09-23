package service

import (
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Default credit prices — from the document's confirmed pricing page
// (image18 平台定价规则). Every value is overridable at runtime through
// billing_configs["pricing_rules"]; these constants are only fallbacks.
// 未定稿的模型级单价（image4/image5 后台大表）不进入默认值，待 WP-M13 人工核对后入库。
const (
	// PriceImageSmall512: 普通漫剧图 512×512，每张 20 积分。
	PriceImageSmall512 int64 = 20
	// PriceImageStandard1024: 高清漫剧图 1024×1024，每张 50 积分。
	PriceImageStandard1024 int64 = 50
	// PriceImageLarge: 角色多视角图及更大规格，每张 80 积分。
	PriceImageLarge int64 = 80
	// PriceVideoFastPerSecond: 漫剧 Fast 快速渲染，每秒 8 积分。
	PriceVideoFastPerSecond int64 = 8
	// PriceVideoStandardPerSecond: 漫剧标准版，每秒 12 积分。
	PriceVideoStandardPerSecond int64 = 12
	// PriceAgentSkillPerCall: Agent 技能调用（分镜节点树），每次 30 积分。
	PriceAgentSkillPerCall int64 = 30
	// PriceVideoDefaultSeconds matches the AI handler's default duration.
	PriceVideoDefaultSeconds int64 = 5
)

// pricingRules mirrors billing_configs["pricing_rules"]. Nil/absent fields fall
// back to the constants above.
type pricingRules struct {
	Image struct {
		Small512     int64 `json:"small_512"`
		Standard1024 int64 `json:"standard_1024"`
		Large        int64 `json:"large"`
	} `json:"image"`
	VideoFast struct {
		PerSecond int64 `json:"per_second"`
	} `json:"video_fast"`
	VideoStandard struct {
		PerSecond int64 `json:"per_second"`
	} `json:"video_standard"`
	AgentSkill struct {
		PerCall int64 `json:"per_call"`
	} `json:"agent_skill"`
}

// activityDiscount mirrors billing_configs["activity_discount"]
// (后台模块5：限时折扣开关，活动期间对应模型消耗按比例打折).
type activityDiscount struct {
	Enabled     bool     `json:"enabled"`
	StartsAt    string   `json:"starts_at"` // RFC3339
	EndsAt      string   `json:"ends_at"`
	DiscountBps int      `json:"discount_bps"` // 5000 = 五折
	AppliesTo   []string `json:"applies_to"`   // "image" / "video_fast" / "video_standard" / "agent_skill"
}

// CreditPricer turns a job's type + payload into a credit quote. It reads
// billing_configs on every call so admin price edits take effect without a
// restart; config rows are small and the read path is a single indexed lookup.
type CreditPricer struct {
	billing repository.BillingRepository
	clock   func() time.Time
}

func NewCreditPricer(billing repository.BillingRepository) *CreditPricer {
	return &CreditPricer{billing: billing, clock: func() time.Time { return time.Now().UTC() }}
}

// SetClock overrides the time source (tests).
func (p *CreditPricer) SetClock(clock func() time.Time) {
	if clock != nil {
		p.clock = clock
	}
}

// ChargeableJobType reports whether the job type consumes credits. 文本、转码、
// 导出等不在文档计费范围内，永久免费。
func ChargeableJobType(jobType string) bool {
	switch jobType {
	case model.JobTypeImageGenerate, model.JobTypeImageEdit, model.JobTypeVideoGenerate:
		return true
	default:
		return false
	}
}

// QuoteForJob prices one job. chargeable=false means free (0 credits, no
// reservation needed). The returned params snapshot feeds 后台模块4 的参数信息列.
func (p *CreditPricer) QuoteForJob(jobType string, payload model.JSONB) (credits int64, taskType string, params map[string]any, chargeable bool) {
	if !ChargeableJobType(jobType) {
		return 0, "", nil, false
	}
	body := map[string]any{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &body)
	}
	rules := p.loadRules()

	pricingModel := p.creditModelName(jsonString(body["model"]))
	params = map[string]any{"pricing_model": pricingModel}
	switch jobType {
	case model.JobTypeImageGenerate, model.JobTypeImageEdit:
		count := jsonInt64(body["n"], 1)
		if count < 1 {
			count = 1
		}
		size := strings.ToLower(strings.TrimSpace(jsonString(body["size"])))
		perImage := imagePriceForSize(rules, size)
		credits = perImage * count
		taskType = model.TaskTypeImage
		params["resolution"] = size
		params["count"] = count
	case model.JobTypeVideoGenerate:
		duration := videoCreditDuration(body)
		if duration < 1 {
			duration = PriceVideoDefaultSeconds
		}
		tier := model.TaskTypeVideoStandard
		perSecond := rules.VideoStandard.PerSecond
		if isFastVideoPayload(body) || strings.Contains(pricingModel, "fast") {
			tier = model.TaskTypeVideoFast
			perSecond = rules.VideoFast.PerSecond
		}
		credits = perSecond * duration
		taskType = tier
		params["duration_sec"] = duration
		params["resolution"] = strings.ToUpper(videoCreditResolution(body))
	}

	total, priced := p.modelPrice(jobType, body, params)
	// Automatic image parameters retain their existing base rate, but each
	// output now also pays for each reference image (masks already excluded).
	// Keep this separate from unmatched explicit models and video auto duration.
	if !priced && (jobType == model.JobTypeImageGenerate || jobType == model.JobTypeImageEdit) && automaticImageCreditSpec(body) {
		count := params["count"].(int64)
		refs := params["reference_count"].(int)
		referencePrice := params["reference_per_image"].(float64)
		params["pricing_source"] = "image_auto_fallback"
		params["base_per_image"] = float64(credits) / float64(count)
		total = float64(credits) + float64(refs)*referencePrice*float64(count)
		delete(params, "range_min")
		delete(params, "range_max")
		priced = true
	}
	if priced {
		// Keep fractional prices through the activity discount, then round once.
		const creditPrecision int64 = 10000
		scaled := p.applyActivityDiscount(int64(math.Round(total*float64(creditPrecision))), taskType, params)
		return roundCreditTotal(float64(scaled) / float64(creditPrecision)), taskType, params, true
	}
	if credits > 0 {
		credits = p.applyActivityDiscount(credits, taskType, params)
	}
	return credits, taskType, params, true
}

func automaticImageCreditSpec(body map[string]any) bool {
	for _, field := range []string{"size", "quality"} {
		value := strings.ToLower(strings.TrimSpace(jsonString(body[field])))
		if value == "" || value == "auto" {
			return true
		}
	}
	return false
}

// imagePriceForSize buckets by resolution text. 未识别规格按 1024 档计价
// （保守中间价，运营可在 pricing_rules 中细化）。
func imagePriceForSize(rules pricingRules, size string) int64 {
	switch {
	case strings.Contains(size, "512"):
		return rules.Image.Small512
	case strings.Contains(size, "2048"), strings.Contains(size, "4096"),
		strings.Contains(size, "2k"), strings.Contains(size, "4k"):
		return rules.Image.Large
	default:
		return rules.Image.Standard1024
	}
}

// isFastVideoPayload treats an explicit service_tier=fast or a model name
// containing "fast" as 视频 Fast 渲染。
func isFastVideoPayload(body map[string]any) bool {
	tier := strings.ToLower(strings.TrimSpace(jsonString(body["service_tier"])))
	if tier == "fast" {
		return true
	}
	return strings.Contains(strings.ToLower(jsonString(body["model"])), "fast")
}

// applyActivityDiscount scales the quote when a limited-time discount is
// active for this task type (例如视频 Fast 五折活动).
func (p *CreditPricer) applyActivityDiscount(credits int64, taskType string, params map[string]any) int64 {
	if credits <= 0 {
		return credits
	}
	config, err := p.billing.GetConfig(model.BillingConfigKeyActivity)
	if err != nil {
		return credits
	}
	var activity activityDiscount
	if err := json.Unmarshal(config.Value, &activity); err != nil || !activity.Enabled {
		return credits
	}
	if activity.DiscountBps <= 0 || activity.DiscountBps >= 10000 {
		return credits
	}
	now := p.clock()
	if start, err := time.Parse(time.RFC3339, activity.StartsAt); err == nil && now.Before(start) {
		return credits
	}
	if end, err := time.Parse(time.RFC3339, activity.EndsAt); err == nil && now.After(end) {
		return credits
	}
	if len(activity.AppliesTo) > 0 {
		matched := false
		for _, target := range activity.AppliesTo {
			if target == taskType {
				matched = true
				break
			}
		}
		if !matched {
			return credits
		}
	}
	discounted := credits * int64(activity.DiscountBps) / 10000
	if discounted < 1 {
		discounted = 1
	}
	params["activity_discount_bps"] = activity.DiscountBps
	return discounted
}

func (p *CreditPricer) loadRules() pricingRules {
	rules := pricingRules{}
	rules.Image.Small512 = PriceImageSmall512
	rules.Image.Standard1024 = PriceImageStandard1024
	rules.Image.Large = PriceImageLarge
	rules.VideoFast.PerSecond = PriceVideoFastPerSecond
	rules.VideoStandard.PerSecond = PriceVideoStandardPerSecond
	rules.AgentSkill.PerCall = PriceAgentSkillPerCall

	config, err := p.billing.GetConfig(model.BillingConfigKeyPricingRules)
	if err != nil {
		return rules
	}
	var override pricingRules
	if err := json.Unmarshal(config.Value, &override); err != nil {
		return rules
	}
	if override.Image.Small512 > 0 {
		rules.Image.Small512 = override.Image.Small512
	}
	if override.Image.Standard1024 > 0 {
		rules.Image.Standard1024 = override.Image.Standard1024
	}
	if override.Image.Large > 0 {
		rules.Image.Large = override.Image.Large
	}
	if override.VideoFast.PerSecond > 0 {
		rules.VideoFast.PerSecond = override.VideoFast.PerSecond
	}
	if override.VideoStandard.PerSecond > 0 {
		rules.VideoStandard.PerSecond = override.VideoStandard.PerSecond
	}
	if override.AgentSkill.PerCall > 0 {
		rules.AgentSkill.PerCall = override.AgentSkill.PerCall
	}
	return rules
}

func jsonString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func jsonInt64(value any, fallback int64) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	}
	return fallback
}
