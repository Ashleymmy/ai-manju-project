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
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

// jobPublishTimeout bounds broker publication after the durable job exists,
// independent of a browser disconnect or an expired HTTP request deadline.
const jobPublishTimeout = 30 * time.Second

type JobService struct {
	repo        repository.JobRepository
	producer    queue.Producer
	queueName   string
	maxAttempts int
	jobInputs   *JobInputService
	assetUsage  interface {
		RecordGenerationUse(workspaceID string, userID string, jobID string, assetIDs []string) error
	}
	// billing is nil when BILLING_ENABLED is off: every billing call site must
	// nil-check so disabled deployments keep the exact pre-billing behavior.
	billing     JobBillingHooks
	dispatchBox *provider.SecretBox
}

func (s *JobService) SetJobInputService(jobInputs *JobInputService) {
	s.jobInputs = jobInputs
}

// SetBillingHooks wires credit reservation/settlement. Called only when
// cfg.BillingEnabled is true.
func (s *JobService) SetBillingHooks(hooks JobBillingHooks) {
	s.billing = hooks
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
	VideoBillingPolicy *VideoBillingPolicy
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
	UserID             string
	Scope              string
	Type               string
	ExternalProvider   string
	ExternalTaskID     string
	Payload            model.JSONB
	IdempotencyKey     string
	VideoBillingPolicy *VideoBillingPolicy
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
	jobID := "job_" + randomHex(12)
	payload := NormalizeJSON(&input.Payload)
	if s.billing != nil {
		normalized, err := s.billing.NormalizePayloadForJob(input.UserID, input.Type, payload)
		if err != nil {
			return EnqueueJobResult{}, err
		}
		payload = normalized
		if err := s.reserveJobCredits(input.UserID, input.Type, jobID, payload, input.VideoBillingPolicy); err != nil {
			return EnqueueJobResult{}, err
		}
	}
	job := model.Job{
		ID:               jobID,
		IdempotencyKey:   idempotencyKey,
		UserID:           input.UserID,
		WorkspaceID:      workspaceID,
		Type:             input.Type,
		Status:           model.JobStatusQueued,
		Payload:          payload,
		Result:           model.JSONB("{}"),
		Error:            model.JSONB("{}"),
		MaxAttempts:      s.maxAttempts,
		ExternalProvider: strings.TrimSpace(input.ExternalProvider),
		ExternalTaskID:   strings.TrimSpace(input.ExternalTaskID),
		ExternalStatus:   "queued",
		BridgeMetadata:   model.JSONB("{}"),
		BridgeState:      "pending",
	}
	created, err := s.createWithBillingAdmission(job)
	if err != nil {
		if s.billing != nil {
			s.billing.ReleaseForJob(jobID)
		}
		return EnqueueJobResult{}, err
	}
	if created.ID != job.ID && s.billing != nil {
		s.billing.ReleaseForJob(jobID)
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
	explicitKey := idempotencyKey
	if idempotencyKey == "" {
		fingerprintPayload := payload
		if len(input.IdempotencyPayload) > 0 && json.Valid(input.IdempotencyPayload) {
			fingerprintPayload = NormalizeJSON(&input.IdempotencyPayload)
		}
		idempotencyKey = fingerprintJob(input.UserID, workspaceID, input.Type, fingerprintPayload)
	} else {
		idempotencyKey = scopedExplicitJobKey(input.UserID, workspaceID, input.Type, idempotencyKey)
	}
	existing, existingErr := s.repo.GetByIdempotencyKey(idempotencyKey)
	if existingErr == nil && !jobMatchesScope(existing, input.UserID, workspaceID, input.Type) {
		return EnqueueJobResult{}, fmt.Errorf("idempotency key conflicts with another job scope")
	}
	if existingErr != nil && explicitKey != "" {
		// Older releases stored explicit keys verbatim. Only reuse those rows
		// when all ownership boundaries match; a shared client key is not identity.
		if legacy, err := s.repo.GetByIdempotencyKey(explicitKey); err == nil && jobMatchesScope(legacy, input.UserID, workspaceID, input.Type) {
			existing, existingErr = legacy, nil
		}
	}
	if existingErr == nil {
		if s.dispatchBox != nil && existing.DispatchState != "" {
			if err := s.dispatchJob(context.WithoutCancel(ctx), existing.ID); err != nil {
				log.Printf("job_id=%s event=job_dispatch_pending", existing.ID)
			}
			return EnqueueJobResult{Job: existing, Created: false}, nil
		}
		if input.RepublishExisting && existing.Status == model.JobStatusQueued {
			if s.producer == nil {
				return EnqueueJobResult{Job: existing, Created: false}, queue.ErrBrokerNotConfigured
			}
			if err := s.publishDurableJob(ctx, queue.TaskMessage{
				TaskName: taskNameForJobType(existing.Type), Queue: s.queueName, JobID: existing.ID,
				Payload: existing.Payload, Kwargs: normalizedVideoTaskKwargs(existing.Type, existing.Payload, input.TaskKwargs),
			}); err != nil {
				return EnqueueJobResult{Job: existing, Created: false}, err
			}
		}
		return EnqueueJobResult{Job: existing, Created: false}, nil
	}

	maxAttempts := s.maxAttempts
	if candidates, ok := input.TaskKwargs["provider_candidates"].([]map[string]any); ok && len(candidates) > 0 {
		maxAttempts = model.GenerationAttemptsPerProvider * len(candidates)
	}
	jobID := "job_" + randomHex(12)
	// 计费（WP-M3/M6）：先按会员权益归一化载荷（非会员视频强制水印），
	// 再并发准入 + 冻结。冻结失败（如余额不足/超并发）时不创建任务；
	// 建单/发布失败立即释放冻结，孤儿冻结由对账消费者兜底回收。
	if s.billing != nil {
		normalized, err := s.billing.NormalizePayloadForJob(input.UserID, input.Type, payload)
		if err != nil {
			return EnqueueJobResult{}, err
		}
		payload = normalized
		if err := s.reserveJobCredits(input.UserID, input.Type, jobID, payload, input.VideoBillingPolicy); err != nil {
			return EnqueueJobResult{}, err
		}
	}
	job := model.Job{
		ID:             jobID,
		IdempotencyKey: idempotencyKey,
		UserID:         input.UserID,
		WorkspaceID:    workspaceID,
		Type:           input.Type,
		Status:         model.JobStatusQueued,
		Payload:        payload,
		Result:         model.JSONB("{}"),
		Error:          model.JSONB("{}"),
		MaxAttempts:    maxAttempts,
		Progress:       0,
	}
	if err := s.prepareDispatch(&job, normalizedVideoTaskKwargs(job.Type, job.Payload, input.TaskKwargs)); err != nil {
		if s.billing != nil {
			s.billing.ReleaseForJob(job.ID)
		}
		return EnqueueJobResult{}, err
	}
	created, err := s.createWithBillingAdmission(job)
	if err != nil {
		if s.billing != nil {
			s.billing.ReleaseForJob(jobID)
		}
		return EnqueueJobResult{}, err
	}
	if created.ID != job.ID {
		// 并发下同幂等键已存在任务：冻结挂在未创建的幻影 job 上，立即释放。
		if s.billing != nil {
			s.billing.ReleaseForJob(jobID)
		}
		if !jobMatchesScope(created, input.UserID, workspaceID, input.Type) {
			return EnqueueJobResult{}, fmt.Errorf("idempotency key conflicts with another job scope")
		}
		return EnqueueJobResult{Job: created, Created: false}, nil
	}

	if s.dispatchBox != nil {
		if err := s.dispatchJob(context.WithoutCancel(ctx), created.ID); err != nil {
			log.Printf("job_id=%s event=job_dispatch_pending", created.ID)
		}
		if current, err := s.repo.GetByID(created.ID); err == nil {
			created = current
		}
	} else if s.producer == nil {
		if failed, setErr := s.repo.SetError(created.ID, errorJSON("queue producer is not configured")); setErr == nil {
			created = failed
		}
		if s.billing != nil {
			s.billing.ReleaseForJob(created.ID)
		}
		s.cleanupJobInputs(context.WithoutCancel(ctx), created)
		return EnqueueJobResult{Job: created, Created: true}, queue.ErrBrokerNotConfigured
	} else if err := s.publishDurableJob(ctx, queue.TaskMessage{
		TaskName: taskNameForJobType(created.Type),
		Queue:    s.queueName,
		JobID:    created.ID,
		Payload:  created.Payload,
		Kwargs:   normalizedVideoTaskKwargs(created.Type, created.Payload, input.TaskKwargs),
	}); err != nil {
		if failed, setErr := s.repo.SetError(created.ID, errorJSON(err.Error())); setErr == nil {
			created = failed
		}
		if s.billing != nil {
			s.billing.ReleaseForJob(created.ID)
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

func (s *JobService) publishDurableJob(ctx context.Context, message queue.TaskMessage) error {
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), jobPublishTimeout)
	defer cancel()
	return s.producer.Publish(publishCtx, message)
}

func (s *JobService) reserveJobCredits(userID, jobType, jobID string, payload model.JSONB, policy *VideoBillingPolicy) error {
	if hooks, ok := s.billing.(interface {
		ReserveForJobWithVideoPolicy(string, string, string, model.JSONB, *VideoBillingPolicy) error
	}); ok {
		return hooks.ReserveForJobWithVideoPolicy(userID, jobType, jobID, payload, policy)
	}
	return s.billing.ReserveForJob(userID, jobType, jobID, payload)
}

func jobMatchesScope(job model.Job, userID, workspaceID, jobType string) bool {
	return job.UserID == userID && job.WorkspaceID == workspaceID && job.Type == jobType
}

func scopedExplicitJobKey(userID, workspaceID, jobType, key string) string {
	hash := sha256.Sum256([]byte(strings.Join([]string{userID, workspaceID, jobType, key}, "\x00")))
	// Keep explicit keys in a separate namespace from payload fingerprints.
	return "idem_" + hex.EncodeToString(hash[:])
}

// normalizedVideoTaskKwargs carries the billed payload's watermark through
// every native provider request. Copy only modified maps so caller-owned
// provider/candidate maps (which may alias each other) are never mutated.
func normalizedVideoTaskKwargs(jobType string, payload model.JSONB, kwargs map[string]any) map[string]any {
	if jobType != model.JobTypeVideoGenerate || len(kwargs) == 0 {
		return kwargs
	}
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return kwargs
	}
	watermark, ok := body["watermark"].(bool)
	if !ok {
		return kwargs
	}
	clone := func(original map[string]any) map[string]any {
		copied := make(map[string]any, len(original))
		for key, value := range original {
			copied[key] = value
		}
		return copied
	}
	updateProvider := func(provider map[string]any) map[string]any {
		request, ok := provider["video_request_body"].(map[string]any)
		if !ok || request == nil {
			return provider
		}
		copied := clone(provider)
		request = clone(request)
		if provider["provider_type"] == model.ModelProviderTypeAliyunYike {
			parameters, _ := request["parameters"].(map[string]any)
			parameters = clone(parameters)
			parameters["watermark"] = watermark
			request["parameters"] = parameters
		} else {
			request["watermark"] = watermark
		}
		copied["video_request_body"] = request
		return copied
	}
	result := clone(kwargs)
	if provider, ok := kwargs["provider"].(map[string]any); ok {
		result["provider"] = updateProvider(provider)
	}
	switch candidates := kwargs["provider_candidates"].(type) {
	case []map[string]any:
		copied := make([]map[string]any, len(candidates))
		for i, candidate := range candidates {
			copied[i] = updateProvider(candidate)
		}
		result["provider_candidates"] = copied
	case []any:
		copied := append([]any(nil), candidates...)
		for i, candidate := range candidates {
			if provider, ok := candidate.(map[string]any); ok {
				copied[i] = updateProvider(provider)
			}
		}
		result["provider_candidates"] = copied
	}
	return result
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

func (s *JobService) createWithBillingAdmission(job model.Job) (model.Job, error) {
	if limits, ok := s.billing.(interface {
		ConcurrentLimitForJob(string, string) (int, error)
	}); ok {
		limit, err := limits.ConcurrentLimitForJob(job.UserID, job.Type)
		if err != nil {
			return model.Job{}, err
		}
		if limit > 0 {
			return s.repo.CreateWithinLimit(job, limit)
		}
	}
	return s.repo.Create(job)
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
		// 用户主动取消不扣费：已冻结的积分立即退回（对账消费者幂等兜底）。
		if err == nil && s.billing != nil && canceled.Status == model.JobStatusCanceled {
			s.billing.ReleaseForJob(id)
		}
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
	if s.billing != nil && canceled.Status == model.JobStatusCanceled {
		s.billing.ReleaseForJob(id)
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
