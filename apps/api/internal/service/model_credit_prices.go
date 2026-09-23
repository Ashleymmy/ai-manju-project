package service

import (
	"math"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// ModelCreditPrices is the confirmed 2026-09 membership price sheet. Prices are
// credits, not supplier costs. Half credits are rounded only after summing a job.
type ModelCreditPrices struct {
	// A single image price column means resolution-only pricing (no quality tier).
	Images         map[string]map[string][]float64 `json:"images"`
	Videos         map[string]map[string][]float64 `json:"videos"`
	ImageReference float64                         `json:"image_reference"`
	Qualities      []string                        `json:"qualities"`
}

// Video tuples are [without video reference, with video reference, surcharge].
// All three rates are per GENERATED second; video references trigger the
// surcharge once, regardless of their count or source duration.
// Seedance 1.5 tuples instead select [silent, audio, 0].
func DefaultModelCreditPrices() ModelCreditPrices {
	return ModelCreditPrices{
		Qualities: []string{"low", "medium", "high", "xhigh", "max"}, ImageReference: 20,
		Images: map[string]map[string][]float64{
			"gemini-3-pro-image":     {"1k": {float64(PriceImageStandard1024)}, "2k": {float64(PriceImageLarge)}, "4k": {float64(PriceImageLarge)}},
			"gemini-3.1-flash-image": {"1k": {float64(PriceImageStandard1024)}, "2k": {float64(PriceImageLarge)}, "4k": {float64(PriceImageLarge)}},
			"gpt-image-2.5-sunburst": {"1k": {5, 10, 35, 60, 130}, "2k": {15, 30, 130, 230, 515}, "4k": {30, 65, 260, 460, 1030}},
			"gpt-image-2.5-flare":    {"1k": {5, 10, 35, 60, 130}, "2k": {15, 30, 130, 230, 515}, "4k": {30, 65, 260, 460, 1030}},
			"gpt-image-1":            {"1k": {8, 32, 120}, "2k": {20, 120, 480}, "4k": {28, 240, 1000}},
			"gpt-image-1.5":          {"1k": {9, 36, 135}, "2k": {22.5, 135, 540}, "4k": {31.5, 270, 1125}},
			"gpt-image-2":            {"1k": {10, 40, 150}, "2k": {25, 150, 600}, "4k": {35, 300, 1250}},
		},
		Videos: map[string]map[string][]float64{
			"minimax-h3":        {"480p": {30, 30, 30}, "768p": {40, 40, 40}, "2k": {60, 60, 60}},
			"seedance-1.5-pro":  {"480p": {10, 20, 0}, "720p": {20, 45, 0}, "1080p": {50, 100, 0}},
			"seedance-2.0":      {"480p": {60, 80, 0}, "720p": {110, 160, 0}, "1080p": {300, 380, 0}, "4k": {600, 800, 0}},
			"seedance-2.0-fast": {"480p": {20, 30, 0}, "720p": {45, 65, 0}, "1080p": {85, 105, 0}, "2k": {120, 140, 0}, "4k": {195, 215, 0}},
			"seedance-2.0-mini": {"480p": {15, 20, 0}, "720p": {30, 40, 0}},
			"seedance-2.5":      {"480p": {85, 85, 65}, "720p": {195, 195, 135}, "1080p": {485, 485, 325}},
			"wan-3.0":           {"480p": {20, 20, 20}, "720p": {40, 40, 40}, "1080p": {float64(PriceVideoStandardPerSecond), float64(PriceVideoStandardPerSecond), 0}},
			"wan-3.0-prime":     {"480p": {30, 30, 30}, "720p": {60, 60, 60}, "1080p": {float64(PriceVideoStandardPerSecond), float64(PriceVideoStandardPerSecond), 0}},
		},
	}
}

func creditModelID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if parts := strings.Split(value, "::"); len(parts) > 1 {
		value = parts[len(parts)-1]
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "sdvideo/"))
}

func creditModelName(value string) string {
	value = creditModelID(value)
	if canonical, ok := builtinCreditModelAliases[value]; ok {
		return canonical
	}
	value = strings.TrimPrefix(value, "doubao-")
	if value == "minimax-h3" || strings.HasPrefix(value, "minimax-h3-") || strings.HasPrefix(value, "zzdh-minimax-h3-") {
		return "minimax-h3"
	}
	value = strings.ReplaceAll(value, "seedance-2-0", "seedance-2.0")
	value = strings.ReplaceAll(value, "seedance-1-5", "seedance-1.5")
	value = strings.ReplaceAll(value, "seedance-2-5", "seedance-2.5")
	value = strings.ReplaceAll(value, "wan3.0", "wan-3.0")
	if value == "wan-3.0-video" {
		return "wan-3.0"
	}
	if value == "wan-3.0-video-prime" {
		return "wan-3.0-prime"
	}
	// Dated supplier IDs are aliases of the same published model.
	for _, name := range []string{"seedance-2.0-fast", "seedance-2.0-mini", "seedance-2.0", "seedance-1.5-pro", "seedance-2.5"} {
		if value == name || strings.HasPrefix(value, name+"-") {
			return name
		}
	}
	return value
}

func imageCreditResolution(size string) string {
	size = strings.ToLower(size)
	if size == "1k" || size == "2k" || size == "4k" {
		return size
	}
	w, h, ok := parseImageGenerationDimensions(size)
	if !ok || w <= 0 || h <= 0 {
		return ""
	}
	// Pixel budgets match the canvas (16 px alignment can round just above 1 MP).
	if w*h <= 1024*1024*105/100 {
		return "1k"
	}
	if w*h <= 2048*2048*105/100 {
		return "2k"
	}
	return "4k"
}

// Native/bridge jobs use duration/resolution; multipart video jobs use
// seconds (a string) and resolution_name. Quotes and reservations share these.
func videoCreditDuration(body map[string]any) int64 {
	value, exists := body["duration"]
	if !exists {
		value = body["seconds"]
	}
	if text, ok := value.(string); ok {
		seconds, _ := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
		return seconds
	}
	return jsonInt64(value, 0)
}

func videoCreditResolution(body map[string]any) string {
	id := strings.ToLower(jsonString(body["model"]))
	// H3 supplier IDs bind the resolution even if an older client sends a
	// generic resolution. Use the same effective specification as generation.
	if creditModelName(id) == "minimax-h3" {
		for _, resolution := range []string{"480p", "768p", "2k"} {
			if strings.HasSuffix(id, "-"+resolution) {
				return resolution
			}
		}
	}
	resolution := jsonString(body["resolution"])
	if resolution == "" {
		resolution = jsonString(body["resolution_name"])
	}
	return strings.ToLower(strings.TrimSpace(resolution))
}

func hasVideoCreditReference(body map[string]any) bool {
	for _, field := range []string{"content", "references", "files"} {
		items, _ := body[field].([]any)
		for _, raw := range items {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			kind := jsonString(item["type"])
			if kind == "video_url" || kind == "video" || strings.HasPrefix(jsonString(item["content_type"]), "video/") {
				return true
			}
		}
	}
	return false
}

func (p *CreditPricer) modelPrice(jobType string, body map[string]any, params map[string]any) (float64, bool) {
	catalog := LoadModelCreditPrices(p.billing)
	// QuoteForJob resolved this from the real model ID using server configuration.
	name := jsonString(params["pricing_model"])
	params["pricing_source"] = "legacy"
	if jobType == model.JobTypeImageGenerate || jobType == model.JobTypeImageEdit {
		quality := jsonString(body["quality"])
		if quality == "standard" {
			quality = "low"
		}
		if quality == "hd" {
			quality = "high"
		}
		resolution := imageCreditResolution(jsonString(body["size"]))
		prices := catalog.Images[name][resolution]
		index := -1
		for i, q := range catalog.Qualities {
			if q == quality {
				index = i
			}
		}
		refs := 0
		// Gemini exposes resolution but no quality control. Its sole price column
		// applies even when clients send auto quality; auto size still falls back.
		if len(prices) == 1 {
			index, quality = 0, "standard"
		}
		if items, ok := body["references"].([]any); ok {
			for _, item := range items {
				if file, ok := item.(map[string]any); ok && jsonString(file["field_name"]) == "mask" {
					continue
				}
				refs++
			}
		}
		count := max(int64(1), jsonInt64(body["n"], 1))
		params["quality"], params["resolution"], params["reference_count"] = quality, resolution, refs
		params["reference_per_image"] = catalog.ImageReference
		if index < 0 || index >= len(prices) {
			minimum, maximum := math.Inf(1), float64(0)
			for res, variants := range catalog.Images[name] {
				if resolution != "" && resolution != res {
					continue
				}
				for i, price := range variants {
					if index >= 0 && index != i {
						continue
					}
					minimum, maximum = math.Min(minimum, price), math.Max(maximum, price)
				}
			}
			if !math.IsInf(minimum, 1) {
				params["range_min"] = roundCreditTotal((minimum + float64(refs)*catalog.ImageReference) * float64(count))
				params["range_max"] = roundCreditTotal((maximum + float64(refs)*catalog.ImageReference) * float64(count))
			}
			return 0, false
		}
		params["pricing_source"] = "membership_price_sheet"
		return (prices[index] + float64(refs)*catalog.ImageReference) * float64(count), true
	}
	resolution := videoCreditResolution(body)
	prices := catalog.Videos[name][resolution]
	if len(prices) != 3 {
		return 0, false
	}
	hasRef := hasVideoCreditReference(body)
	index := 0
	if hasRef {
		index = 1
	}
	if name == "seedance-1.5-pro" {
		index = 0
		if audio, _ := body["generate_audio"].(bool); audio {
			index = 1
		}
	}
	surcharge := float64(0)
	if hasRef {
		surcharge = prices[2]
	}
	duration := videoCreditDuration(body)
	perSecond := prices[index] + surcharge
	params["has_video_reference"] = hasRef
	params["base_per_second"] = prices[index]
	params["reference_per_second"] = surcharge
	params["per_second"] = perSecond
	if duration <= 0 {
		return 0, false
	}
	params["pricing_source"] = "membership_price_sheet"
	return perSecond * float64(duration), true
}

func roundCreditTotal(value float64) int64 { return int64(math.Ceil(value)) }
