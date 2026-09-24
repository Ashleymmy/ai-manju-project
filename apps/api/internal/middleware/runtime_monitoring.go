package middleware

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

// Diagnostic writes are bounded and independent of a disconnected client.
const monitoringWriteTimeout = 2 * time.Second

type errorCaptureWriter struct {
	gin.ResponseWriter
	body bytes.Buffer
}

func (w *errorCaptureWriter) Write(data []byte) (int, error) {
	if w.Status() >= http.StatusBadRequest && strings.Contains(w.Header().Get("Content-Type"), "json") {
		remaining := monitoring.MaxCaptureBytes - w.body.Len()
		if remaining > 0 {
			w.body.Write(data[:min(len(data), remaining)])
		}
	}
	return w.ResponseWriter.Write(data)
}
func (w *errorCaptureWriter) WriteString(data string) (int, error) { return w.Write([]byte(data)) }

func RuntimeMonitoring(repo repository.RuntimeMonitoringRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now().UTC()
		writer := &errorCaptureWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		c.Next()
		if writer.Status() < http.StatusBadRequest || c.GetBool(monitoring.AIRecordedKey) || c.FullPath() == "/api/monitoring/client-errors" {
			return
		}
		user, _ := auth.CurrentUser(c)
		endpoint := c.FullPath()
		if endpoint == "" {
			endpoint = c.Request.URL.EscapedPath()
		}
		message, code, reason, suggestion := capturedError(writer.body.Bytes())
		if stack := c.GetString(monitoring.PanicStackKey); stack != "" {
			code, reason = "internal_panic", stack
		}
		if message == "" {
			message = http.StatusText(writer.Status())
		}
		if code == "" {
			code = fmt.Sprintf("http_%d", writer.Status())
		}
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			log.Printf("event=monitoring_id_failed")
			return
		}
		event := model.RuntimeError{ID: "runtime_" + hex.EncodeToString(id), UserID: user.ID, Source: "api", RequestID: response.RequestID(c),
			Endpoint: endpoint, Method: c.Request.Method, Operation: c.Request.Method + " " + endpoint, HTTPStatus: writer.Status(), DurationMS: time.Since(started).Milliseconds(),
			ErrorCode: code, Message: message, Detail: reason, Suggestion: suggestion, CreatedAt: started}
		ctx, cancel := context.WithTimeout(context.Background(), monitoringWriteTimeout)
		defer cancel()
		if err := repo.Record(ctx, event); err != nil {
			log.Printf("event=monitoring_write_failed request_id=%q", response.RequestID(c))
		}
	}
}
func capturedError(raw []byte) (message, code, reason, suggestion string) {
	var envelope map[string]any
	if json.Unmarshal(raw, &envelope) != nil {
		return
	}
	text := func(value any) string { s, _ := value.(string); return s }
	message = text(envelope["error"])
	if value, ok := envelope["error"].(map[string]any); ok {
		message = text(value["message"])
		code = text(value["code"])
	}
	if value, ok := envelope["data"].(map[string]any); ok {
		if message == "" {
			message = text(value["message"])
		}
		if code == "" {
			code = text(value["code"])
		}
		reason = text(value["reason"])
		suggestion = text(value["suggestion"])
	}
	return
}
