package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestIDGeneratesHeader(t *testing.T) {
	router := newRequestIDTestRouter()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ping", nil)

	router.ServeHTTP(recorder, request)

	requestID := recorder.Header().Get(RequestIDHeader)
	if requestID == "" {
		t.Fatalf("%s header is empty", RequestIDHeader)
	}
	if recorder.Body.String() != requestID {
		t.Fatalf("body request id = %q, want %q", recorder.Body.String(), requestID)
	}
}

func TestRequestIDPropagatesHeader(t *testing.T) {
	router := newRequestIDTestRouter()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ping", nil)
	request.Header.Set(RequestIDHeader, "test-request-id")

	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get(RequestIDHeader); got != "test-request-id" {
		t.Fatalf("%s header = %q, want test-request-id", RequestIDHeader, got)
	}
	if recorder.Body.String() != "test-request-id" {
		t.Fatalf("body request id = %q, want test-request-id", recorder.Body.String())
	}
}

func newRequestIDTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestID())
	router.GET("/ping", func(c *gin.Context) {
		value, _ := c.Get("request_id")
		requestID, _ := value.(string)
		c.String(http.StatusOK, requestID)
	})
	return router
}
