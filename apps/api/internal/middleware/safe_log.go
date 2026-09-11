package middleware

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

// 只记录路径，不记录 query、Header、Body 或 c.Errors 中的上游原文。
// SSE 的 access_token 和对象存储签名不得进入访问日志。
func SafeAccessLog(writer io.Writer) gin.HandlerFunc {
	return gin.LoggerWithConfig(gin.LoggerConfig{Output: writer, Formatter: func(p gin.LogFormatterParams) string {
		body, _ := json.Marshal(map[string]any{
			"event": "http_request", "time": p.TimeStamp.UTC().Format(time.RFC3339Nano),
			"method": p.Method, "path": p.Request.URL.EscapedPath(), "status": p.StatusCode,
			"duration_ms": p.Latency.Milliseconds(), "request_id": p.Keys["request_id"],
		})
		return string(body) + "\n"
	}})
}

// Gin 默认 Recovery 会转储完整 URL/Header。保留调用栈，但不输出 panic 值或请求转储。
func SafeRecovery(writer io.Writer) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		body, _ := json.Marshal(map[string]any{"event": "http_panic", "request_id": response.RequestID(c),
			"path": c.Request.URL.EscapedPath(), "stack": string(debug.Stack())})
		fmt.Fprintln(writer, string(body))
		c.Abort()
		response.Error(c, http.StatusInternalServerError, "internal server error")
	})
}
