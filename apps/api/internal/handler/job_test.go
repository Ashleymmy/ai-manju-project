package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestJobHandlerCreateIsIdempotent(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router := newJobTestRouter(producer)

	first := performJobRequest(router, `{"type":"image.generate","payload":{"prompt":"same"}}`, "idem-key")
	if first.Code != http.StatusAccepted {
		t.Fatalf("first status = %d, body = %s", first.Code, first.Body.String())
	}
	second := performJobRequest(router, `{"type":"image.generate","payload":{"prompt":"same"}}`, "idem-key")
	if second.Code != http.StatusAccepted {
		t.Fatalf("second status = %d, body = %s", second.Code, second.Body.String())
	}

	firstID := extractJobID(t, first.Body.Bytes())
	secondID := extractJobID(t, second.Body.Bytes())
	if firstID != secondID {
		t.Fatalf("job ids = %q, %q", firstID, secondID)
	}
	if len(producer.Messages) != 1 {
		t.Fatalf("published messages = %d, want 1", len(producer.Messages))
	}
}

func TestJobHandlerCancelMarksQueuedJobCanceled(t *testing.T) {
	router := newJobTestRouter(&queue.MemoryProducer{})

	created := performJobRequest(router, `{"type":"image.generate","payload":{"prompt":"cancel-me"}}`, "cancel-key")
	if created.Code != http.StatusAccepted {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	jobID := extractJobID(t, created.Body.Bytes())

	request := httptest.NewRequest(http.MethodPost, "/jobs/"+jobID+"/cancel", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var parsed struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Data.Status != model.JobStatusCanceled {
		t.Fatalf("status = %q, want %q", parsed.Data.Status, model.JobStatusCanceled)
	}
}

func TestJobHandlerListFiltersWorkspaceStatusAndLimit(t *testing.T) {
	router := newJobTestRouter(&queue.MemoryProducer{})
	personalA := performJobRequest(router, `{"type":"image.generate","scope":"personal","payload":{"prompt":"a"}}`, "list-personal-a")
	personalB := performJobRequest(router, `{"type":"image.edit","scope":"personal","payload":{"prompt":"b"}}`, "list-personal-b")
	team := performJobRequest(router, `{"type":"image.generate","scope":"team","payload":{"prompt":"team"}}`, "list-team")
	for _, recorder := range []*httptest.ResponseRecorder{personalA, personalB, team} {
		if recorder.Code != http.StatusAccepted {
			t.Fatalf("create status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/jobs?scope=personal&status=queued&limit=1", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var personalBody struct {
		Data []struct {
			ID     string `json:"id"`
			Scope  string `json:"scope"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &personalBody); err != nil {
		t.Fatal(err)
	}
	if len(personalBody.Data) != 1 || personalBody.Data[0].Scope != WorkspaceScopePersonal || personalBody.Data[0].Status != model.JobStatusQueued {
		t.Fatalf("personal jobs = %#v", personalBody.Data)
	}

	request = httptest.NewRequest(http.MethodGet, "/jobs?scope=team&type=image.generate&limit=100", nil)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	var teamBody struct {
		Data []struct {
			ID    string `json:"id"`
			Scope string `json:"scope"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &teamBody); err != nil {
		t.Fatal(err)
	}
	if len(teamBody.Data) != 1 || teamBody.Data[0].Scope != WorkspaceScopeTeam || teamBody.Data[0].ID != extractJobID(t, team.Body.Bytes()) {
		t.Fatalf("team jobs = %#v", teamBody.Data)
	}
}
func newJobTestRouter(producer queue.Producer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{
			ID:          "user_job_test",
			Username:    "job-test",
			DisplayName: "Job Test",
			Role:        model.UserRoleMember,
			Status:      model.UserStatusActive,
		})
		c.Next()
	})
	handler := NewJobHandler(service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3))
	router.POST("/jobs", handler.Create)
	router.GET("/jobs", handler.List)
	router.GET("/jobs/:id", handler.Get)
	router.POST("/jobs/:id/cancel", handler.Cancel)
	return router
}

func performJobRequest(router *gin.Engine, body string, idempotencyKey string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/jobs", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", idempotencyKey)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func extractJobID(t *testing.T, body []byte) string {
	t.Helper()
	var parsed struct {
		Data struct {
			JobID string `json:"job_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Data.JobID == "" {
		t.Fatalf("empty job_id in body: %s", body)
	}
	return parsed.Data.JobID
}
