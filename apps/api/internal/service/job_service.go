package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

type JobService struct {
	repo        repository.JobRepository
	producer    queue.Producer
	queueName   string
	maxAttempts int
	jobInputs   *JobInputService
	assetUsage  interface {
		RecordGenerationUse(workspaceID string, userID string, jobID string, assetIDs []string) error
	}
}

func (s *JobService) SetJobInputService(jobInputs *JobInputService) {
	s.jobInputs = jobInputs
}

func (s *JobService) SetAssetUsageRecorder(recorder interface {
	RecordGenerationUse(workspaceID string, userID string, jobID string, assetIDs []string) error
}) {
	s.assetUsage = recorder
}

func NewJobService(repo repository.JobRepository, producer queue.Producer, queueName string, maxAttempts int) *JobService {
	if maxAttempts <= 0 {
		maxAttempts = 3
	}
	if strings.TrimSpace(queueName) == "" {
		queueName = "celery"
	}
	return &JobService{repo: repo, producer: producer, queueName: queueName, maxAttempts: maxAttempts}
}

type EnqueueJobInput struct {
	UserID  string
	Scope   string
	Type    string
	Payload model.JSONB
	// IdempotencyPayload omits request-local storage keys while retaining stable
	// file hashes, so staged multipart uploads preserve implicit idempotency.
	IdempotencyPayload model.JSONB
	TaskKwargs         map[string]any
	IdempotencyKey     string
	// RepublishExisting is reserved for durable server-side schedulers that
	// recover a crash between creating the Job row and publishing to Celery.
	// The Job ID remains stable and workers serialize duplicate deliveries.
	RepublishExisting bool
}

type EnqueueJobResult struct {
	Job     model.Job
	Created bool
}

type ExternalJobInput struct {
	UserID           string
	Scope            string
	Type             string
	ExternalProvider string
	ExternalTaskID   string
	Payload          model.JSONB
	IdempotencyKey   string
}

// CreateExternal records a bridge job without publishing it to the Studio
// worker queue. The external service owns execution; Studio workers only
// reconcile the external task and import its result asset.
func (s *JobService) CreateExternal(input ExternalJobInput) (EnqueueJobResult, error) {
	workspaceID := WorkspaceIDForScope(input.Scope, input.UserID)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = fingerprintJob(input.UserID, workspaceID, input.Type, NormalizeJSON(&input.Payload))
	}
	// 外部请求的幂等键不可跨用户或空间复用。
	idempotencyKey = fingerprintJob(input.UserID, workspaceID, input.Type, model.JSONB(idempotencyKey))
	if existing, err := s.repo.GetByIdempotencyKey(idempotencyKey); err == nil {
		return EnqueueJobResult{Job: existing, Created: false}, nil
	}
	job := model.Job{
		ID:               "job_" + randomHex(12),
		IdempotencyKey:   idempotencyKey,
		UserID:           input.UserID,
		WorkspaceID:      workspaceID,
		Type:             input.Type,
		Status:           model.JobStatusQueued,
		Payload:          NormalizeJSON(&input.Payload),
		Result:           model.JSONB("{}"),
		Error:            model.JSONB("{}"),
		MaxAttempts:      s.maxAttempts,
		ExternalProvider: strings.TrimSpace(input.ExternalProvider),
		ExternalTaskID:   strings.TrimSpace(input.ExternalTaskID),
		ExternalStatus:   "queued",
		BridgeMetadata:   model.JSONB("{}"),
		BridgeState:      "pending",
	}
	created, err := s.repo.Create(job)
	if err != nil {
		return EnqueueJobResult{}, err
	}
	return EnqueueJobResult{Job: created, Created: created.ID == job.ID}, nil
}

func (s *JobService) UpdateExternalState(id string, provider string, externalTaskID string, status string, metadata model.JSONB) (model.Job, error) {
	return s.repo.SetExternalState(id, provider, externalTaskID, status, metadata)
}

func (s *JobService) UpdateExternalProgress(id string, provider string, externalTaskID string, status string, progress int, metadata model.JSONB) (model.Job, error) {
	return s.repo.SetExternalProgress(id, provider, externalTaskID, status, progress, metadata)
}

func (s *JobService) SetResult(id string, result model.JSONB) (model.Job, error) {
	return s.repo.SetResult(id, result)
}

func (s *JobService) SetError(id string, errorPayload model.JSONB) (model.Job, error) {
	return s.repo.SetError(id, errorPayload)
}

func (s *JobService) GetExternalForUser(provider string, externalTaskID string, userID string) (model.Job, error) {
	return s.repo.GetByExternalTaskID(provider, externalTaskID, userID)
}

// 运维核对只授权全局超级管理员，绝不从浏览器接受目标身份或目标服务地址。
func (s *JobService) GetSDVideoForAdmin(id string, actor model.User) (model.Job, error) {
	if actor.Role != model.UserRoleSuperAdmin {
		return model.Job{}, repository.ErrJobNotFound
	}
	job, err := s.repo.GetByID(id)
	if err != nil || job.ExternalProvider != "sd-video" || job.ExternalTaskID == "" {
		return model.Job{}, repository.ErrJobNotFound
	}
	return job, nil
}

func (s *JobService) WakeSDVideoReconciliation(id string, now time.Time) error {
	return s.repo.WithExternalLock(context.Background(), id, func() error {
		job, err := s.repo.GetByID(id)
		if err != nil {
			return err
		}
		if repository.IsUncertainSubmission(job) {
			return s.repo.DelayBridge(id, now)
		}
		return nil
	})
}

// ListExternalPending returns durable bridge jobs that still need a remote
// status check.  The repository applies the provider/status scope so a bridge
// worker never scans ordinary Studio jobs or terminal rows.
func (s *JobService) ListExternalPending(provider string, statuses []string, limit int) ([]model.Job, error) {
	return s.repo.ListByExternal(strings.TrimSpace(provider), statuses, limit)
}

func (s *JobService) Enqueue(ctx context.Context, input EnqueueJobInput) (EnqueueJobResult, error) {
	payload := NormalizeJSON(&input.Payload)
	workspaceID := WorkspaceIDForScope(input.Scope, input.UserID)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if idempotencyKey == "" {
		fingerprintPayload := payload
		if len(input.IdempotencyPayload) > 0 && json.Valid(input.IdempotencyPayload) {
			fingerprintPayload = NormalizeJSON(&input.IdempotencyPayload)
		}
		idempotencyKey = fingerprintJob(input.UserID, workspaceID, input.Type, fingerprintPayload)
	}
	if existing, err := s.repo.GetByIdempotencyKey(idempotencyKey); err == nil {
		if input.RepublishExisting && existing.Status == model.JobStatusQueued {
			if s.producer == nil {
				return EnqueueJobResult{Job: existing, Created: false}, queue.ErrBrokerNotConfigured
			}
			if err := s.producer.Publish(ctx, queue.TaskMessage{
				TaskName: taskNameForJobType(existing.Type), Queue: s.queueName, JobID: existing.ID,
				Payload: existing.Payload, Kwargs: input.TaskKwargs,
			}); err != nil {
				return EnqueueJobResult{Job: existing, Created: false}, err
			}
		}
		return EnqueueJobResult{Job: existing, Created: false}, nil
	}

	job := model.Job{
		ID:             "job_" + randomHex(12),
		IdempotencyKey: idempotencyKey,
		UserID:         input.UserID,
		WorkspaceID:    workspaceID,
		Type:           input.Type,
		Status:         model.JobStatusQueued,
		Payload:        payload,
		Result:         model.JSONB("{}"),
		Error:          model.JSONB("{}"),
		MaxAttempts:    s.maxAttempts,
		Progress:       0,
	}
	created, err := s.repo.Create(job)
	if err != nil {
		return EnqueueJobResult{}, err
	}
	if created.ID != job.ID {
		return EnqueueJobResult{Job: created, Created: false}, nil
	}

	if s.producer == nil {
		if failed, setErr := s.repo.SetError(created.ID, errorJSON("queue producer is not configured")); setErr == nil {
			created = failed
		}
		s.cleanupJobInputs(context.WithoutCancel(ctx), created)
		return EnqueueJobResult{Job: created, Created: true}, queue.ErrBrokerNotConfigured
	}
	if err := s.producer.Publish(ctx, queue.TaskMessage{
		TaskName: taskNameForJobType(created.Type),
		Queue:    s.queueName,
		JobID:    created.ID,
		Payload:  created.Payload,
		Kwargs:   input.TaskKwargs,
	}); err != nil {
		if failed, setErr := s.repo.SetError(created.ID, errorJSON(err.Error())); setErr == nil {
			created = failed
		}
		s.cleanupJobInputs(context.WithoutCancel(ctx), created)
		return EnqueueJobResult{Job: created, Created: true}, err
	}
	if s.assetUsage != nil {
		if usageErr := s.assetUsage.RecordGenerationUse(created.WorkspaceID, created.UserID, created.ID, jobParentAssetIDs(created.Payload)); usageErr != nil {
			log.Printf("job_id=%s event=asset_usage_record_failed reason=%q", created.ID, usageErr.Error())
		}
	}
	return EnqueueJobResult{Job: created, Created: true}, nil
}

func (s *JobService) GetForUser(id string, userID string) (model.Job, error) {
	job, err := s.repo.GetByID(id)
	if err != nil {
		return model.Job{}, err
	}
	if job.UserID != userID {
		return model.Job{}, repository.ErrJobNotFound
	}
	return job, nil
}

func (s *JobService) CancelForUser(id string, userID string) (model.Job, error) {
	job, err := s.GetForUser(id, userID)
	if err != nil {
		return model.Job{}, err
	}
	if job.ExternalProvider == "sd-video" {
		var canceled model.Job
		err := s.repo.WithExternalLock(context.Background(), id, func() error {
			current, err := s.GetForUser(id, userID)
			if err != nil {
				return err
			}
			uncertain := repository.IsUncertainSubmission(current)
			if current.Status == model.JobStatusSucceeded || (current.Status == model.JobStatusFailed && !uncertain) || current.Status == model.JobStatusCanceled {
				canceled = current
				return nil
			}
			canceled, err = s.repo.UpdateStatus(id, model.JobStatusCanceled)
			if err == nil && uncertain {
				err = s.repo.SetBridgeState(id, "pending")
				if err == nil {
					err = s.repo.DelayBridge(id, time.Now().UTC())
				}
			}
			return err
		})
		return canceled, err
	}
	if job.Status == model.JobStatusSucceeded || job.Status == model.JobStatusFailed || job.Status == model.JobStatusCanceled {
		s.cleanupJobInputs(context.Background(), job)
		return job, nil
	}
	canceled, err := s.repo.UpdateStatus(id, model.JobStatusCanceled)
	if err != nil {
		return model.Job{}, err
	}
	s.cleanupJobInputs(context.Background(), canceled)
	return canceled, nil
}

func (s *JobService) cleanupJobInputs(ctx context.Context, job model.Job) {
	if s.jobInputs == nil {
		return
	}
	if cleanupErr := s.jobInputs.CleanupPayload(context.WithoutCancel(ctx), job.WorkspaceID, job.Payload); cleanupErr != nil {
		log.Printf("job_id=%s event=staged_input_cleanup_failed reason=%q", job.ID, cleanupErr.Error())
	}
}

func (s *JobService) ListForUser(userID string) ([]model.Job, error) {
	return s.repo.ListByUser(userID)
}

func fingerprintJob(userID string, workspaceID string, jobType string, payload model.JSONB) string {
	hash := sha256.Sum256([]byte(strings.Join([]string{userID, workspaceID, jobType, string(payload)}, "\x00")))
	return "fp_" + hex.EncodeToString(hash[:])
}

func taskNameForJobType(jobType string) string {
	switch jobType {
	case model.JobTypeImageEdit:
		return "worker.image_edit"
	case model.JobTypeVideoGenerate:
		return "worker.video_generate"
	case model.JobTypeVideoTranscode:
		return "worker.video_transcode"
	default:
		return "worker.image_generate"
	}
}

func errorJSON(message string) model.JSONB {
	data, err := json.Marshal(map[string]any{"message": strings.TrimSpace(message)})
	if err != nil {
		return model.JSONB(fmt.Sprintf(`{"message":%q}`, message))
	}
	return model.JSONB(data)
}

func jobParentAssetIDs(payload model.JSONB) []string {
	var root map[string]any
	if json.Unmarshal(payload, &root) != nil {
		return nil
	}
	registration, _ := root["asset_registration"].(map[string]any)
	values, _ := registration["parent_asset_ids"].([]any)
	result := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		assetID := strings.TrimSpace(fmt.Sprint(value))
		if assetID != "" && !seen[assetID] {
			seen[assetID] = true
			result = append(result, assetID)
		}
	}
	return result
}
