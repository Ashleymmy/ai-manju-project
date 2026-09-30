package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestImageOutputCountValidatesActualResults(t *testing.T) {
	for _, tc := range []struct {
		result string
		want   int64
	}{
		{`{"outputs":[{"asset_id":"a"},{"asset_id":"b"},{"asset_id":"a"}],"assets":[{"id":"a"},{"id":"b"}]}`, 2},
		{`{"outputs":[{"path":"one.png","content_type":"image/png"},{"remote_url":"https://example.test/two.png"},{"url":"https://example.test/three.png"}]}`, 3},
		{`{"outputs":[null,{}, {"asset_id":" "},{"asset_id":5},{"asset_id":"video","content_type":"video/mp4"},{"asset_id":"audio","type":"audio"}]}`, 0},
		{`{"n":9,"count":9,"outputs":[]}`, 0},
		{`{"outputs":null}`, 0},
		{`{invalid`, 0},
	} {
		if got := imageOutputCount(model.JSONB(tc.result)); got != tc.want {
			t.Errorf("count(%s) = %d, want %d", tc.result, got, tc.want)
		}
	}
}

func TestMonthlyImageOutputsMemory(t *testing.T) {
	repo := NewMemoryJobRepository()
	runMonthlyImageOutputContract(t, repo, func(job model.Job) { repo.jobs[job.ID] = job })
}

func TestMonthlyImageOutputsPostgres(t *testing.T) {
	dsn := os.Getenv("IMAGE_COUNT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set IMAGE_COUNT_TEST_DATABASE_URL to a dedicated PostgreSQL test database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Job{}); err != nil {
		t.Fatal(err)
	}
	runMonthlyImageOutputContract(t, NewGormJobRepository(db), func(job model.Job) {
		if err := db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
	})
}

func runMonthlyImageOutputContract(t *testing.T, repo JobRepository, seed func(model.Job)) {
	t.Helper()
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	now := start.Add(time.Hour)
	previous := start.Add(-time.Second)
	user := fmt.Sprintf("image_count_%d", time.Now().UnixNano())
	add := func(id string, mutate func(*model.Job)) {
		job := model.Job{ID: user + "_" + id, IdempotencyKey: user + "_" + id, UserID: user,
			Type: model.JobTypeImageGenerate, Status: model.JobStatusSucceeded,
			CreatedAt: now, UpdatedAt: now, FinishedAt: &now,
			Payload: model.JSONB(`{"n":9}`), Result: model.JSONB(`{"outputs":[{"asset_id":"one"}]}`)}
		if mutate != nil {
			mutate(&job)
		}
		seed(job)
	}
	add("batch", func(j *model.Job) {
		j.Result = model.JSONB(`{"outputs":[{"asset_id":"one"},{"asset_id":"two"},{"asset_id":"one"}]}`)
	})
	add("edit", func(j *model.Job) { j.Type = model.JobTypeImageEdit })
	add("late_completion", func(j *model.Job) { j.CreatedAt = previous })
	add("legacy", func(j *model.Job) { j.FinishedAt = nil })
	add("start_inclusive", func(j *model.Job) { j.FinishedAt = &start })
	add("partial", func(j *model.Job) { j.Result = model.JSONB(`{"outputs":[{"path":"a.png"},{"path":"b.png"}]}`) })
	add("end_exclusive", func(j *model.Job) { j.FinishedAt = &end })
	add("previous_month", func(j *model.Job) { j.FinishedAt = &previous })
	add("other_user", func(j *model.Job) { j.UserID = "someone_else" })
	add("video", func(j *model.Job) { j.Type = model.JobTypeVideoGenerate })
	for _, status := range []string{model.JobStatusFailed, model.JobStatusCanceled, model.JobStatusRunning, model.JobStatusQueued} {
		add(status, func(j *model.Job) { j.Status = status })
	}
	add("empty", func(j *model.Job) { j.Result = model.JSONB(`{"outputs":[]}`) })
	// The count must not be truncated to a recent-jobs page size.
	const historicalJobs = 125
	for i := 0; i < historicalJobs; i++ {
		add(fmt.Sprintf("history_%d", i), nil)
	}
	got, err := repo.CountImageOutputsInRange(context.Background(), user, start, end)
	if err != nil || got != 8+historicalJobs {
		t.Fatalf("image count = %d, err=%v; want %d", got, err, 8+historicalJobs)
	}
	if got, err := repo.CountImageOutputsInRange(context.Background(), user+"_empty", start, end); err != nil || got != 0 {
		t.Fatalf("empty user count=%d err=%v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.CountImageOutputsInRange(ctx, user, start, end); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled request err=%v", err)
	}
}
