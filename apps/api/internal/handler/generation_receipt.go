package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	// Match the existing media request/output bounds; never cache a truncated
	// successful response. Receipts are opt-in and do not change legacy calls.
	generationReceiptMaxBodyBytes = 512 * 1024 * 1024
	generationReceiptSaveTimeout  = 2 * time.Minute
	// Exposed to clients so a delivered result can be retained locally even if
	// the recovery store is temporarily unavailable.
	GenerationReceiptStateHeader = "X-Generation-Receipt-State"
)

func (h *AIHandler) SetGenerationReceiptService(receipts *service.GenerationReceiptService) {
	h.receipts = receipts
}

func generationReceiptScope(c *gin.Context, kind, key string) service.GenerationReceiptScope {
	user := auth.MustCurrentUser(c)
	return service.GenerationReceiptScope{UserID: user.ID, WorkspaceID: service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), Kind: kind, Key: key}
}

// WithGenerationReceipt claims an idempotency key before invoking a synchronous
// handler. The handler remains in this goroutine; neither Gin's context nor its
// writer is retained after return. Supplier execution is bounded independently
// of a browser disconnect, and output is durable before it is sent to the client.
func (h *AIHandler) WithGenerationReceipt(kind string, next gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if key == "" {
			next(c)
			return
		}
		c.Header("Cache-Control", "no-store")
		if h.receipts == nil {
			response.Error(c, http.StatusServiceUnavailable, "生成结果恢复服务暂时不可用，尚未提交生成")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, generationReceiptMaxBodyBytes+1))
		if err != nil || len(raw) > generationReceiptMaxBodyBytes {
			response.Error(c, http.StatusBadRequest, "生成请求读取失败或过大，尚未提交生成")
			return
		}
		var body any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
			response.Error(c, http.StatusBadRequest, "生成请求不是有效的 JSON，尚未提交生成")
			return
		}
		hash, err := service.GenerationReceiptRequestHash(body)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "生成请求无效，尚未提交生成")
			return
		}
		scope := generationReceiptScope(c, kind, key)
		receipt, claimed, err := h.receipts.Begin(c.Request.Context(), scope, hash)
		if err != nil {
			generationReceiptError(c, err)
			return
		}
		if !claimed {
			h.replyGenerationReceipt(c, scope)
			return
		}

		originalRequest, originalWriter := c.Request, c.Writer
		ctx, cancel := context.WithTimeout(context.WithoutCancel(originalRequest.Context()), service.SyncGenerationExecutionTimeout)
		defer cancel()
		buffer := newGenerationReceiptWriter(originalWriter)
		c.Writer = buffer
		c.Request = originalRequest.WithContext(ctx)
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		// Restore the real writer even if a handler panics. An uncompleted receipt
		// stays non-repeatable and becomes uncertain at its existing deadline.
		defer func() { c.Writer, c.Request = originalWriter, originalRequest }()
		next(c)
		c.Writer, c.Request = originalWriter, originalRequest

		saveCtx, saveCancel := context.WithTimeout(context.Background(), generationReceiptSaveTimeout)
		defer saveCancel()
		if buffer.overflow || !buffer.Written() {
			_ = h.receipts.Fail(saveCtx, receipt, "生成返回结果不完整，请勿重复生成，请联系管理员核查", true)
			response.Error(c, http.StatusBadGateway, "生成返回结果不完整，请勿重复生成，请联系管理员核查")
			return
		}
		if buffer.Status() < http.StatusOK || buffer.Status() >= http.StatusMultipleChoices {
			message := generationReceiptFailureMessage(buffer.body.Bytes())
			uncertain := strings.Contains(message, errGenerationSubmissionUncertain.Error())
			if err := h.receipts.Fail(saveCtx, receipt, message, uncertain); err != nil {
				response.Error(c, http.StatusServiceUnavailable, "生成状态保存暂时失败，请查询原请求，请勿重复生成")
				return
			}
			copyGenerationReceiptHeaders(c.Writer.Header(), buffer.Header())
			c.Data(buffer.Status(), buffer.Header().Get("Content-Type"), buffer.body.Bytes())
			return
		}
		result := service.GenerationReceiptResult{ContentType: buffer.Header().Get("Content-Type"), Body: buffer.body.Bytes()}
		copyGenerationReceiptHeaders(c.Writer.Header(), buffer.Header())
		if err := h.receipts.Complete(saveCtx, receipt, result); err != nil {
			// Do not throw away valid output merely because its recovery store is
			// unavailable. The connected client can still retain/save the output;
			// the durable claim prevents an ambiguous duplicate paid request.
			_ = h.receipts.Fail(saveCtx, receipt, "结果保存状态待确认，请勿重复生成，请联系管理员核查", true)
			c.Header(GenerationReceiptStateHeader, "unavailable")
			log.Printf("receipt_id=%s event=generation_receipt_persistence_pending", receipt.ID)
		}
		c.Data(buffer.Status(), result.ContentType, result.Body)
	}
}

func copyGenerationReceiptHeaders(dst, src http.Header) {
	for key, values := range src {
		dst[key] = append([]string(nil), values...)
	}
	// Private result responses must not acquire cacheable headers from the
	// underlying handler now or in a future implementation.
	dst.Set("Cache-Control", "no-store")
}

func generationReceiptFailureMessage(body []byte) string {
	var failure struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &failure) == nil && failure.Error != "" {
		return failure.Error
	}
	return "生成请求未完成，请检查配置或联系管理员"
}

func generationReceiptView(receipt model.GenerationReceipt) gin.H {
	return gin.H{"kind": receipt.Kind, "key": receipt.Key, "status": receipt.State,
		"error": receipt.Error, "deadline": receipt.Deadline, "expires_at": receipt.ExpiresAt}
}

func (h *AIHandler) GenerationReceiptStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if h.receipts == nil {
		generationReceiptError(c, service.ErrGenerationReceiptUnavailable)
		return
	}
	receipt, _, err := h.receipts.Lookup(c.Request.Context(), generationReceiptScope(c, c.Param("kind"), c.Param("key")))
	if err != nil {
		generationReceiptError(c, err)
		return
	}
	response.OK(c, generationReceiptView(receipt))
}

func (h *AIHandler) GenerationReceiptResult(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	h.replyGenerationReceipt(c, generationReceiptScope(c, c.Param("kind"), c.Param("key")))
}

func (h *AIHandler) GenerationReceiptReconcile(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if h.receipts == nil {
		generationReceiptError(c, service.ErrGenerationReceiptUnavailable)
		return
	}
	receipt, err := h.receipts.Reconcile(c.Request.Context(), generationReceiptScope(c, c.Param("kind"), c.Param("key")))
	if err != nil {
		generationReceiptError(c, err)
		return
	}
	response.OK(c, gin.H{"receipt": generationReceiptView(receipt)})
}

func (h *AIHandler) replyGenerationReceipt(c *gin.Context, scope service.GenerationReceiptScope) {
	if h.receipts == nil {
		generationReceiptError(c, service.ErrGenerationReceiptUnavailable)
		return
	}
	receipt, result, err := h.receipts.Lookup(c.Request.Context(), scope)
	if err != nil {
		generationReceiptError(c, err)
		return
	}
	if result != nil && receipt.State == model.GenerationReceiptStateSucceeded {
		c.Data(http.StatusOK, result.ContentType, result.Body)
		return
	}
	if receipt.State == model.GenerationReceiptStateRunning {
		response.Accepted(c, gin.H{"receipt": generationReceiptView(receipt)})
		return
	}
	status := http.StatusConflict
	if receipt.State == model.GenerationReceiptStateFailed {
		status = http.StatusBadGateway
	}
	if receipt.State == model.GenerationReceiptStateExpired {
		status = http.StatusGone
	}
	message := receipt.Error
	if message == "" {
		message = "原生成结果暂时无法取回，请勿重复生成，请联系管理员核查"
	}
	response.ErrorWithData(c, status, message, gin.H{"receipt": generationReceiptView(receipt)})
}

func generationReceiptError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrGenerationReceiptNotFound):
		response.Error(c, http.StatusNotFound, "没有找到当前账号和空间的生成请求")
	case errors.Is(err, service.ErrGenerationReceiptConflict):
		response.Error(c, http.StatusConflict, "同一次生成请求的内容已改变，请先取回原结果")
	case errors.Is(err, service.ErrGenerationReceiptInvalid):
		response.Error(c, http.StatusBadRequest, "生成请求标识无效")
	default:
		response.Error(c, http.StatusServiceUnavailable, "生成结果恢复服务暂时不可用，请勿重复生成")
	}
}

type generationReceiptWriter struct {
	gin.ResponseWriter
	header   http.Header
	body     bytes.Buffer
	status   int
	written  bool
	overflow bool
}

func newGenerationReceiptWriter(writer gin.ResponseWriter) *generationReceiptWriter {
	return &generationReceiptWriter{ResponseWriter: writer, header: writer.Header().Clone(), status: http.StatusOK}
}
func (w *generationReceiptWriter) Header() http.Header { return w.header }
func (w *generationReceiptWriter) WriteHeader(code int) {
	if !w.written {
		w.status = code
	}
}
func (w *generationReceiptWriter) WriteHeaderNow() { w.written = true }
func (w *generationReceiptWriter) Write(data []byte) (int, error) {
	w.written = true
	if len(data) > generationReceiptMaxBodyBytes-w.body.Len() {
		w.overflow = true
		return 0, errors.New("generation result exceeds receipt size limit")
	}
	return w.body.Write(data)
}
func (w *generationReceiptWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }
func (w *generationReceiptWriter) Status() int                       { return w.status }
func (w *generationReceiptWriter) Size() int {
	if !w.written {
		return -1
	}
	return w.body.Len()
}
func (w *generationReceiptWriter) Written() bool { return w.written }
func (w *generationReceiptWriter) Flush()        { w.WriteHeaderNow() }
