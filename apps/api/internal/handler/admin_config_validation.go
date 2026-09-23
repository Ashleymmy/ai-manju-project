package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/service"
	"time"
)

// Billing JSON is configuration, not an arbitrary document. Validate the
// values consumed by services so successful saves cannot silently fall back.
func validateBillingConfig(key string, raw json.RawMessage) error {
	integer := func(raw json.RawMessage, min, max int64) error {
		var v int64
		if json.Unmarshal(raw, &v) != nil || string(raw) == "null" || v < min || v > max {
			return fmt.Errorf("value must be an integer between %d and %d", min, max)
		}
		return nil
	}
	object := func() (map[string]json.RawMessage, error) {
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil || m == nil {
			return nil, errors.New("configuration must be an object")
		}
		return m, nil
	}
	switch key {
	case model.BillingConfigKeyModelAliases:
		_, err := service.ParseModelCreditAliases(raw)
		return err
	case model.BillingConfigKeyModelPrices:
		_, err := service.ParseModelCreditPrices(raw)
		return err
	case model.BillingConfigKeyRegisterBonus:
		return integer(raw, 0, maxAdminTestCredits)
	case model.BillingConfigKeyRegisterBonusTTL, model.BillingConfigKeyInviteRewardTTL:
		return integer(raw, 1, maxAdminMembershipDays)
	case model.BillingConfigKeyInviteRewards:
		m, err := object()
		if err != nil {
			return err
		}
		for _, name := range []string{"inviter", "invitee", "first_charge_bonus"} {
			if err := integer(m[name], 1, maxAdminTestCredits); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
		return nil
	case model.BillingConfigKeyPricingRules:
		m, err := object()
		if err != nil {
			return err
		}
		fields := map[string][]string{"image": {"small_512", "standard_1024", "large"}, "video_fast": {"per_second"}, "video_standard": {"per_second"}, "agent_skill": {"per_call"}}
		for group, keys := range fields {
			value, ok := m[group]
			if !ok {
				continue
			}
			var section map[string]json.RawMessage
			if json.Unmarshal(value, &section) != nil || section == nil {
				return fmt.Errorf("%s must be an object", group)
			}
			for _, name := range keys {
				if v, exists := section[name]; exists {
					if err := integer(v, 1, maxAdminTestCredits); err != nil {
						return fmt.Errorf("%s.%s: %w", group, name, err)
					}
				}
			}
		}
		return nil
	case model.BillingConfigKeyActivity:
		m, err := object()
		if err != nil {
			return err
		}
		var enabled bool
		if json.Unmarshal(m["enabled"], &enabled) != nil || string(m["enabled"]) == "null" {
			return errors.New("enabled must be boolean")
		}
		if err := integer(m["discount_bps"], 1, maxAdminDiscountBps); err != nil {
			return err
		}
		var types []string
		if json.Unmarshal(m["applies_to"], &types) != nil || types == nil {
			return errors.New("applies_to must be an array")
		}
		for _, v := range types {
			switch v {
			case model.TaskTypeImage, model.TaskTypeVideoFast, model.TaskTypeVideoStandard, model.TaskTypeAgentSkill:
			default:
				return errors.New("unsupported activity task type")
			}
		}
		var start, end time.Time
		for _, name := range []string{"starts_at", "ends_at"} {
			value, exists := m[name]
			if !exists {
				continue
			}
			var str string
			if json.Unmarshal(value, &str) != nil {
				return errors.New("activity dates must be strings")
			}
			if str == "" {
				continue
			}
			parsed, err := time.Parse(time.RFC3339, str)
			if err != nil {
				return errors.New("activity dates must be RFC3339")
			}
			if name == "starts_at" {
				start = parsed
			} else {
				end = parsed
			}
		}
		if !start.IsZero() && !end.IsZero() && !end.After(start) {
			return errors.New("activity end must follow start")
		}
		return nil
	case model.BillingConfigKeyGiftPacks:
		var items []map[string]json.RawMessage
		if json.Unmarshal(raw, &items) != nil || items == nil {
			return errors.New("gift packs must be an array")
		}
		for _, item := range items {
			for _, name := range []string{"credits", "price_cents", "membership_days", "sort_order"} {
				if value, exists := item[name]; exists {
					if err := integer(value, 0, maxAdminTestCredits); err != nil {
						return fmt.Errorf("%s: %w", name, err)
					}
				}
			}
		}
		return nil
	default:
		return errors.New("unsupported configuration")
	}
}
