package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

// localVoiceCloneFixture 搭一个带模拟百炼的完整链路：质检（临时克隆→删除）走
// httptest server，音色本体不留在服务商。
type localVoiceCloneFixture struct {
	router    *gin.Engine
	cookie    *http.Cookie
	voiceRepo *repository.MemoryClonedVoiceRepository
	assets    *service.AssetService
	created   int
	deleted   int
}

func newLocalVoiceCloneFixture(t *testing.T, rejectClone bool) *localVoiceCloneFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	fx := &localVoiceCloneFixture{}

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/uploads":
			// DashScope 临时上传 policy：上传主机指回测试服务器。
			_, _ = w.Write([]byte(`{"data":{"upload_dir":"tmp","upload_host":"` + server.URL + `/oss-upload"}}`))
		case strings.HasPrefix(r.URL.Path, "/oss-upload"):
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == provider.DefaultCosyVoiceCloneEndpoint:
			var req struct {
				Input struct {
					Action string `json:"action"`
				} `json:"input"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			switch req.Input.Action {
			case "create_voice":
				if rejectClone {
					// 百炼对不合格音频返回 HTTP 400 + code/message。
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"code":"InvalidParameter","message":"no valid speech in reference audio"}`))
					return
				}
				fx.created++
				_, _ = w.Write([]byte(`{"output":{"voice_id":"cosyvoice-v3.5-plus-chk-abc123"}}`))
			case "delete_voice":
				fx.deleted++
				_, _ = w.Write([]byte(`{"output":{}}`))
			default:
				w.WriteHeader(http.StatusBadRequest)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { t.Cleanup(server.Close) }()

	userRepo := repository.NewMemoryUserRepository()
	authService := auth.NewService(userRepo, config.Config{AppSecret: "secret"})
	if err := authService.SeedSuperAdmin(config.Config{AdminUsername: "admin", AdminPassword: "secret"}); err != nil {
		t.Fatal(err)
	}
	providerRepo := repository.NewMemoryModelProviderRepository()
	providerConfig := generationTestConfig("bailian", "")
	providerConfig.AudioModel = "cosyvoice-v3.5-plus"
	providerConfig.DefaultFor = mustProviderJSONB([]string{model.ModelCapabilityAudio})
	providerConfig.BaseURL = server.URL
	providerConfig.AuthType = model.ModelProviderAuthTypeBearer
	encryptedKey, err := provider.NewSecretBox("secret").Encrypt("sk-test")
	if err != nil {
		t.Fatal(err)
	}
	providerConfig.APIKeyEncrypted = encryptedKey
	if _, err := providerRepo.UpsertModelProvider(providerConfig); err != nil {
		t.Fatal(err)
	}
	providerHandler := NewModelProviderHandler(providerRepo, provider.NewSecretBox("secret"))
	jobService := service.NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3)
	aiHandler := NewAIHandler(providerHandler, jobService)
	fx.voiceRepo = repository.NewMemoryClonedVoiceRepository()
	aiHandler.SetClonedVoiceRepository(fx.voiceRepo)
	fx.assets = service.NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	aiHandler.SetAssetService(fx.assets)

	authHandler := NewAuthHandler(authService, userRepo, config.Config{})
	fx.router = gin.New()
	fx.router.Use(middleware.RequestID())
	api := fx.router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	ai := api.Group("/ai", middleware.RequireAuth(authService))
	ai.POST("/audio/voices", aiHandler.AudioVoiceCloneCreate)
	ai.GET("/audio/voices", aiHandler.AudioVoiceCloneList)
	ai.DELETE("/audio/voices/:voice_id", aiHandler.AudioVoiceCloneDelete)
	fx.cookie = loginCookie(t, fx.router, "admin", "secret")
	return fx
}

func (fx *localVoiceCloneFixture) cloneBody() string {
	return `{"target_model":"cosyvoice-v3.5-plus","alias":"角色1","data_url":"data:audio/mpeg;base64,` +
		base64.StdEncoding.EncodeToString([]byte("fake-audio-bytes")) + `"}`
}

// 即克隆即删模式：克隆只存参考音频资产 + 元数据，服务商侧只用于质检且用后删除。
func TestLocalVoiceCloneStoresReferenceWithValidation(t *testing.T) {
	fx := newLocalVoiceCloneFixture(t, false)
	rec := performJSON(fx.router, http.MethodPost, "/api/ai/audio/voices", fx.cloneBody(), fx.cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("clone: %s", rec.Body.String())
	}
	var envelope struct {
		Data struct {
			VoiceID string `json:"voice_id"`
			Alias   string `json:"alias"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(envelope.Data.VoiceID, "cvoice-") || envelope.Data.Alias != "角色1" {
		t.Fatalf("unexpected response: %s", rec.Body.String())
	}
	meta, err := fx.voiceRepo.Get(envelope.Data.VoiceID)
	if err != nil || meta.ReferenceAssetID == "" || meta.Alias != "角色1" || meta.OwnerID == "" {
		t.Fatalf("meta = %+v, err = %v", meta, err)
	}
	if fx.created != 1 || fx.deleted != 1 {
		t.Fatalf("validation should create and delete exactly one temp voice, got created=%d deleted=%d", fx.created, fx.deleted)
	}

	// 列表能看到自己的音色，删除后消失。
	rec = performJSON(fx.router, http.MethodGet, "/api/ai/audio/voices", "", fx.cookie)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "角色1") {
		t.Fatalf("list: %s", rec.Body.String())
	}
	rec = performJSON(fx.router, http.MethodDelete, "/api/ai/audio/voices/"+envelope.Data.VoiceID, "", fx.cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %s", rec.Body.String())
	}
	if _, err := fx.voiceRepo.Get(envelope.Data.VoiceID); err == nil {
		t.Fatal("expected meta gone after delete")
	}
}

// 质检不合格：克隆被拒，元数据不落库，参考音频资产进回收站。
func TestLocalVoiceCloneRejectsBadAudio(t *testing.T) {
	fx := newLocalVoiceCloneFixture(t, true)
	rec := performJSON(fx.router, http.MethodPost, "/api/ai/audio/voices", fx.cloneBody(), fx.cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for rejected audio, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "参考音频") {
		t.Fatalf("expected user-facing audio advice, got %s", rec.Body.String())
	}
	metas, err := fx.voiceRepo.ListVisible("", true)
	if err != nil || len(metas) != 0 {
		t.Fatalf("rejected clone must not persist meta: %+v", metas)
	}
	if fx.created != 0 || fx.deleted != 0 {
		t.Fatalf("rejected clone should not create provider voices: created=%d deleted=%d", fx.created, fx.deleted)
	}
}
