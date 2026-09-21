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
	defaults := DefaultModelCreditPrices()
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
				// Only models with measured-reference billing support this column.
				if group == "videos" && variants[2] == 0 && values[2] != 0 {
					return prices, fmt.Errorf("%s does not support reference-duration surcharges", name)
				}
			}
		}
	}
	return prices, nil
}

// LoadModelCreditPrices is shared by quotes, reservation and member/admin views.
// Both storage drivers use BillingRepository; saving needs no schema migration.
func LoadModelCreditPrices(billing repository.BillingRepository) ModelCreditPrices {
	if config, err := billing.GetConfig(model.BillingConfigKeyModelPrices); err == nil {
		if prices, err := ParseModelCreditPrices(config.Value); err == nil {
			return prices
		}
	}
	return DefaultModelCreditPrices()
}
