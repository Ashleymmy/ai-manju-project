package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

func TestGenerationRecoveryAdminBoundaryAndStrictInput(t *testing.T) {
	f := newAdminBillingFixture(t)
	repo := repository.NewMemoryJobRepository()
	producer := &queue.MemoryProducer{}
	svc := service.NewJobService(repo, producer, "celery", 3)
	authService := auth.NewService(f.userRepo, config.Config{})
	RegisterGenerationRecovery(f.router.Group("/api/admin", middleware.RequireAdmin(authService), middleware.AdminAudit(f.auditRepo)), svc)
	_, err := repo.Create(model.Job{ID: "private-job", UserID: "owner", Type: model.JobTypeVideoGenerate,
		Status: model.JobStatusQueued, Payload: model.JSONB(`{"secret":"private-input"}`),
		DispatchCiphertext: "private-ciphertext", BridgeMetadata: model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"accepted","provider_identity":"private-identity","provider_task_id":"original-task","response":{"url":"private-signed-url"}}}`)})
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []struct {
		name        string
		read, write int
	}{
		{"", 401, 401}, {"member", 403, 403}, {"auditor", 200, 403}, {"ops", 200, 409}, {"admin", 200, 409},
	} {
		t.Run(account.name, func(t *testing.T) {
			var cookie *http.Cookie
			if account.name != "" {
				cookie = loginCookie(t, f.router, account.name, "secret")
			}
			read := performJSON(f.router, http.MethodGet, "/api/admin/generation-recovery?limit=500&offset=-1", "", cookie)
			if read.Code != account.read {
				t.Fatalf("read=%d want %d", read.Code, account.read)
			}
			if read.Code == 200 {
				data := decodeAdminDataMap(t, read.Body.String())
				if data["limit"] != float64(30) || data["offset"] != float64(0) {
					t.Fatal("pagination not normalized")
				}
				for _, secret := range []string{"private-input", "private-ciphertext", "private-identity", "private-signed-url"} {
					if strings.Contains(read.Body.String(), secret) {
						t.Fatal("private recovery field escaped")
					}
				}
			}
			write := performJSON(f.router, http.MethodPost, "/api/admin/generation-recovery/private-job/resume", `{"expected_revision":2}`, cookie)
			if write.Code != account.write {
				t.Fatalf("write=%d want %d", write.Code, account.write)
			}
		})
	}
	cookie := loginCookie(t, f.router, "ops", "secret")
	for _, body := range []string{`{}`, `{"expected_revision":0}`, `{"expected_revision":2,"provider":{}}`, `{"expected_revision":2} {}`, `{"expected_revision":2.5}`, `{"expected_revision":2,"x":"` + strings.Repeat("a", 1100) + `"}`} {
		got := performJSON(f.router, http.MethodPost, "/api/admin/generation-recovery/private-job/resume", body, cookie)
		if got.Code != 400 {
			t.Fatalf("invalid request accepted: %d", got.Code)
		}
	}
	if len(producer.Messages) != 0 {
		t.Fatal("unsafe recovery published work")
	}
}
