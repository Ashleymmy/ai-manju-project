package service

import "strings"

// Bound history metadata without truncating ordinary multi-shot prompts.
const maxAssetHistoryPromptRunes = 20_000

// VideoHistoryMetadata keeps only user-facing generation parameters alongside
// the result asset. References, signed URLs and provider credentials stay out.
func VideoHistoryMetadata(payload map[string]any) map[string]any {
	text, _ := payload["prompt"].(string)
	if text == "" {
		if content, ok := payload["content"].([]any); ok {
			var parts []string
			for _, raw := range content {
				if item, ok := raw.(map[string]any); ok && item["type"] == "text" {
					if value, ok := item["text"].(string); ok {
						parts = append(parts, value)
					}
				}
			}
			text = strings.Join(parts, "\n")
		}
	}
	model := payload["studio_model"]
	if model == nil {
		model = payload["model"]
	}
	duration := payload["duration"]
	if duration == nil {
		duration = payload["seconds"]
	}
	size := payload["ratio"]
	if size == nil {
		size = payload["size"]
	}
	return sanitizeAssetSourceMetadata(map[string]any{
		"operation": "video.generate", "node_id": payload["node_id"],
		"model": model, "prompt": text, "seconds": duration, "size": size,
	})
}
