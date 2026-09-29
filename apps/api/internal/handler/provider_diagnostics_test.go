package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/provider"
	"github.com/gin-gonic/gin"
)

func TestProviderDiagnosticKeepsActualResponseAndTransport(t *testing.T) {
	err := &provider.ProviderHTTPError{Method: "POST", URL: "https://host/generate?key=SECRET", StatusCode: 422, RequestID: "header-id", Body: `{"error":{"code":"bad_audio","message":"Unsupported audio"},"prompt":"PRIVATE"}`}
	d := monitoring.ReadDiagnostics(providerDiagnostics(err))
	if d.ProviderResponseReceived == nil || !*d.ProviderResponseReceived || d.ProviderRequestID != "header-id" || d.ProviderCode != "bad_audio" || !strings.Contains(d.ProviderBody, "Unsupported audio") {
		t.Fatal(d)
	}
	if strings.Contains(string(providerDiagnostics(err)), "PRIVATE") || strings.Contains(string(providerDiagnostics(err)), "SECRET") {
		t.Fatal("unsafe diagnostic")
	}
	d = monitoring.ReadDiagnostics(providerDiagnostics(&url.Error{Op: "Post", URL: "https://host/api", Err: errors.New("dial tcp: lookup host: no such host")}))
	if d.ProviderResponseReceived == nil || *d.ProviderResponseReceived || d.ProviderBody != "" || !strings.Contains(d.ExceptionMessage, "no such host") {
		t.Fatal(d)
	}
}

func TestAIRequestLogKeepsObservedStatusWithoutReclassifyingError(t *testing.T) {
	ctx, _ := monitoring.WithObservation(context.Background())
	req := httptest.NewRequest("POST", "https://vendor/generate", nil).WithContext(ctx)
	monitoring.ObserveFailure(req, &http.Response{StatusCode: 200, Header: http.Header{"X-Request-Id": {"vendor-id"}}}, `{"success":false,"error":{"message":"real rejected request","code":422}}`, nil)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	entry, _, _ := buildAIRequestLog(c, aiRequestLogInput{Err: errors.New("real rejected request")})
	d := monitoring.ReadDiagnostics(entry.Diagnostics)
	if entry.ProviderStatus != 200 || d.ProviderCode != "422" || d.ProviderRequestID != "vendor-id" || d.ExceptionMessage != "real rejected request" {
		t.Fatal(entry, d)
	}
	success, _, _ := buildAIRequestLog(c, aiRequestLogInput{})
	if len(success.Diagnostics) != 0 || success.ProviderStatus != 0 {
		t.Fatal("observation became a false failure", success)
	}
}
