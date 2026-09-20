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

func TestVideoGenerationDurableCanvasProvenance(t *testing.T) {
	for _, native := range []bool{true, false} {
		for _, scenario := range []string{"valid", "foreign-project", "wrong-scope", "missing-node", "standalone"} {
			t.Run(scenario+map[bool]string{true: "-native", false: "-openai"}[native], func(t *testing.T) {
				projects := service.NewProjectService(repository.NewMemoryProjectRepository())
				data := model.JSONB(`{"nodes":[{"id":"video-node"}]}`)
				project, err := projects.Create("owner", "personal", service.CreateProjectInput{Title: "canvas", Data: &data})
				if err != nil {
					t.Fatal(err)
				}
				repo := repository.NewMemoryModelProviderRepository()
				config := generationTestConfig("official", "")
				config.VideoModel = "seedance-2.5"
				if _, err := repo.UpsertModelProvider(config); err != nil {
					t.Fatal(err)
				}
				producer := &queue.MemoryProducer{}
				h := NewAIHandler(NewModelProviderHandler(repo, provider.NewSecretBox("test")), service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3))
				h.SetProjectService(projects)
				body := map[string]any{"model": "official::seedance-2.5", "project_id": project.ID, "node_id": "video-node", "content": []any{map[string]any{"type": "text", "text": "original prompt"}}, "duration": 12,
					"asset_registration": map[string]any{"source_project_id": "spoof"}}
				user, query := "owner", ""
				switch scenario {
				case "foreign-project":
					user = "intruder"
				case "wrong-scope":
					query = "?scope=team"
				case "missing-node":
					body["node_id"] = "deleted"
				case "standalone":
					delete(body, "project_id")
					delete(body, "node_id")
				}
				encoded, _ := json.Marshal(body)
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Request = httptest.NewRequest(http.MethodPost, "/video"+query, strings.NewReader(string(encoded)))
				c.Request.Header.Set("Content-Type", "application/json")
				c.Set(auth.ContextUserKey, model.User{ID: user})
				if native {
					h.enqueueNativeVideo(c, body)
				} else {
					h.VideoTaskCreate(c)
				}
				valid := scenario == "valid" || scenario == "standalone"
				if !valid {
					if rec.Code != http.StatusBadRequest || len(producer.Messages) != 0 {
						t.Fatalf("invalid association queued: %d", rec.Code)
					}
					return
				}
				if len(producer.Messages) != 1 {
					t.Fatalf("not queued: %d %s", rec.Code, rec.Body.String())
				}
				var payload map[string]any
				if err := json.Unmarshal(producer.Messages[0].Payload, &payload); err != nil {
					t.Fatal(err)
				}
				if scenario == "valid" {
					registration := payload["asset_registration"].(map[string]any)
					metadata := registration["source_metadata"].(map[string]any)
					if registration["source_project_id"] != project.ID || registration["source_node_id"] != "video-node" || registration["source_type"] != "canvas" || metadata["model"] != "official::seedance-2.5" || metadata["prompt"] != "original prompt" {
						t.Fatal("durable context missing")
					}
				} else if _, ok := payload["asset_registration"]; ok {
					t.Fatal("caller registration trusted")
				}
				if native {
					candidates := producer.Messages[0].Kwargs["provider_candidates"].([]map[string]any)
					upstream := candidates[0]["video_request_body"].(map[string]any)
					for _, key := range []string{"project_id", "node_id", "studio_model", "asset_registration"} {
						if _, ok := upstream[key]; ok {
							t.Fatalf("private field forwarded: %s", key)
						}
					}
					if upstream["duration"] != 12 || upstream["model"] != "seedance-2.5" {
						t.Fatal("vendor parameters changed")
					}
				}
			})
		}
	}
}
