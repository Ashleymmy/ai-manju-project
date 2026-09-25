package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func receiptTestRouter(t *testing.T, next gin.HandlerFunc) (*gin.Engine, *AIHandler) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAIHandler(nil, nil)
	h.SetGenerationReceiptService(service.NewGenerationReceiptService(repository.NewMemoryGenerationReceiptRepository(), storage.NewLocalFSStorage(t.TempDir()), provider.NewSecretBox("isolated-receipt-test")))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		user := c.GetHeader("X-Test-User")
		if user == "" {
			user = "owner"
		}
		c.Set(auth.ContextUserKey, model.User{ID: user})
		c.Set("request_id", "current-request-id")
	})
	r.POST("/text", h.WithGenerationReceipt(model.GenerationReceiptKindText, next))
	r.POST("/audio", h.WithGenerationReceipt(model.GenerationReceiptKindAudio, next))
	r.GET("/receipts/:kind/:key", h.GenerationReceiptStatus)
	r.GET("/receipts/:kind/:key/result", h.GenerationReceiptResult)
	return r, h
}

func receiptRequest(r http.Handler, method, path, key, body, user string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("X-Test-User", user)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestGenerationReceiptDisconnectPreservesOriginalResultWithoutSecondExecution(t *testing.T) {
	started, finish, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	r, _ := receiptTestRouter(t, func(c *gin.Context) {
		calls.Add(1)
		close(started)
		<-finish
		if err := c.Request.Context().Err(); err != nil {
			t.Errorf("browser cancellation canceled supplier execution: %v", err)
		}
		response.OK(c, gin.H{"text": "original", "model": "text-model", "tool_calls": []any{gin.H{"id": "call-original"}}, "finish_reason": "tool_calls"})
	})
	ctx, cancel := context.WithCancel(context.Background())
	first := httptest.NewRequest("POST", "/text", strings.NewReader(`{"prompt":"hello"}`)).WithContext(ctx)
	first.Header.Set("Idempotency-Key", "disconnect-test-key")
	go func() { defer close(returned); r.ServeHTTP(httptest.NewRecorder(), first) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("supplier did not start")
	}
	cancel()
	duplicate := receiptRequest(r, "POST", "/text", "disconnect-test-key", `{"prompt":"hello"}`, "")
	if duplicate.Code != http.StatusAccepted || calls.Load() != 1 {
		t.Fatal("duplicate submitted another request")
	}
	close(finish)
	select {
	case <-returned:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not finish")
	}
	result := receiptRequest(r, "GET", "/receipts/text/disconnect-test-key/result", "", "", "")
	if result.Code != 200 || !strings.Contains(result.Body.String(), "call-original") || !strings.Contains(result.Body.String(), "original") || calls.Load() != 1 {
		t.Fatalf("original text/tool calls lost or repeated: status=%d calls=%d", result.Code, calls.Load())
	}
}

func TestGenerationReceiptScopeAndPayloadIsolation(t *testing.T) {
	var calls int
	r, _ := receiptTestRouter(t, func(c *gin.Context) { calls++; response.OK(c, gin.H{"text": "private-result"}) })
	initial := receiptRequest(r, "POST", "/text?scope=team", "scope-test-key", `{"prompt":"hello","model":"original"}`, "owner")
	if initial.Code != 200 {
		t.Fatalf("initial status=%d", initial.Code)
	}
	// A duplicate matches JSON values despite insignificant object key order.
	duplicate := receiptRequest(r, "POST", "/text?scope=team", "scope-test-key", `{"model":"original", "prompt":"hello"}`, "owner")
	if duplicate.Code != 200 || calls != 1 {
		t.Fatal("canonical duplicate was re-executed")
	}
	conflict := receiptRequest(r, "POST", "/text?scope=team", "scope-test-key", `{"prompt":"changed"}`, "owner")
	if conflict.Code != 409 || calls != 1 {
		t.Fatal("changed payload reused a claimed key")
	}
	for _, tc := range []struct{ path, user string }{
		{"/receipts/text/scope-test-key/result?scope=team", "other"},
		{"/receipts/text/scope-test-key/result", "owner"},
		{"/receipts/audio/scope-test-key/result?scope=team", "owner"},
	} {
		result := receiptRequest(r, "GET", tc.path, "", "", tc.user)
		if result.Code != 404 || strings.Contains(result.Body.String(), "private-result") {
			t.Fatal("receipt crossed actor/workspace/kind boundary")
		}
	}
}

func TestGenerationReceiptAudioBytesRemainExactAfterHandlerChanges(t *testing.T) {
	var calls int
	original := append([]byte("ID3"), bytes.Repeat([]byte{0, 3, 9, 255}, 200)...)
	r, _ := receiptTestRouter(t, func(c *gin.Context) {
		calls++
		if calls > 1 {
			response.Error(c, 403, "provider removed")
			return
		}
		c.Data(200, "audio/mpeg", original)
	})
	first := receiptRequest(r, "POST", "/audio", "audio-test-key", `{"input":"hello"}`, "")
	if first.Code != 200 || !bytes.Equal(first.Body.Bytes(), original) {
		t.Fatal("first audio output changed")
	}
	for _, method := range []string{"POST", "GET"} {
		path := "/audio"
		if method == "GET" {
			path = "/receipts/audio/audio-test-key/result"
		}
		result := receiptRequest(r, method, path, "audio-test-key", `{"input":"hello"}`, "")
		if result.Code != 200 || result.Header().Get("Content-Type") != "audio/mpeg" || !bytes.Equal(result.Body.Bytes(), original) || calls != 1 {
			t.Fatal("saved audio was changed or regenerated")
		}
	}
}

func TestGenerationReceiptUncertainFailureIsNeverResubmitted(t *testing.T) {
	var calls int
	r, _ := receiptTestRouter(t, func(c *gin.Context) { calls++; response.Error(c, 502, errGenerationSubmissionUncertain.Error()) })
	first := receiptRequest(r, "POST", "/text", "uncertain-test-key", `{"prompt":"hello"}`, "")
	if first.Code != 502 {
		t.Fatal("original error changed")
	}
	status := receiptRequest(r, "GET", "/receipts/text/uncertain-test-key", "", "", "")
	var envelope struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if json.Unmarshal(status.Body.Bytes(), &envelope) != nil || envelope.Data.Status != model.GenerationReceiptStateUncertain {
		t.Fatal("uncertain result mislabeled")
	}
	retry := receiptRequest(r, "POST", "/text", "uncertain-test-key", `{"prompt":"hello"}`, "")
	if retry.Code != 409 || calls != 1 {
		t.Fatal("uncertain request was repeated")
	}
}

func TestGenerationReceiptLegacyCallsKeepExistingBehavior(t *testing.T) {
	var calls int
	r, _ := receiptTestRouter(t, func(c *gin.Context) {
		calls++
		c.Header("X-Original", "retained")
		response.OK(c, gin.H{"text": "legacy"})
	})
	for range 2 {
		result := receiptRequest(r, "POST", "/text", "", `{"prompt":"hello"}`, "")
		if result.Code != 200 || result.Header().Get("X-Original") != "retained" {
			t.Fatal("legacy response changed")
		}
	}
	if calls != 2 {
		t.Fatal("unkeyed calls changed")
	}
}

type unavailableReceiptStorage struct{ storage.Storage }

func (s unavailableReceiptStorage) Put(context.Context, string, io.Reader, storage.PutMeta) (storage.StorageObject, error) {
	return storage.StorageObject{}, errors.New("isolated test storage unavailable")
}

func TestGenerationReceiptPersistenceFailureStillDeliversOriginalOutput(t *testing.T) {
	var calls int
	r, h := receiptTestRouter(t, func(c *gin.Context) {
		calls++
		c.Header("X-Original", "retained")
		response.OK(c, gin.H{"text": "save this original output"})
	})
	h.SetGenerationReceiptService(service.NewGenerationReceiptService(repository.NewMemoryGenerationReceiptRepository(), unavailableReceiptStorage{storage.NewLocalFSStorage(t.TempDir())}, provider.NewSecretBox("isolated-test")))
	first := receiptRequest(r, "POST", "/text", "unavailable-store-key", `{"prompt":"hello"}`, "")
	if first.Code != 200 || !strings.Contains(first.Body.String(), "save this original output") || first.Header().Get(GenerationReceiptStateHeader) != "unavailable" || first.Header().Get("X-Original") != "retained" {
		t.Fatal("valid supplier output was discarded when recovery storage failed")
	}
	second := receiptRequest(r, "POST", "/text", "unavailable-store-key", `{"prompt":"hello"}`, "")
	if second.Code != 409 || calls != 1 {
		t.Fatal("storage failure allowed duplicate supplier execution")
	}
}

func TestGenerationReceiptPanicDoesNotAllowRepeatExecution(t *testing.T) {
	var calls int
	r, _ := receiptTestRouter(t, func(c *gin.Context) { calls++; panic("simulated interruption") })
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected simulated panic")
			}
		}()
		receiptRequest(r, "POST", "/text", "interrupted-key", `{"prompt":"hello"}`, "")
	}()
	second := receiptRequest(r, "POST", "/text", "interrupted-key", `{"prompt":"hello"}`, "")
	if second.Code != 202 || calls != 1 {
		t.Fatal("interrupted execution was reclaimed")
	}
}
