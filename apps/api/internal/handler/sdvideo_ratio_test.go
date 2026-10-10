package handler

import "testing"

func TestSDVideoRatioForSizeKeepsPortraitSizesPortrait(t *testing.T) {
	for size, want := range map[string]string{
		"1280x720":  "16:9",
		"1792x1024": "16:9",
		"720x1280":  "9:16",
		"1024x1792": "9:16",
		"1024x1024": "1:1",
		"":          "16:9",
	} {
		if got := sdVideoRatioForSize(size); got != want {
			t.Fatalf("sdVideoRatioForSize(%q) = %q, want %q", size, got, want)
		}
	}
}
