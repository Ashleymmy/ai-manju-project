package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func accessVideoProvider(id string, restricted bool) model.ModelProviderConfig {
	config := generationTestConfig(id, "")
	config.VideoModel = "ep-fast"
	config.Capabilities = mustProviderJSONB([]string{"video"})
	config.ModelsByCapability = mustProviderJSONB(map[string][]string{"video": {"ep-fast", "ep-mini", "ep-2", "ep-25"}})
	config.DefaultFor = mustProviderJSONB([]string{"video"})
	if restricted {
		config.ModelAliases = mustProviderJSONB(map[string]string{"ep-fast": "（MT版权）seedance-2.0-fast"})
		config.AllowedUserIDs = model.JSONB(`["allowed"]`)
	}
	return config
}

func TestProviderAccessCatalogAndVideoSubmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, id, role string
		allowed        bool
	}{
		{"whitelisted", "allowed", model.UserRoleMember, true},
		{"super admin", "boss", model.UserRoleSuperAdmin, true},
		{"member", "other", model.UserRoleMember, false},
		{"ops admin", "ops", model.UserRoleOpsAdmin, false},
		{"auditor", "audit", model.UserRoleAuditor, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := repository.NewMemoryModelProviderRepository()
			_, _ = repo.UpsertModelProvider(accessVideoProvider("private", true))
			_, _ = repo.UpsertModelProvider(accessVideoProvider("public", false))
			producer := &queue.MemoryProducer{}
			h := NewModelProviderHandler(repo, provider.NewSecretBox("test"))
			ai := NewAIHandler(h, service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3))
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, model.User{ID: tc.id, Role: tc.role}); c.Next() })
			router.GET("/models", func(c *gin.Context) { h.AggregatedModelsWithSDVideo(c, nil) })
			router.POST("/native", ai.SeedanceTaskCreate)
			router.POST("/videos", ai.VideoTaskCreate)
			router.GET("/legacy/:id", ai.SeedanceTaskGet)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/models", nil))
			if rec.Code != 200 {
				t.Fatalf("catalog %d %s", rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "private::") != tc.allowed {
				t.Fatalf("wrong catalog %s", rec.Body.String())
			}
			if !tc.allowed && strings.Contains(rec.Body.String(), "MT版权") {
				t.Fatal("label leaked")
			}
			for _, route := range []string{"/native", "/videos"} {
				for _, mid := range []string{"ep-fast", "ep-mini", "ep-2", "ep-25"} {
					before := len(producer.Messages)
					req := httptest.NewRequest(http.MethodPost, route, strings.NewReader(`{"model":"private::`+mid+`","prompt":"test"}`))
					req.Header.Set("Content-Type", "application/json")
					rec = httptest.NewRecorder()
					router.ServeHTTP(rec, req)
					if tc.allowed {
						if rec.Code != 200 && rec.Code != 202 {
							t.Fatalf("allowed request %d %s", rec.Code, rec.Body.String())
						}
					} else if rec.Code != 403 || len(producer.Messages) != before {
						t.Fatalf("denied request %d messages=%d", rec.Code, len(producer.Messages))
					}
				}
			}
			if !tc.allowed {
				rec = httptest.NewRecorder()
				router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/legacy/remote-id?model=private::ep-fast", nil))
				if rec.Code != 403 {
					t.Fatalf("legacy access %d", rec.Code)
				}
			}
			// A bare name and public/default routing must never inject the restricted supplier as failover.
			for _, selector := range []string{"ep-fast", "public::ep-fast", ""} {
				candidates, err := h.forUser(model.User{ID: tc.id, Role: tc.role}).generationCandidates(model.ModelCapabilityVideo, selector)
				if err != nil {
					t.Fatal(err)
				}
				for _, candidate := range candidates {
					if !tc.allowed && candidate.Config.ID == "private" {
						t.Fatal("restricted fallback")
					}
				}
			}
		})
	}
}

func TestRestrictedDefaultDoesNotLeakWhenNoPublicProviders(t *testing.T) {
	repo := repository.NewMemoryModelProviderRepository()
	_, _ = repo.UpsertModelProvider(accessVideoProvider(model.ModelProviderIDDefault, true))
	h := NewModelProviderHandler(repo, provider.NewSecretBox("test"))
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Set(auth.ContextUserKey, model.User{ID: "other"})
	h.AggregatedModels(c)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "ep-fast") {
		t.Fatalf("catalog: %s", rec.Body.String())
	}
	// Policy is not portable and cannot be overwritten from a provider JSON document.
	saved, _ := repo.GetModelProvider(model.ModelProviderIDDefault)
	raw, _ := json.Marshal(modelProviderResponse(saved))
	if strings.Contains(string(raw), "allowed_user_ids") {
		t.Fatal("operator policy leaked into editable config")
	}
}
