package middleware

import (
	"context"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

func TestRuntimeMonitoringCapture(t *testing.T) {
	repo := repository.NewRuntimeMonitoringRepository(repository.NewMemoryJobRepository(), repository.NewMemoryMonitoringRepository())
	r := gin.New()
	r.Use(RequestID(), RuntimeMonitoring(repo), SafeRecovery(io.Discard))
	r.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, model.User{ID: "alice"}); c.Next() })
	r.GET("/failure", func(c *gin.Context) {
		response.ErrorWithData(c, 502, "timeout", gin.H{"code": "provider_timeout", "reason": "Authorization: Bearer SECRET"})
	})
	r.GET("/panic", func(c *gin.Context) { panic("secret panic") })
	r.GET("/success", func(c *gin.Context) { c.Data(200, "image/png", []byte("large image")) })
	r.GET("/recorded", func(c *gin.Context) { c.Set(monitoring.AIRecordedKey, true); response.Error(c, 500, "already logged") })
	for _, path := range []string{"/failure?token=SECRET", "/panic", "/success", "/recorded"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if path == "/success" && w.Body.String() != "large image" {
			t.Fatal("response corrupted")
		}
	}
	facts, err := repo.Facts(context.Background(), time.Now().Add(-time.Hour), time.Now().Add(time.Hour), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(facts.Errors) != 2 {
		t.Fatalf("wrong event count %d", len(facts.Errors))
	}
	for _, e := range facts.Errors {
		if strings.Contains(e.Detail+e.Endpoint, "SECRET") || e.RequestID == "" {
			t.Fatal(e)
		}
	}
}
