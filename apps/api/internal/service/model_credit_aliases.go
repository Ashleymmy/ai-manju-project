package service

import (
	"encoding/json"
	"fmt"

	"github.com/ai-manju/api/internal/model"
)

// Stable SD-video logical IDs use the same prices as their official families.
// Deployment-specific endpoint IDs belong in billing_configs, not source code.
var builtinCreditModelAliases = map[string]string{
	"seedance-fast":           "seedance-2.0-fast",
	"yike-wan3.0-video":       "wan-3.0",
	"yike-wan3.0-video-prime": "wan-3.0-prime",
}

// ParseModelCreditAliases validates exact upstream ID -> official family pairs.
// Targets must be price-table keys; chaining and overriding known families are
// rejected so renames cannot accidentally change existing model prices.
func ParseModelCreditAliases(raw []byte) (map[string]string, error) {
	var aliases map[string]string
	if err := json.Unmarshal(raw, &aliases); err != nil || aliases == nil {
		return nil, fmt.Errorf("model credit aliases must be an object of model IDs and official price families")
	}
	catalog := DefaultModelCreditPrices()
	known := func(name string) bool {
		return catalog.Images[name] != nil || catalog.Videos[name] != nil
	}
	for source, target := range aliases {
		if source == "" || source != creditModelID(source) {
			return nil, fmt.Errorf("%q: use a normalized upstream model ID without a provider prefix", source)
		}
		if known(creditModelName(source)) {
			return nil, fmt.Errorf("%s already belongs to a known price family", source)
		}
		if !known(target) {
			return nil, fmt.Errorf("%s: target must be an official price-table family", source)
		}
	}
	return aliases, nil
}

func (p *CreditPricer) creditModelName(requested string) string {
	name := creditModelName(requested)
	if stored, err := p.billing.GetConfig(model.BillingConfigKeyModelAliases); err == nil {
		if aliases, err := ParseModelCreditAliases(stored.Value); err == nil {
			if canonical, ok := aliases[creditModelID(requested)]; ok {
				return canonical
			}
		}
	}
	return name
}

// ResolveModelFamily uses stable IDs and administrator mappings, never display names.
// Capability discovery shares this identity mapping without depending on prices.
func (p *CreditPricer) ResolveModelFamily(requested string) string {
	return p.creditModelName(requested)
}
