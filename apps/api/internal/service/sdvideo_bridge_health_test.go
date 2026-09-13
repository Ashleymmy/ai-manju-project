package service

import (
	"context"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/repository"
)

func TestBridgeHealthDoesNotTreatProcessExistenceAsProgress(t *testing.T) {
	jobs := NewJobService(repository.NewMemoryJobRepository(), nil, "", 3)
	bridge := NewSDVideoBridge(jobs, nil, nil, nil, 0, 1)
	if _, _, err := bridge.HealthSnapshot(context.Background()); err == nil {
		t.Fatal("unstarted loop must not be healthy")
	}
	bridge.lastProgress.Store(time.Now().Add(-10 * time.Minute).Unix())
	stats, age, err := bridge.HealthSnapshot(context.Background())
	if err != nil || age < 600 || stats.Pending != 0 {
		t.Fatalf("health age=%v stats=%+v err=%v", age, stats, err)
	}
	bridge.lastProgress.Store(time.Now().Unix())
	if _, age, err := bridge.HealthSnapshot(context.Background()); err != nil || age > 1 {
		t.Fatalf("health age=%v err=%v", age, err)
	}
}
