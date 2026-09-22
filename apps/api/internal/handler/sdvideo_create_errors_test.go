package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestRespondSDVideoCreateErrorMapsAdmissionFailures(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		statusCode int
		message    string
	}{
		{
			name:       "concurrency",
			err:        service.ErrConcurrencyLimitExceeded,
			statusCode: http.StatusTooManyRequests,
			message:    "当前视频任务并发已达上限，请等待进行中的任务完成后重试",
		},
		{
			name:       "credits",
			err:        repository.ErrInsufficientCredits,
			statusCode: http.StatusPaymentRequired,
			message:    "积分余额不足，请充值后重试",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodPost, "/api/ai/contents/generations/tasks", nil)
			context.Set("request_id", "req-sdvideo-error")

			respondSDVideoCreateError(context, tc.err)

			if recorder.Code != tc.statusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.statusCode)
			}
			var envelope struct {
				Success bool   `json:"success"`
				Error   string `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Success || envelope.Error != tc.message {
				t.Fatalf("envelope = %+v, want failure %q", envelope, tc.message)
			}
		})
	}

	if errors.Is(service.ErrConcurrencyLimitExceeded, repository.ErrInsufficientCredits) {
		t.Fatal("admission and credit errors must remain distinct")
	}
}
