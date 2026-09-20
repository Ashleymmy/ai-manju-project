package service

import (
	"strings"
	"testing"
)

func TestVideoHistoryMetadataPreservesPromptAndExcludesReferences(t *testing.T) {
	prompt := strings.Repeat("镜头", 200)
	meta := VideoHistoryMetadata(map[string]any{"studio_model": "official::endpoint", "model": "endpoint", "content": []any{
		map[string]any{"type": "text", "text": prompt}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "signed-private"}}}, "duration": 30, "ratio": "16:9", "node_id": "node", "api_key": "private"})
	if meta["prompt"] != prompt || meta["model"] != "official::endpoint" || meta["seconds"] != 30 || meta["size"] != "16:9" || meta["node_id"] != "node" {
		t.Fatal("history parameters lost")
	}
	if _, exists := meta["content"]; exists {
		t.Fatal("references retained")
	}
	if _, exists := meta["api_key"]; exists {
		t.Fatal("credentials retained")
	}
	long := VideoHistoryMetadata(map[string]any{"prompt": strings.Repeat("字", maxAssetHistoryPromptRunes+1)})
	if len([]rune(long["prompt"].(string))) != maxAssetHistoryPromptRunes {
		t.Fatal("prompt limit not enforced")
	}
}
