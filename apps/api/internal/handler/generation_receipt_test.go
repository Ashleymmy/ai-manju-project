package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	r.POST("/comic_revision", h.WithGenerationReceiptResource(model.GenerationReceiptKindComicRevision, next))
	r.POST("/comic_prompt", h.WithGenerationReceiptResource(model.GenerationReceiptKindComicPrompt, next))
	r.GET("/receipts/:kind/:key", h.GenerationReceiptStatus)
	r.GET("/receipts/:kind/:key/result", h.GenerationReceiptResult)
	r.POST("/receipts/:kind/:key/reconcile", h.GenerationReceiptReconcile)
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

func TestScopedGenerationReceiptBindsComicResourcePath(t *testing.T) {
	var calls atomic.Int32
	h := NewAIHandler(nil, nil)
	h.SetGenerationReceiptService(service.NewGenerationReceiptService(repository.NewMemoryGenerationReceiptRepository(), storage.NewLocalFSStorage(t.TempDir()), provider.NewSecretBox("isolated-scoped-receipt-test")))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "owner"})
		c.Set("request_id", "current-request-id")
	})
	next := func(c *gin.Context) {
		calls.Add(1)
		response.OK(c, gin.H{"call": calls.Load(), "path": c.Request.URL.Path})
	}
	middleware := h.WithGenerationReceiptResource(model.GenerationReceiptKindComicPrompt, next)
	r.POST("/api/comic-asset-projects/:projectId/assets/:assetId/prompt-optimize", middleware)
	r.POST("/api/comic-asset-projects/:projectId/assets/:assetId/prompt-optimize-alt", middleware)
	request := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"direction":"bright"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "same-client-key")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	first := request("/api/comic-asset-projects/project-a/assets/asset-a/prompt-optimize")
	duplicate := request("/api/comic-asset-projects/project-a/assets/asset-a/prompt-optimize")
	otherResource := request("/api/comic-asset-projects/project-b/assets/asset-a/prompt-optimize")
	otherRoute := request("/api/comic-asset-projects/project-a/assets/asset-a/prompt-optimize-alt")
	if first.Code != http.StatusOK || duplicate.Code != http.StatusOK || otherResource.Code != http.StatusConflict || otherRoute.Code != http.StatusConflict {
		t.Fatalf("unexpected statuses: first=%d duplicate=%d other_resource=%d other_route=%d", first.Code, duplicate.Code, otherResource.Code, otherRoute.Code)
	}
	if calls.Load() != 1 {
		t.Fatalf("same client key crossed resource boundary or duplicate executed: calls=%d", calls.Load())
	}
	if duplicate.Body.String() != first.Body.String() {
		t.Fatalf("same resource did not replay durable output: first=%s duplicate=%s", first.Body.String(), duplicate.Body.String())
	}
}

func TestComicOperationReceiptsSurviveDisconnectAndIsolateOwnerScope(t *testing.T) {
	for _, kind := range []string{model.GenerationReceiptKindComicRevision, model.GenerationReceiptKindComicPrompt} {
		t.Run(kind, func(t *testing.T) {
			started, finish, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			r, h := receiptTestRouter(t, func(*gin.Context) {})
			r.POST("/comic/:resourceId", h.WithGenerationReceiptResource(kind, func(c *gin.Context) {
				calls.Add(1)
				close(started)
				<-finish
				if err := c.Request.Context().Err(); err != nil {
					t.Errorf("disconnection canceled owned comic operation: %v", err)
				}
				response.Created(c, gin.H{"private_result": "saved revision", "resource": c.Param("resourceId")})
			}))
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			first := httptest.NewRequest(http.MethodPost, "/comic/a?scope=team", strings.NewReader(`{"model":"mock","direction":"better"}`)).WithContext(ctx)
			first.Header.Set("Idempotency-Key", "comic-operation-key")
			go func() {
				defer close(returned)
				r.ServeHTTP(httptest.NewRecorder(), first)
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("comic operation did not start")
			}
			cancel()
			duplicate := receiptRequest(r, http.MethodPost, "/comic/a?scope=team", "comic-operation-key", `{"direction":"better","model":"mock"}`, "")
			if duplicate.Code != http.StatusAccepted || calls.Load() != 1 {
				t.Fatalf("duplicate called the model: status=%d calls=%d", duplicate.Code, calls.Load())
			}
			close(finish)
			select {
			case <-returned:
			case <-time.After(3 * time.Second):
				t.Fatal("comic operation did not finish")
			}
			resultPath := "/receipts/" + kind + "/comic-operation-key/result"
			result := receiptRequest(r, http.MethodGet, resultPath+"?scope=team", "", "", "")
			if result.Code != http.StatusOK || !strings.Contains(result.Body.String(), "saved revision") || calls.Load() != 1 {
				t.Fatalf("original comic response lost: status=%d calls=%d", result.Code, calls.Load())
			}
			for _, tc := range []struct{ path, user string }{{resultPath + "?scope=team", "another-user"}, {resultPath, "owner"}} {
				isolated := receiptRequest(r, http.MethodGet, tc.path, "", "", tc.user)
				if isolated.Code != http.StatusNotFound || strings.Contains(isolated.Body.String(), "saved revision") {
					t.Fatal("comic receipt crossed actor/workspace isolation")
				}
			}
			changed := receiptRequest(r, http.MethodPost, "/comic/a?scope=team", "comic-operation-key", `{"direction":"changed","model":"mock"}`, "")
			if changed.Code != http.StatusConflict || calls.Load() != 1 {
				t.Fatal("changed comic operation reused an existing receipt")
			}
		})
	}
}

func TestComicOperationReceiptServerFailureRemainsUncertain(t *testing.T) {
	var calls int
	r, h := receiptTestRouter(t, func(*gin.Context) {})
	r.POST("/comic/:resourceId", h.WithGenerationReceiptResource(model.GenerationReceiptKindComicPrompt, func(c *gin.Context) {
		calls++
		// A database failure can happen after the generated prompt was received.
		response.Error(c, http.StatusInternalServerError, "prompt save failed")
	}))
	first := receiptRequest(r, http.MethodPost, "/comic/a", "save-error", `{"direction":"better"}`, "")
	if first.Code != http.StatusInternalServerError {
		t.Fatalf("first error changed: %d", first.Code)
	}
	status := receiptRequest(r, http.MethodGet, "/receipts/comic_prompt/save-error", "", "", "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"status":"uncertain"`) {
		t.Fatalf("server error was marked safe to repeat: %s", status.Body.String())
	}
	retry := receiptRequest(r, http.MethodPost, "/comic/a", "save-error", `{"direction":"better"}`, "")
	if retry.Code != http.StatusConflict || calls != 1 {
		t.Fatalf("ambiguous comic operation was repeated: status=%d calls=%d", retry.Code, calls)
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

func assertReconciledReceipt(t *testing.T, rec *httptest.ResponseRecorder, code int, kind, key, status string) {
	t.Helper()
	var body struct {
		Success   bool   `json:"success"`
		RequestID string `json:"request_id"`
		Data      struct {
			Receipt struct{ Kind, Key, Status string } `json:"receipt"`
		} `json:"data"`
	}
	if rec.Code != code || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.Data.Receipt.Kind != kind || body.Data.Receipt.Key != key || body.Data.Receipt.Status != status || body.Success != (code == http.StatusOK) || (code != http.StatusOK && body.RequestID != "current-request-id") || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("wrong receipt envelope: code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGenerationReceiptReconcileBlocksLatePOSTWithoutHandlerOrBilling(t *testing.T) {
	var calls atomic.Int32
	r, _ := receiptTestRouter(t, func(c *gin.Context) { calls.Add(1); response.OK(c, gin.H{"text": "paid handler must not run"}) })
	for _, kind := range []string{"text", "audio", model.GenerationReceiptKindComicRevision, model.GenerationReceiptKindComicPrompt} {
		key := "never-submitted-" + kind
		base := "/receipts/" + kind + "/" + key
		missing := receiptRequest(r, "GET", base+"/result", "", "", "")
		if missing.Code != http.StatusNotFound {
			t.Fatal("missing receipt unexpectedly exists")
		}
		for range 3 {
			got := receiptRequest(r, "POST", base+"/reconcile", "", "", "")
			assertReconciledReceipt(t, got, http.StatusOK, kind, key, model.GenerationReceiptStateNotSubmitted)
		}
		for _, payload := range []string{`{"prompt":"original"}`, `{"prompt":"changed"}`} {
			got := receiptRequest(r, "POST", "/"+kind, key, payload, "")
			assertReconciledReceipt(t, got, http.StatusConflict, kind, key, model.GenerationReceiptStateNotSubmitted)
		}
		got := receiptRequest(r, "GET", base+"/result", "", "", "")
		assertReconciledReceipt(t, got, http.StatusConflict, kind, key, model.GenerationReceiptStateNotSubmitted)
		status := receiptRequest(r, "GET", base, "", "", "")
		if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"status":"not_submitted"`) {
			t.Fatal("status endpoint changed its existing envelope")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("tombstoned POST reached generation or billing")
	}
}

func TestGenerationReceiptReconcileDoesNotStealRunningExecution(t *testing.T) {
	started, finish, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	r, _ := receiptTestRouter(t, func(c *gin.Context) {
		calls.Add(1)
		close(started)
		<-finish
		response.OK(c, gin.H{"text": "original result"})
	})
	go func() {
		defer close(returned)
		receiptRequest(r, "POST", "/text", "already-sent", `{"prompt":"hello"}`, "")
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("generation did not start")
	}
	for range 3 {
		got := receiptRequest(r, "POST", "/receipts/text/already-sent/reconcile", "", "", "")
		assertReconciledReceipt(t, got, http.StatusOK, "text", "already-sent", model.GenerationReceiptStateRunning)
	}
	close(finish)
	select {
	case <-returned:
	case <-time.After(3 * time.Second):
		t.Fatal("generation did not finish")
	}
	got := receiptRequest(r, "POST", "/receipts/text/already-sent/reconcile", "", "", "")
	assertReconciledReceipt(t, got, http.StatusOK, "text", "already-sent", model.GenerationReceiptStateSucceeded)
	result := receiptRequest(r, "GET", "/receipts/text/already-sent/result", "", "", "")
	if result.Code != http.StatusOK || !strings.Contains(result.Body.String(), "original result") || calls.Load() != 1 {
		t.Fatal("reconciliation discarded or repeated existing execution")
	}
}

func TestGenerationReceiptReconcileCannotTargetAnotherOwnerOrWorkspace(t *testing.T) {
	var calls atomic.Int32
	r, _ := receiptTestRouter(t, func(c *gin.Context) { calls.Add(1); response.OK(c, gin.H{"text": "private original"}) })
	for _, tc := range []struct{ path, user string }{
		{"/receipts/text/shared-key/reconcile?scope=team", "other"},
		{"/receipts/text/shared-key/reconcile", "owner"},
		{"/receipts/audio/shared-key/reconcile?scope=team", "owner"},
	} {
		// Spoofed body ownership must be ignored; auth and URL scope win.
		got := receiptRequest(r, "POST", tc.path, "", `{"user_id":"owner","workspace_id":"team","kind":"text"}`, tc.user)
		if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"status":"not_submitted"`) {
			t.Fatal("scope-specific reconciliation failed")
		}
	}
	got := receiptRequest(r, "POST", "/text?scope=team", "shared-key", `{"prompt":"private"}`, "owner")
	if got.Code != http.StatusOK || calls.Load() != 1 || !strings.Contains(got.Body.String(), "private original") {
		t.Fatal("another scope prevented the owner's execution")
	}
	for _, tc := range []struct{ path, user string }{
		{"/receipts/text/shared-key/result?scope=team", "other"},
		{"/receipts/text/shared-key/result", "owner"},
		{"/receipts/audio/shared-key/result?scope=team", "owner"},
	} {
		got := receiptRequest(r, "GET", tc.path, "", "", tc.user)
		if got.Code != http.StatusConflict || strings.Contains(got.Body.String(), "private original") {
			t.Fatal("reconciliation exposed another scope's result")
		}
	}
}

func TestGenerationReceiptReconcileRacesHTTPSubmission(t *testing.T) {
	for round := range 16 {
		var calls atomic.Int32
		finish := make(chan struct{})
		r, _ := receiptTestRouter(t, func(c *gin.Context) {
			calls.Add(1)
			<-finish
			response.OK(c, gin.H{"text": "original"})
		})
		key := fmt.Sprintf("http-race-%d", round)
		var wg sync.WaitGroup
		start := make(chan struct{})
		completed := make(chan struct{}, 20)
		for worker := range 20 {
			wg.Add(1)
			go func() {
				defer func() { wg.Done(); completed <- struct{}{} }()
				<-start
				if worker%2 == 0 {
					got := receiptRequest(r, "POST", "/receipts/text/"+key+"/reconcile", "", "", "")
					if got.Code != http.StatusOK {
						t.Error("concurrent reconciliation failed")
					}
				} else {
					got := receiptRequest(r, "POST", "/text", key, `{"prompt":"hello"}`, "")
					if got.Code != http.StatusOK && got.Code != http.StatusAccepted && got.Code != http.StatusConflict {
						t.Errorf("concurrent POST failed: %d", got.Code)
					}
				}
			}()
		}
		close(start)
		// At most one request may own execution. Wait for every other request
		// before releasing it; this tests the claim race independently of a
		// LocalFS reader observing an output write that is still in progress.
		for range 19 {
			select {
			case <-completed:
			case <-time.After(5 * time.Second):
				close(finish)
				t.Fatal("more than one request blocked inside execution")
			}
		}
		close(finish)
		wg.Wait()
		final := receiptRequest(r, "GET", "/receipts/text/"+key+"/result", "", "", "")
		if final.Code == http.StatusConflict {
			assertReconciledReceipt(t, final, http.StatusConflict, "text", key, model.GenerationReceiptStateNotSubmitted)
			if calls.Load() != 0 {
				t.Fatal("reconciliation won after paid execution started")
			}
		} else if final.Code != http.StatusOK || calls.Load() != 1 {
			t.Fatalf("execution did not win exactly once: code=%d calls=%d", final.Code, calls.Load())
		}
	}
}
