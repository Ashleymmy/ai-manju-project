// [画布别名] 全局别名表的解析与读取；所有相关改动都带此标记，便于检索。

package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// MaxCanvasModelNicknameRunes keeps a nickname short enough for model pickers.
	MaxCanvasModelNicknameRunes = 32
	// MaxCanvasModelNicknames bounds the global table; one entry per real model ID.
	MaxCanvasModelNicknames = 500
)

// ParseCanvasModelNicknames validates real model ID -> member-facing nickname
// pairs. Nicknames are presentation only and never change routing or billing.
func ParseCanvasModelNicknames(raw []byte) (map[string]string, error) {
	var nicknames map[string]string
	if err := json.Unmarshal(raw, &nicknames); err != nil || nicknames == nil {
		return nil, fmt.Errorf("canvas model nicknames must be an object of model IDs and nicknames")
	}
	if len(nicknames) > MaxCanvasModelNicknames {
		return nil, fmt.Errorf("at most %d canvas model nicknames are allowed", MaxCanvasModelNicknames)
	}
	for modelID, nickname := range nicknames {
		if modelID == "" || modelID != strings.TrimSpace(modelID) || strings.Contains(modelID, "::") {
			return nil, fmt.Errorf("%q: use a real model ID without a provider prefix", modelID)
		}
		if nickname == "" || nickname != strings.TrimSpace(nickname) {
			return nil, fmt.Errorf("%s: nickname must be non-empty without surrounding spaces", modelID)
		}
		if utf8.RuneCountInString(nickname) > MaxCanvasModelNicknameRunes {
			return nil, fmt.Errorf("%s: nickname must be at most %d characters", modelID, MaxCanvasModelNicknameRunes)
		}
	}
	return nicknames, nil
}

// LoadCanvasModelNicknames returns the saved table, or an empty one when it is
// missing or unreadable so the model catalog never fails on presentation data.
func LoadCanvasModelNicknames(billing repository.BillingRepository) map[string]string {
	if billing == nil {
		return map[string]string{}
	}
	config, err := billing.GetConfig(model.BillingConfigKeyCanvasNicknames)
	if err != nil {
		return map[string]string{}
	}
	nicknames, err := ParseCanvasModelNicknames(config.Value)
	if err != nil {
		return map[string]string{}
	}
	return nicknames
}
