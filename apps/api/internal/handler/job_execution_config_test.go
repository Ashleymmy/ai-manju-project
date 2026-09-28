package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type rejectedJobBilling struct{ calls int }

func (b *rejectedJobBilling) NormalizePayloadForJob(_ string, _ string, payload model.JSONB) (model.JSONB, error) {
	b.calls++
	return payload, nil
}

func (b *rejectedJobBilling) ReserveForJob(string, string, string, model.JSONB) error {
	b.calls++
	return nil
}

func (b *rejectedJobBilling) ReleaseForJob(string) { b.calls++ }

func TestJobHandlerRejectsClientExecutionConfigurationBeforeBilling(t *testing.T) {
	for _, field := range []string{
		"provider", "_provider_candidates", "provider_candidates", "provider_candidates_extra",
		"video_request_body", "generation_soft_timeout_seconds", "generation_attempt", "task_kwargs", "_task_kwargs",
	} {
		t.Run(field, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.Use(middleware.RequestID())
			router.Use(func(c *gin.Context) {
				c.Set(auth.ContextUserKey, model.User{ID: "a", Role: model.UserRoleMember, Status: model.UserStatusActive})
			})
			repo := repository.NewMemoryJobRepository()
			producer := &queue.MemoryProducer{}
			billing := &rejectedJobBilling{}
			svc := service.NewJobService(repo, producer, "celery", 3)
			svc.SetBillingHooks(billing)
			router.POST("/jobs", NewJobHandler(svc).Create)
			body, err := json.Marshal(map[string]any{"type": model.JobTypeVideoGenerate, "payload": map[string]any{"prompt": "safe", field: nil}})
			if err != nil {
				t.Fatal(err)
			}
			response := performJobRequest(router, string(body), "private-fields")
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			jobs, err := repo.ListByUser("a")
			if err != nil || len(jobs) != 0 || len(producer.Messages) != 0 || billing.calls != 0 {
				t.Fatalf("rejected payload had side effects: jobs=%d published=%d billing=%d err=%v", len(jobs), len(producer.Messages), billing.calls, err)
			}
			var envelope struct {
				Success   bool   `json:"success"`
				RequestID string `json:"request_id"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.Success || envelope.RequestID == "" {
				t.Fatalf("invalid error envelope: %s", response.Body.String())
			}
		})
	}
}

func TestJobHandlerAllowsPublicVideoPayload(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router := newJobTestRouter(producer)
	response := performJobRequest(router, `{"type":"video.generate","payload":{"model":"public-model","prompt":"provider and video_request_body are words","duration":5,"watermark":true,"content":[{"type":"text","text":"test"}]}}`, "public-video")
	if response.Code != http.StatusAccepted || len(producer.Messages) != 1 {
		t.Fatalf("public payload rejected: status=%d body=%s", response.Code, response.Body.String())
	}
}
