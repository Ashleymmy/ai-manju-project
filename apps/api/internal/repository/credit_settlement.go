package repository

import (
	"encoding/json"

	"github.com/ai-manju/api/internal/model"
)

type creditSettlement struct {
	Credits int64
	Params  model.JSONB
}

func settlementCredits(consumption model.TaskConsumption, settlement *creditSettlement) (int64, error) {
	if settlement == nil {
		var params map[string]any
		if json.Unmarshal(consumption.Params, &params) == nil && params["billing_mode"] == "actual_video_duration" {
			return 0, ErrActualSettlementRequired
		}
		return consumption.CreditsQuoted, nil
	}
	if settlement.Credits < 0 || settlement.Credits > consumption.CreditsQuoted || !json.Valid(settlement.Params) {
		return 0, ErrInvalidSettlementAmount
	}
	return settlement.Credits, nil
}

func validateSettlementAllocation(allocation []model.CreditAllocationItem, quoted int64) error {
	remaining := quoted
	seen := map[string]bool{}
	for _, item := range allocation {
		if item.Amount <= 0 || item.Amount > remaining || (item.Bucket != model.CreditBucketPermanent && item.Bucket != model.CreditBucketGrant) || (item.Bucket == model.CreditBucketGrant && item.GrantID == "") {
			return ErrInvalidSettlementAmount
		}
		key := item.Bucket + ":" + item.GrantID
		if seen[key] {
			return ErrInvalidSettlementAmount
		}
		seen[key] = true
		remaining -= item.Amount
	}
	if remaining != 0 {
		return ErrInvalidSettlementAmount
	}
	return nil
}
