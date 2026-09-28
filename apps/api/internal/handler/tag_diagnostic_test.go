package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTagDatabaseDiagnosticStaysInUserIsolatedMonitoring(t *testing.T) {
	repo := repository.NewRuntimeMonitoringRepository(repository.NewMemoryJobRepository(), repository.NewMemoryMonitoringRepository())
	r := gin.New()
	r.Use(middleware.RequestID(), middleware.RuntimeMonitoring(repo))
	r.POST("/api/tags", func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "alice"})
		tagError(c, &pgconn.PgError{Code: "23505", TableName: "tags", ConstraintName: "legacy_global_tag_name", Detail: "PRIVATE_OTHER_USER_TAG"})
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/api/tags", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "constraint") || strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatalf("wrong public response: %s", w.Body.String())
	}
	facts, err := repo.Facts(context.Background(), time.Now().Add(-time.Hour), time.Now().Add(time.Hour), "alice")
	if err != nil || len(facts.Errors) != 1 {
		t.Fatalf("missing diagnostic: %+v %v", facts, err)
	}
	detail := facts.Errors[0]
	if !strings.Contains(detail.Detail, "legacy_global_tag_name") || strings.Contains(detail.Detail, "PRIVATE") || detail.Suggestion == "" || detail.RequestID == "" {
		t.Fatalf("incomplete or unsafe diagnostic: %+v", detail)
	}
	other, err := repo.Facts(context.Background(), time.Now().Add(-time.Hour), time.Now().Add(time.Hour), "bob")
	if err != nil || len(other.Errors) != 0 {
		t.Fatal("diagnostic leaked across users")
	}
}
