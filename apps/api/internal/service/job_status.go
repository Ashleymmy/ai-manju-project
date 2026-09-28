package service

import (
	"context"
	"fmt"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func (s *JobService) GetStatusForUser(ctx context.Context, id, userID string) (model.Job, error) {
	reader, ok := s.repo.(repository.JobStatusReader)
	if !ok {
		return model.Job{}, fmt.Errorf("job status reader unavailable")
	}
	return reader.GetStatusForUser(ctx, id, userID)
}

func (s *JobService) ListStatusesForUser(ctx context.Context, userID string, filter repository.JobStatusFilter) ([]model.Job, error) {
	reader, ok := s.repo.(repository.JobStatusReader)
	if !ok {
		return nil, fmt.Errorf("job status reader unavailable")
	}
	return reader.ListStatusesForUser(ctx, userID, filter)
}
