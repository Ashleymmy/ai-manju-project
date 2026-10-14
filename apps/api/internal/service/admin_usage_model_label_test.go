package service

import (
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestUsageModelGroupShowsCatalogName(t *testing.T) {
	named := UsageRow{Provider: "vendor", Model: "ep-25", StudioModel: "official::seedance-2.5"}
	key, label := usageGroupKey(named, UsageFilter{GroupBy: "model"})
	if key != "vendor/ep-25" || label != "seedance-2.5" {
		t.Fatalf("catalog name: key=%s label=%s", key, label)
	}
	endpoint := UsageRow{Provider: "vendor", Model: "ep-25", StudioModel: "private::ep-25"}
	_, label = usageGroupKey(endpoint, UsageFilter{GroupBy: "model"})
	if label != "ep-25" {
		t.Fatalf("endpoint-only studio model should stay raw, got %s", label)
	}
	row := UsageRow{Model: "ep-25", StudioModel: "private::ep-25"}
	attachConsumption(&row, model.TaskConsumption{Params: model.JSONB(`{"pricing_model":"seedance-2.5"}`)})
	if UsageModelLabel(row) != "seedance-2.5" {
		t.Fatalf("pricing model should replace an endpoint alias, got %s", UsageModelLabel(row))
	}
}

func TestEstimateUsageCostMatchesCatalogRateToEndpointJob(t *testing.T) {
	created := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	row := UsageRow{
		Status: model.JobStatusSucceeded, Model: "ep-25", StudioModel: "official::seedance-2.5",
		Provider: "vendor", OutputCount: 2, CreatedAt: created,
	}
	rates := []model.ModelCostRate{{
		ID: "rate-name", Model: "seedance-2.5", Unit: model.CostUnitImage, UnitCostMicros: 1500, EffectiveAt: created.Add(-time.Hour),
	}}
	estimateUsageCost(&row, rates)
	if row.EstimatedCostMicros == nil || *row.EstimatedCostMicros != 3000 || row.RateID != "rate-name" {
		t.Fatalf("catalog rate should estimate the endpoint job: %+v", row)
	}

	failed := UsageRow{Status: model.JobStatusFailed, Model: "ep-25", StudioModel: "official::seedance-2.5", CreatedAt: created}
	estimateUsageCost(&failed, rates)
	if failed.EstimatedCostMicros != nil {
		t.Fatalf("failed jobs stay unestimated until reconciled: %+v", failed)
	}
}
