package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestAndRecoveryLogsDoNotDumpCredentials(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, crash := range []bool{false, true} {
		var output bytes.Buffer
		r := gin.New()
		r.Use(RequestID(), SafeAccessLog(&output), SafeRecovery(&output))
		r.POST("/stream", func(c *gin.Context) {
			if crash {
				panic("panic-sensitive-value")
			}
			c.Status(http.StatusOK)
		})
		request := httptest.NewRequest(http.MethodPost, "/stream?access_token=query-sensitive-value&Signature=signed-sensitive-value", strings.NewReader("body-sensitive-value"))
		request.Header.Set("Authorization", "Bearer header-sensitive-value")
		request.Header.Set("Cookie", "session=cookie-sensitive-value")
		request.Header.Set(RequestIDHeader, "safe-request-123")
		result := httptest.NewRecorder()
		r.ServeHTTP(result, request)
		if strings.Contains(output.String(), "sensitive-value") {
			t.Fatal("credential leaked in request/recovery logs")
		}
		for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
			var entry map[string]any
			if err := json.Unmarshal([]byte(line), &entry); err != nil {
				t.Fatal(err)
			}
			if entry["path"] != "/stream" || entry["request_id"] != "safe-request-123" {
				t.Fatalf("log correlation missing: %v", entry)
			}
		}
		if crash && (result.Code != 500 || !strings.Contains(result.Body.String(), `"request_id":"safe-request-123"`)) {
			t.Fatalf("panic response: %d %s", result.Code, result.Body.String())
		}
	}
}
