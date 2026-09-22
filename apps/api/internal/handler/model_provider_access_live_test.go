package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Opt-in deployment verification: read real policies/accounts through Gorm,
// but submit only to an in-memory queue. Never migrates, writes live data or
// calls a provider. Credentials and catalog contents are not printed.
func TestProviderAccessLiveReadOnly(t *testing.T) {
	id := os.Getenv("VERIFY_PROVIDER_ACCESS_ID")
	userID := os.Getenv("VERIFY_PROVIDER_ACCESS_USER_ID")
	if id == "" || userID == "" {
		t.Skip("set VERIFY_PROVIDER_ACCESS_ID and VERIFY_PROVIDER_ACCESS_USER_ID for read-only verification")
	}
	cfg := config.Load()
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("database connection failed")
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	tx := db.Begin()
	defer tx.Rollback()
	if tx.Exec("SET TRANSACTION READ ONLY").Error != nil {
		t.Fatal("cannot enforce read-only transaction")
	}
	repo := repository.NewGormModelProviderRepository(tx)
	stored, err := repo.GetModelProvider(id)
	if err != nil {
		t.Fatal("provider missing")
	}
	var allowed []string
	if json.Unmarshal(stored.AllowedUserIDs, &allowed) != nil || len(allowed) != 1 || allowed[0] != userID {
		t.Fatal("unexpected persisted policy")
	}
	var users []model.User
	if tx.Select("id", "username", "role").Find(&users).Error != nil {
		t.Fatal("account lookup failed")
	}
	allowedCount, deniedCount, adminCount := 0, 0, 0
	gin.SetMode(gin.TestMode)
	for _, user := range users {
		shouldAllow := user.ID == userID || user.Role == model.UserRoleSuperAdmin
		if user.Role == model.UserRoleSuperAdmin {
			adminCount++
		}
		if shouldAllow {
			allowedCount++
		} else {
			deniedCount++
		}
		h := NewModelProviderHandler(repo, provider.NewSecretBox(cfg.AppSecret))
		producer := &queue.MemoryProducer{}
		ai := NewAIHandler(h, service.NewJobService(repository.NewMemoryJobRepository(), producer, "test-only", 3))
		router := gin.New()
		router.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, user); c.Next() })
		router.GET("/models", h.AggregatedModels)
		router.POST("/generate", ai.SeedanceTaskCreate)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", "/models", nil))
		if rec.Code != 200 || strings.Contains(rec.Body.String(), id+"::") != shouldAllow {
			t.Fatal("catalog policy mismatch")
		}
		if rec.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("catalog must not be cached across accounts")
		}
		for _, mid := range modelsByCapabilityFromConfig(stored)[model.ModelCapabilityVideo] {
			payload, _ := json.Marshal(map[string]any{"model": id + "::" + mid, "prompt": "permission verification only"})
			req := httptest.NewRequest(http.MethodPost, "/generate", strings.NewReader(string(payload)))
			req.Header.Set("Content-Type", "application/json")
			rec = httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if shouldAllow && rec.Code != 200 {
				t.Fatal("authorized request rejected")
			}
			if !shouldAllow && (rec.Code != 403 || len(producer.Messages) != 0) {
				t.Fatal("unauthorized request escaped permission check")
			}
		}
	}
	if allowedCount < 2 || adminCount < 1 || deniedCount < 1 {
		t.Fatal("verification accounts missing")
	}
	t.Logf("Gorm policy verified: %d authorized accounts, %d blocked accounts, %d restricted video models; no live tasks submitted", allowedCount, deniedCount, len(modelsByCapabilityFromConfig(stored)[model.ModelCapabilityVideo]))
}
