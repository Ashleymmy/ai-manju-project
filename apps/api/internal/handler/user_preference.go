package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

type UserPreferenceHandler struct {
	repo repository.UserPreferenceRepository
}

func NewUserPreferenceHandler(repo repository.UserPreferenceRepository) *UserPreferenceHandler {
	return &UserPreferenceHandler{repo: repo}
}

type UserPreferences struct {
	Generation map[string]any `json:"generation"`
	Shortcuts  map[string]any `json:"shortcuts"`
	Canvas     map[string]any `json:"canvas"`
	UpdatedAt  string         `json:"updated_at,omitempty"`
}

func (h *UserPreferenceHandler) Get(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	preferences, err := h.currentPreferences(user.ID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	response.OK(c, preferences)
}

func (h *UserPreferenceHandler) Put(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Generation map[string]any `json:"generation"`
		Shortcuts  map[string]any `json:"shortcuts"`
		Canvas     map[string]any `json:"canvas"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	current, err := h.currentPreferences(user.ID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	next := UserPreferences{
		Generation: mergePreferenceMap(current.Generation, sanitizeGeneration(req.Generation)),
		Shortcuts:  mergePreferenceMap(current.Shortcuts, sanitizeShortcuts(req.Shortcuts)),
		Canvas:     mergePreferenceMap(current.Canvas, sanitizeCanvas(req.Canvas)),
	}

	preference, err := h.repo.Upsert(model.UserPreference{
		UserID:     user.ID,
		Generation: mustJSONB(next.Generation),
		Shortcuts:  mustJSONB(next.Shortcuts),
		Canvas:     mustJSONB(next.Canvas),
	})
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	response.OK(c, preferenceResponse(preference))
}

func (h *UserPreferenceHandler) currentPreferences(userID string) (UserPreferences, error) {
	preference, err := h.repo.GetByUser(userID)
	if errors.Is(err, repository.ErrUserPreferenceNotFound) {
		return DefaultUserPreferences(), nil
	}
	if err != nil {
		return UserPreferences{}, err
	}
	return preferenceResponse(preference), nil
}

func preferenceResponse(preference model.UserPreference) UserPreferences {
	defaults := DefaultUserPreferences()
	result := UserPreferences{
		Generation: mergePreferenceMap(defaults.Generation, jsonbMap(preference.Generation)),
		Shortcuts:  mergePreferenceMap(defaults.Shortcuts, jsonbMap(preference.Shortcuts)),
		Canvas:     mergePreferenceMap(defaults.Canvas, jsonbMap(preference.Canvas)),
	}
	if !preference.UpdatedAt.IsZero() {
		result.UpdatedAt = preference.UpdatedAt.Format(timeFormatRFC3339Milli)
	}
	return result
}

const timeFormatRFC3339Milli = "2006-01-02T15:04:05.000Z07:00"

func DefaultUserPreferences() UserPreferences {
	return UserPreferences{
		Generation: map[string]any{
			"imageModel":         "",
			"videoModel":         "",
			"textModel":          "",
			"audioModel":         "",
			"quality":            "auto",
			"size":               "1:1",
			"count":              "1",
			"canvasImageCount":   "3",
			"videoSeconds":       "6",
			"vquality":           "720",
			"videoGenerateAudio": "true",
			"videoWatermark":     "false",
			"audioVoice":         "alloy",
			"audioFormat":        "mp3",
			"audioSpeed":         "1",
			"audioInstructions":  "",
			"systemPrompt":       "",
		},
		Shortcuts: map[string]any{
			"undo":         []any{"Ctrl+Z", "Meta+Z"},
			"redo":         []any{"Ctrl+Shift+Z", "Meta+Shift+Z", "Ctrl+Y"},
			"delete":       []any{"Delete", "Backspace"},
			"copy":         []any{"Ctrl+C", "Meta+C"},
			"paste":        []any{"Ctrl+V", "Meta+V"},
			"selectAll":    []any{"Ctrl+A", "Meta+A"},
			"runSelection": []any{"Ctrl+Enter", "Meta+Enter"},
			"openSettings": []any{"Ctrl+,"},
			"resetZoom":    []any{"Ctrl+0", "Meta+0"},
		},
		Canvas: map[string]any{
			"middleButtonLockHint":  true,
			"backgroundMode":        "lines",
			"wheelZoomRequiresCtrl": true,
			"promptPresets":         []any{},
		},
	}
}

func sanitizeGeneration(value map[string]any) map[string]any {
	allowed := map[string]bool{
		"imageModel": true, "videoModel": true, "textModel": true, "audioModel": true,
		"quality": true, "size": true, "count": true, "canvasImageCount": true,
		"videoSeconds": true, "vquality": true, "videoGenerateAudio": true, "videoWatermark": true,
		"audioVoice": true, "audioFormat": true, "audioSpeed": true, "audioInstructions": true,
		"systemPrompt": true,
	}
	return filterPreferenceKeys(value, allowed)
}

func sanitizeShortcuts(value map[string]any) map[string]any {
	allowed := map[string]bool{
		"undo": true, "redo": true, "delete": true, "copy": true, "paste": true,
		"selectAll": true, "runSelection": true, "openSettings": true, "resetZoom": true,
	}
	result := map[string]any{}
	for key, raw := range filterPreferenceKeys(value, allowed) {
		items, ok := raw.([]any)
		if !ok {
			continue
		}
		normalized := make([]any, 0, len(items))
		seen := map[string]bool{}
		for _, item := range items {
			text, ok := item.(string)
			if !ok || text == "" || seen[text] {
				continue
			}
			seen[text] = true
			normalized = append(normalized, text)
		}
		if len(normalized) > 0 {
			result[key] = normalized
		}
	}
	return result
}

func sanitizeCanvas(value map[string]any) map[string]any {
	allowed := map[string]bool{"middleButtonLockHint": true, "backgroundMode": true, "wheelZoomRequiresCtrl": true, "promptPresets": true}
	result := filterPreferenceKeys(value, allowed)
	if presets, ok := sanitizePromptPresets(result["promptPresets"]); ok {
		result["promptPresets"] = presets
	} else {
		delete(result, "promptPresets")
	}
	return result
}

const (
	// Prompt preset caps mirror the client-side limits and keep preference JSON bounded.
	maxPromptPresetCount           = 100
	maxPromptPresetIDLength        = 96
	maxPromptPresetTitleLength     = 120
	maxPromptPresetPromptLength    = 4000
	maxPromptPresetTagCount        = 12
	maxPromptPresetTagLength       = 48
	maxPromptPresetTimestampLength = 64
	maxPromptPresetSortOrder       = 1_000_000
)

func sanitizePromptPresets(value any) ([]any, bool) {
	items, ok := value.([]any)
	if !ok {
		return nil, false
	}
	result := make([]any, 0, len(items))
	seen := map[string]bool{}
	for index, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := boundedStringPreference(item, "id", maxPromptPresetIDLength)
		title := boundedStringPreference(item, "title", maxPromptPresetTitleLength)
		prompt := boundedStringPreference(item, "prompt", maxPromptPresetPromptLength)
		if id == "" || title == "" || prompt == "" || seen[id] {
			continue
		}
		seen[id] = true
		tags := []any{}
		seenTags := map[string]bool{}
		if rawTags, ok := item["tags"].([]any); ok {
			for _, rawTag := range rawTags {
				tag, ok := rawTag.(string)
				if ok {
					tag = truncateString(strings.TrimSpace(tag), maxPromptPresetTagLength)
				}
				if ok && tag != "" && !seenTags[tag] {
					seenTags[tag] = true
					tags = append(tags, tag)
				}
				if len(tags) >= maxPromptPresetTagCount {
					break
				}
			}
		}
		result = append(result, map[string]any{
			"id":         id,
			"title":      title,
			"prompt":     prompt,
			"tags":       tags,
			"priority":   promptPresetPriority(item["priority"]),
			"sort_order": boundedIntegerPreference(item["sort_order"], index, 0, maxPromptPresetSortOrder),
			"createdAt":  boundedStringPreference(item, "createdAt", maxPromptPresetTimestampLength),
			"updatedAt":  boundedStringPreference(item, "updatedAt", maxPromptPresetTimestampLength),
		})
		if len(result) >= maxPromptPresetCount {
			break
		}
	}
	return result, true
}

func promptPresetPriority(value any) string {
	priority, _ := value.(string)
	switch strings.TrimSpace(priority) {
	case "pinned", "high", "normal", "low":
		return strings.TrimSpace(priority)
	default:
		return "normal"
	}
}

func boundedIntegerPreference(value any, fallback, minimum, maximum int) int {
	result := fallback
	switch number := value.(type) {
	case float64:
		result = int(number)
	case float32:
		result = int(number)
	case int:
		result = number
	case int64:
		result = int(number)
	case json.Number:
		if parsed, err := number.Int64(); err == nil {
			result = int(parsed)
		}
	}
	if result < minimum {
		return minimum
	}
	if result > maximum {
		return maximum
	}
	return result
}

func boundedStringPreference(item map[string]any, key string, maxLength int) string {
	value, _ := item[key].(string)
	return truncateString(strings.TrimSpace(value), maxLength)
}

func truncateString(value string, maxLength int) string {
	if maxLength <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxLength {
		return value
	}
	return string(runes[:maxLength])
}

func filterPreferenceKeys(value map[string]any, allowed map[string]bool) map[string]any {
	result := map[string]any{}
	for key, item := range value {
		if allowed[key] {
			result[key] = item
		}
	}
	return result
}

func mergePreferenceMap(base map[string]any, patch map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range base {
		result[key] = value
	}
	for key, value := range patch {
		result[key] = value
	}
	return result
}

func jsonbMap(value model.JSONB) map[string]any {
	result := map[string]any{}
	if len(value) == 0 {
		return result
	}
	_ = json.Unmarshal(value, &result)
	return result
}

func mustJSONB(value map[string]any) model.JSONB {
	bytes, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(bytes)
}
