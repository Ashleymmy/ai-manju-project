package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func monitoringFixture(t *testing.T) (*RuntimeMonitoringHandler, repository.RuntimeMonitoringRepository) {
	t.Helper()
	users := repository.NewMemoryUserRepository()
	jobs := repository.NewMemoryJobRepository()
	calls := repository.NewMemoryMonitoringRepository()
	repo := repository.NewRuntimeMonitoringRepository(jobs, calls)
	for _, id := range []string{"alice", "bob"} {
		_, _ = users.CreateUser(model.User{ID: id, Username: id, Role: model.UserRoleMember})
		_ = repo.Record(context.Background(), model.RuntimeError{ID: id, UserID: id, Source: "worker", Message: id + " failed", Detail: "private diagnostic", CreatedAt: time.Now().Add(-time.Minute)})
	}
	_ = repo.Record(context.Background(), model.RuntimeError{ID: "system", Source: "api", Message: "system failed", CreatedAt: time.Now().Add(-time.Minute)})
	_ = repo.Record(context.Background(), model.RuntimeError{ID: "old", UserID: "alice", Source: "api", Message: "outside window", CreatedAt: time.Now().Add(-48 * time.Hour)})
	finished := time.Now().Add(-time.Minute)
	_, _ = jobs.Create(model.Job{ID: "job1", UserID: "alice", Type: "video.generate", Status: model.JobStatusSucceeded, FinishedAt: &finished, IdempotencyKey: "job1", Payload: model.JSONB(`{"model":"test","asset_registration":{"source_node_id":"node1","source_project_id":"proj1"}}`)})
	_ = calls.CreateAIRequestLog(model.AIRequestLog{ID: "ack", UserID: "alice", Operation: "image_generation", Status: model.AIRequestStatusSuccess, CreatedAt: time.Now()})
	return NewRuntimeMonitoringHandler(repo, users), repo
}
func monitoringRequest(h *RuntimeMonitoringHandler, user model.User, method, path, body string) *httptest.ResponseRecorder {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if user.ID != "" {
			c.Set(auth.ContextUserKey, user)
		}
		c.Next()
	})
	r.GET("/api/monitoring", h.Get)
	r.GET("/api/monitoring/users", h.Users)
	r.POST("/api/monitoring/client-errors", h.ClientError)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}
func TestRuntimeMonitoringScopeAndExport(t *testing.T) {
	h, _ := monitoringFixture(t)
	for _, role := range []string{model.UserRoleMember, model.UserRoleOpsAdmin, model.UserRoleAuditor} {
		user := model.User{ID: "alice", Role: role}
		w := monitoringRequest(h, user, "GET", "/api/monitoring", "")
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var response struct {
			Data service.MonitoringReport `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &response)
		report := response.Data
		if report.Total != 2 || report.Stats.Errors != 1 || report.Stats.Successes != 1 || report.CanViewAll {
			t.Fatalf("bad scope: %+v", report)
		}
		for _, row := range report.Items {
			if row.UserID != "alice" || row.Detail != "" {
				t.Fatalf("leak: %+v", row)
			}
			if row.Source == "job" && row.NodeID != "node1" {
				t.Fatal("missing nested correlation")
			}
		}
		for _, path := range []string{"/api/monitoring?user_id=bob", "/api/monitoring?user_id=bob&export=csv", "/api/monitoring/users"} {
			if got := monitoringRequest(h, user, "GET", path, ""); got.Code != 403 {
				t.Fatalf("not forbidden: %s", path)
			}
		}
		exported := monitoringRequest(h, user, "GET", "/api/monitoring?export=csv", "")
		if strings.Contains(exported.Body.String(), "bob") || strings.Contains(exported.Body.String(), "private diagnostic") {
			t.Fatal("CSV leaked another user or private detail")
		}
	}
	admin := model.User{ID: "admin", Role: model.UserRoleSuperAdmin}
	global := monitoringRequest(h, admin, "GET", "/api/monitoring", "")
	if !strings.Contains(global.Body.String(), "bob") || !strings.Contains(global.Body.String(), "private diagnostic") || strings.Contains(global.Body.String(), "outside window") {
		t.Fatal(global.Body.String())
	}
	scoped := monitoringRequest(h, admin, "GET", "/api/monitoring?user_id=bob", "")
	if strings.Contains(scoped.Body.String(), "alice") {
		t.Fatal(scoped.Body.String())
	}
	if monitoringRequest(h, model.User{}, "GET", "/api/monitoring", "").Code != 401 {
		t.Fatal("anonymous access")
	}
}
func TestRuntimeMonitoringFiltersPaginationAndValidation(t *testing.T) {
	h, _ := monitoringFixture(t)
	user := model.User{ID: "alice", Role: model.UserRoleMember}
	for _, path := range []string{"?hours=721", "?hours=-1", "?page=0", "?page_size=101", "?source=bad", "?status=bad", "?start=bad", "?start=2026-01-01&end=2026-06-01"} {
		if w := monitoringRequest(h, user, "GET", "/api/monitoring"+path, ""); w.Code != 400 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	w := monitoringRequest(h, user, "GET", "/api/monitoring?status=error&page_size=1", "")
	var response struct {
		Data service.MonitoringReport `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if response.Data.Total != 1 || len(response.Data.Items) != 1 || response.Data.Stats.Successes != 1 {
		t.Fatal(w.Body.String())
	}
	w = monitoringRequest(h, user, "GET", "/api/monitoring?q=private", "")
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if response.Data.Total != 0 {
		t.Fatal("private-detail search side channel")
	}
	w = monitoringRequest(h, user, "GET", "/api/monitoring?model=test&source=job", "")
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if response.Data.Total != 1 {
		t.Fatal(w.Body.String())
	}
}
func TestRuntimeMonitoringClientDedupRedactionRateAndOwner(t *testing.T) {
	h, repo := monitoringFixture(t)
	user := model.User{ID: "alice", Role: model.UserRoleMember}
	body := `{"id":"one","user_id":"bob","message":"Authorization: Bearer SUPERSECRET","detail":"https://host/x?key=SUPERSECRET","endpoint":"/canvas?a=secret"}`
	for i := 0; i < 2; i++ {
		if w := monitoringRequest(h, user, "POST", "/api/monitoring/client-errors", body); w.Code != 201 {
			t.Fatal(w.Body.String())
		}
	}
	facts, err := repo.Facts(context.Background(), time.Now().Add(-time.Hour), time.Now().Add(time.Hour), "alice")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, row := range facts.Errors {
		if row.Source == "client" {
			count++
			if row.UserID != "alice" || row.Endpoint != "/canvas" || strings.Contains(row.Message+row.Detail, "SUPERSECRET") {
				t.Fatal(row)
			}
		}
	}
	if count != 1 {
		t.Fatal("missing dedup")
	}
	for i := 2; i < monitoringClientPerMinute; i++ {
		monitoringRequest(h, user, "POST", "/api/monitoring/client-errors", fmt.Sprintf(`{"id":"e%d","message":"error"}`, i))
	}
	if monitoringRequest(h, user, "POST", "/api/monitoring/client-errors", body).Code != 429 {
		t.Fatal("missing rate bound")
	}
}
func TestRuntimeMonitoringCSVFormulaProtection(t *testing.T) {
	csv := monitoringCSV([]service.MonitoringRow{{RuntimeError: model.RuntimeError{Message: " =HYPERLINK(1)", Detail: "\t+cmd"}}})
	if !strings.Contains(csv, "' =HYPERLINK") || !strings.Contains(csv, "'\t+cmd") {
		t.Fatal(csv)
	}
}

func TestRuntimeMonitoringAllPagesAndBucketTotals(t *testing.T) {
	h, repo := monitoringFixture(t)
	for i := 0; i < 85; i++ {
		_ = repo.Record(context.Background(), model.RuntimeError{ID: fmt.Sprintf("page-%02d", i), UserID: "alice", Source: "api", Message: "page marker", CreatedAt: time.Now().In(time.FixedZone("local", 8*60*60)).Add(-time.Minute)})
	}
	user := model.User{ID: "alice", Role: model.UserRoleMember}
	w := monitoringRequest(h, user, "GET", "/api/monitoring?q=page%20marker&page=3&page_size=30", "")
	var envelope struct {
		Data service.MonitoringReport `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &envelope)
	if envelope.Data.Total != 85 || len(envelope.Data.Items) != 25 {
		t.Fatal(w.Body.String())
	}
	total := 0
	for _, bucket := range envelope.Data.Buckets {
		total += bucket.Errors
	}
	if total != 85 {
		t.Fatalf("timezone buckets lost events: %d", total)
	}
	w = monitoringRequest(h, user, "GET", "/api/monitoring?q=page%20marker&page=3&export=csv", "")
	if strings.Count(w.Body.String(), "page marker") != 85 {
		t.Fatal("export only included current page")
	}
}
