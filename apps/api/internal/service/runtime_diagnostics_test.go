package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestMonitoringFinalJobUsesOnlyOwnersLatestAttempt(t *testing.T) {
	jobs, calls := repository.NewMemoryJobRepository(), repository.NewMemoryMonitoringRepository()
	repo := repository.NewRuntimeMonitoringRepository(jobs, calls)
	now := time.Now()
	_, _ = jobs.Create(model.Job{ID: "job", UserID: "alice", IdempotencyKey: "job", Status: model.JobStatusFailed, FinishedAt: &now, Error: model.JSONB(`{"message":"生成失败"}`)})
	for _, e := range []model.RuntimeError{
		{ID: "old", UserID: "alice", Source: "worker", JobID: "job", CreatedAt: now.Add(-time.Minute), Diagnostics: model.JSONB(`{"provider_body":"old failure"}`)},
		{ID: "current", UserID: "alice", Source: "worker", JobID: "job", CreatedAt: now.Add(-time.Second), ProviderStatus: 422, Diagnostics: model.JSONB(`{"stage":"provider_response","provider_body":"actual private failure","provider_request_id":"vendor-id"}`)},
		{ID: "other-owner", UserID: "bob", Source: "worker", JobID: "job", CreatedAt: now, Diagnostics: model.JSONB(`{"provider_body":"wrong owner"}`)},
	} {
		if err := repo.Record(context.Background(), e); err != nil {
			t.Fatal(err)
		}
	}
	s := NewRuntimeMonitoringService(repo, repository.NewMemoryUserRepository())
	for _, admin := range []bool{true, false} {
		report, err := s.Report(context.Background(), MonitoringFilter{Start: now.Add(-time.Hour), End: now.Add(time.Hour), UserID: "alice", Admin: admin, Page: 1, PageSize: 30})
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range report.Items {
			if !admin && !row.DiagnosticsRestricted {
				t.Fatal("missing restricted diagnostic indication", row)
			}
			if !admin && (len(row.Diagnostics) > 0 || row.ProviderStatus != 0) {
				t.Fatal("private data leaked", row)
			}
			if admin && row.Source == "job" && (!strings.Contains(string(row.Diagnostics), "actual private failure") || row.ProviderStatus != 422 || strings.Contains(string(row.Diagnostics), "wrong owner")) {
				t.Fatal(row)
			}
		}
	}
}
