package service

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	imageGenerationDimensionStep = 16
	imageGenerationMinPixels     = 655360
	imageGenerationMaxPixels     = 8294400
	imageGenerationMaxEdge       = 3840
	imageGenerationMaxRatio      = 3.0
	imageGenerationDefaultShort  = 1024
)

var (
	ErrImageGenerationQualityInvalid = errors.New("image generation quality is invalid")
	ErrImageGenerationSizeInvalid    = errors.New("image generation size is invalid")
)

// ImageGenerationParameters is the provider-facing subset shared by
// interactive image jobs and server-side comic batches. Empty Size/Quality
// mean provider auto/default, matching the web image workbench behavior.
type ImageGenerationParameters struct {
	Size         string
	Quality      string
	OutputFormat string
}

var imageGenerationQualityBase = map[string]int{
	"low":      1024,
	"medium":   2048,
	"high":     2880,
	"standard": 1024,
	"hd":       2048,
}

var imageGenerationQualityAliases = map[string]string{
	"1k": "low",
	"2k": "medium",
	"4k": "high",
}

// NormalizeImageGenerationParameters centralizes the quality/ratio/explicit
// size semantics that were previously implemented only in the web client.
func NormalizeImageGenerationParameters(size string, quality string, outputFormat string) (ImageGenerationParameters, error) {
	normalizedQuality, err := normalizeImageGenerationQuality(quality)
	if err != nil {
		return ImageGenerationParameters{}, err
	}
	normalizedSize, err := normalizeImageGenerationSize(size, normalizedQuality)
	if err != nil {
		return ImageGenerationParameters{}, err
	}
	return ImageGenerationParameters{
		Size:         normalizedSize,
		Quality:      normalizedQuality,
		OutputFormat: strings.ToLower(strings.TrimSpace(outputFormat)),
	}, nil
}

func normalizeImageGenerationQuality(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || value == "auto" {
		return "", nil
	}
	if alias := imageGenerationQualityAliases[value]; alias != "" {
		value = alias
	}
	if _, ok := imageGenerationQualityBase[value]; !ok {
		return "", fmt.Errorf("%w: %s", ErrImageGenerationQualityInvalid, value)
	}
	return value, nil
}

func normalizeImageGenerationSize(value string, quality string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || value == "auto" {
		return "", nil
	}
	if width, height, ok := parseImageGenerationDimensions(value); ok {
		if err := validateImageGenerationDimensions(width, height); err != nil {
			return "", err
		}
		return fmt.Sprintf("%dx%d", width, height), nil
	}
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return "", fmt.Errorf("%w: use auto, 9:16, or 1024x1024", ErrImageGenerationSizeInvalid)
	}
	ratioWidth, errWidth := strconv.ParseFloat(parts[0], 64)
	ratioHeight, errHeight := strconv.ParseFloat(parts[1], 64)
	if errWidth != nil || errHeight != nil || ratioWidth <= 0 || ratioHeight <= 0 {
		return "", fmt.Errorf("%w: ratio must contain positive numbers", ErrImageGenerationSizeInvalid)
	}
	longRatio := math.Max(ratioWidth, ratioHeight) / math.Min(ratioWidth, ratioHeight)
	if longRatio > imageGenerationMaxRatio {
		return "", fmt.Errorf("%w: ratio cannot exceed 3:1", ErrImageGenerationSizeInvalid)
	}

	longSide, shortSide := 0, 0
	if basePixels := imageGenerationQualityBase[quality]; basePixels > 0 {
		targetPixels := float64(basePixels * basePixels)
		longSide = int(math.Floor(math.Sqrt(targetPixels*longRatio)/imageGenerationDimensionStep)) * imageGenerationDimensionStep
		shortSide = int(math.Round(float64(longSide)/longRatio/imageGenerationDimensionStep)) * imageGenerationDimensionStep
	} else {
		shortSide = imageGenerationDefaultShort
		longSide = int(math.Round(float64(shortSide)*longRatio/imageGenerationDimensionStep)) * imageGenerationDimensionStep
	}
	width, height := longSide, shortSide
	if ratioWidth < ratioHeight {
		width, height = shortSide, longSide
	}
	if err := validateImageGenerationDimensions(width, height); err != nil {
		return "", err
	}
	return fmt.Sprintf("%dx%d", width, height), nil
}

func parseImageGenerationDimensions(value string) (int, int, bool) {
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, errWidth := strconv.Atoi(parts[0])
	height, errHeight := strconv.Atoi(parts[1])
	if errWidth != nil || errHeight != nil {
		return 0, 0, false
	}
	return width, height, true
}

func validateImageGenerationDimensions(width int, height int) error {
	if width <= 0 || height <= 0 {
		return fmt.Errorf("%w: dimensions must be positive", ErrImageGenerationSizeInvalid)
	}
	if width%imageGenerationDimensionStep != 0 || height%imageGenerationDimensionStep != 0 {
		return fmt.Errorf("%w: dimensions must be multiples of 16", ErrImageGenerationSizeInvalid)
	}
	if max(width, height) > imageGenerationMaxEdge {
		return fmt.Errorf("%w: longest edge cannot exceed 3840", ErrImageGenerationSizeInvalid)
	}
	ratio := float64(max(width, height)) / float64(min(width, height))
	if ratio > imageGenerationMaxRatio {
		return fmt.Errorf("%w: ratio cannot exceed 3:1", ErrImageGenerationSizeInvalid)
	}
	pixels := width * height
	if pixels < imageGenerationMinPixels || pixels > imageGenerationMaxPixels {
		return fmt.Errorf("%w: total pixels must be between %d and %d", ErrImageGenerationSizeInvalid, imageGenerationMinPixels, imageGenerationMaxPixels)
	}
	return nil
}
