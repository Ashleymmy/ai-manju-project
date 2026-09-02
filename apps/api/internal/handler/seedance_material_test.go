package handler

import (
	"reflect"
	"testing"
)

func TestSeedanceAssetIDsFromPayloadFindsNestedAssetURLs(t *testing.T) {
	got := seedanceAssetIDsFromPayload(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "prompt"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://asset-a"}},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://asset-b"}},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://asset-a"}},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.test/ref.png"}},
		},
	})
	want := []string{"asset-a", "asset-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("asset ids = %#v, want %#v", got, want)
	}
}
