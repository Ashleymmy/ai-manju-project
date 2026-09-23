package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// MaxModelCreditPrice caps each editable unit price; prices support two decimals.
const MaxModelCreditPrice = 1_000_000

// ParseModelCreditPrices validates a complete catalog. Model/spec identities are
// fixed so a typo or missing row cannot silently switch a task to legacy pricing.
func ParseModelCreditPrices(raw []byte) (ModelCreditPrices, error) {
	return parseModelCreditPrices(raw, DefaultModelCreditPrices())
}

func parseModelCreditPrices(raw []byte, defaults ModelCreditPrices) (ModelCreditPrices, error) {
	var prices ModelCreditPrices
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&prices); err != nil {
		return prices, fmt.Errorf("invalid model prices: %w", err)
	}
	// JSON null must not turn into an accidental zero price.
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		return prices, err
	}
	var hasNull func(any) bool
	hasNull = func(v any) bool {
		switch x := v.(type) {
		case nil:
			return true
		case map[string]any:
			for _, child := range x {
				if hasNull(child) {
					return true
				}
			}
		case []any:
			for _, child := range x {
				if hasNull(child) {
					return true
				}
			}
		}
		return false
	}
	fields, ok := document.(map[string]any)
	if !ok || len(fields) != 4 || hasNull(document) {
		return prices, fmt.Errorf("complete images, videos, qualities and image_reference are required; null is not a price")
	}
	validPrice := func(value float64) bool {
		return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= MaxModelCreditPrice && math.Abs(value*100-math.Round(value*100)) < 0.000001
	}
	// Catalogs saved before H3 480p was added remain valid. Backfill only this
	// new row; never replace administrators' existing prices with defaults.
	if h3 := prices.Videos["minimax-h3"]; h3 != nil {
		if _, exists := h3["480p"]; !exists {
			h3["480p"] = defaults.Videos["minimax-h3"]["480p"]
		}
	}
	// These additions are initialized from fallback rates on older catalogs.
	// Only absent additions are backfilled; saved zeroes and edits remain intact.
	if prices.Images != nil {
		for _, name := range []string{"gemini-3-pro-image", "gemini-3.1-flash-image"} {
			if _, exists := prices.Images[name]; !exists {
				prices.Images[name] = defaults.Images[name]
			}
		}
	}
	for _, name := range []string{"wan-3.0", "wan-3.0-prime"} {
		if resolutions := prices.Videos[name]; resolutions != nil {
			if _, exists := resolutions["1080p"]; !exists {
				resolutions["1080p"] = defaults.Videos[name]["1080p"]
			}
		}
	}
	if !slices.Equal(prices.Qualities, defaults.Qualities) || !validPrice(prices.ImageReference) {
		return prices, fmt.Errorf("qualities must keep their original order; prices must be 0–%d with at most two decimals", MaxModelCreditPrice)
	}
	for group, expected := range map[string]map[string]map[string][]float64{"images": defaults.Images, "videos": defaults.Videos} {
		actual := prices.Images
		if group == "videos" {
			actual = prices.Videos
		}
		if len(actual) != len(expected) {
			return prices, fmt.Errorf("%s must contain all supported models", group)
		}
		for name, resolutions := range expected {
			if len(actual[name]) != len(resolutions) {
				return prices, fmt.Errorf("%s: unsupported or missing resolutions", name)
			}
			for resolution, variants := range resolutions {
				values := actual[name][resolution]
				if len(values) != len(variants) {
					return prices, fmt.Errorf("%s/%s: incorrect price columns", name, resolution)
				}
				for _, value := range values {
					if !validPrice(value) {
						return prices, fmt.Errorf("%s/%s: prices must be 0–%d with at most two decimals", name, resolution, MaxModelCreditPrice)
					}
				}
				// Only models with a video-reference surcharge support this column.
				if group == "videos" && !supportsVideoCreditSurcharge(name) && values[2] != 0 {
					return prices, fmt.Errorf("%s does not support video-reference surcharges", name)
				}
			}
		}
	}
	return prices, nil
}

// Surcharge support belongs to a model, not to its current default price: a
// newly added row may start at zero and must remain editable by administrators.
func supportsVideoCreditSurcharge(name string) bool {
	switch name {
	case "minimax-h3", "seedance-2.5", "wan-3.0", "wan-3.0-prime":
		return true
	}
	return false
}

// LoadModelCreditPrices is shared by quotes, reservation and member/admin views.
// Both storage drivers use BillingRepository; saving needs no schema migration.
func LoadModelCreditPrices(billing repository.BillingRepository) ModelCreditPrices {
	defaults := DefaultModelCreditPrices()
	rules := NewCreditPricer(billing).loadRules()
	for _, name := range []string{"gemini-3-pro-image", "gemini-3.1-flash-image"} {
		for resolution := range defaults.Images[name] {
			defaults.Images[name][resolution][0] = float64(imagePriceForSize(rules, resolution))
		}
	}
	for _, name := range []string{"wan-3.0", "wan-3.0-prime"} {
		defaults.Videos[name]["1080p"] = []float64{float64(rules.VideoStandard.PerSecond), float64(rules.VideoStandard.PerSecond), 0}
	}
	if config, err := billing.GetConfig(model.BillingConfigKeyModelPrices); err == nil {
		if prices, err := parseModelCreditPrices(config.Value, defaults); err == nil {
			return prices
		}
	}
	return defaults
}
