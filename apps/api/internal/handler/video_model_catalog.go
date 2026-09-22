package handler

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// Official duration contracts, checked 2026-09-21. These apply to identifiable
// model IDs only, never user-editable labels or opaque ep-* endpoints.
// https://www.volcengine.com/docs/82379/1520757
// https://docs.byteplus.com/en/docs/ModelArk/1520757
var documentedVideoDurations = []struct {
	model  *regexp.Regexp
	values []float64
}{
	{regexp.MustCompile(`^(doubao-)?seedance-2-5($|-)`), integerVideoDurations(4, 30, true)},
	{regexp.MustCompile(`^(doubao-)?seedance-2-0($|-)`), integerVideoDurations(4, 15, true)},
	{regexp.MustCompile(`^(doubao-)?seedance-1-5-pro($|-)`), integerVideoDurations(4, 12, true)},
	{regexp.MustCompile(`^(doubao-)?seedance-1-0-pro($|-)`), integerVideoDurations(2, 12, false)},
}

func integerVideoDurations(min, max int, automatic bool) []float64 {
	values := make([]float64, 0, max-min+2)
	if automatic {
		values = append(values, -1)
	}
	for seconds := min; seconds <= max; seconds++ {
		values = append(values, float64(seconds))
	}
	return values
}

func catalogVideoDurations(modelID string) []float64 {
	name := strings.NewReplacer(".", "-", "_", "-").Replace(strings.ToLower(strings.TrimSpace(modelID)))
	for _, rule := range documentedVideoDurations {
		if rule.model.MatchString(name) {
			return append([]float64(nil), rule.values...)
		}
	}
	return nil
}

// SD-video's live model configuration is authoritative for its namespace.
// Discrete choices remain discrete; malformed metadata must not invent a range
// or break discovery of other models.
func remoteVideoDurations(raw json.RawMessage) []float64 {
	var values []float64
	if json.Unmarshal(raw, &values) != nil {
		return nil
	}
	seen := map[float64]bool{}
	valid := make([]float64, 0, len(values))
	for _, seconds := range values {
		if !math.IsNaN(seconds) && !math.IsInf(seconds, 0) && (seconds > 0 || seconds == -1) && !seen[seconds] {
			valid = append(valid, seconds)
			seen[seconds] = true
		}
	}
	sort.Float64s(valid)
	return valid
}

func validateCatalogVideoDuration(modelID string, value any) error {
	if value == nil || value == "" {
		return nil
	} // Preserve provider defaults.
	choices := catalogVideoDurations(modelID)
	if len(choices) == 0 {
		return nil
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	if err == nil {
		for _, choice := range choices {
			if choice == seconds {
				return nil
			}
		}
	}
	return fmt.Errorf("所选时长不在模型 %s 支持范围内，请重新选择时长", modelID)
}

const (
	// Public protocol hints select the Studio request shape, never credentials.
	videoCatalogProtocolSeedance = "seedance"
	videoCatalogProtocolOpenAI   = "openai"
)

func catalogVideoProtocol(config model.ModelProviderConfig, modelID string) string {
	// Ark endpoint IDs are opaque: ep-* does not identify the underlying model.
	if config.ProviderType == model.ModelProviderTypeVolcengineArk {
		return videoCatalogProtocolSeedance
	}
	name := strings.ToLower(modelID)
	if strings.Contains(name, "seedance") || strings.Contains(name, "wan3") {
		return videoCatalogProtocolSeedance
	}
	return videoCatalogProtocolOpenAI
}
