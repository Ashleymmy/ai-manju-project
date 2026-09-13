package repository

import (
	"context"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestBridgeStatsExcludeTerminalExceptUncertainLegacyJobs(t *testing.T) {
	repo := NewMemoryJobRepository()
	clock := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	repo.clockFn = func() time.Time { return clock }
	rows := []model.Job{
		{ID: "pending", ExternalProvider: "sd-video", BridgeState: "pending", BridgeAttempts: 2},
		{ID: "done", ExternalProvider: "sd-video", BridgeState: "done"},
		{ID: "canceled", ExternalProvider: "sd-video", BridgeState: "canceled"},
		{ID: "uncertain", ExternalProvider: "sd-video", BridgeState: "done", Status: "failed", Error: model.JSONB(`{"code":"submission_uncertain"}`)},
		{ID: "other", ExternalProvider: "other", BridgeState: "pending"},
	}
	for _, row := range rows {
		row.IdempotencyKey = row.ID
		if _, err := repo.Create(row); err != nil {
			t.Fatal(err)
		}
	}
	clock = clock.Add(time.Minute)
	stats, err := repo.BridgeStatistics(context.Background())
	if err != nil || stats.Pending != 2 || stats.Retrying != 1 || stats.Uncertain != 1 || stats.OldestPendingSeconds != 60 {
		t.Fatalf("stats=%+v err=%v", stats, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.BridgeStatistics(ctx); err == nil {
		t.Fatal("canceled health probe must not succeed")
	}
}
