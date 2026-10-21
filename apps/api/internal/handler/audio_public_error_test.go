package handler

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/ai-manju/api/internal/provider"
)

func TestAudioSpeechPublicError(t *testing.T) {
	deleted := &provider.ProviderHTTPError{
		StatusCode: http.StatusBadRequest,
		Body:       `{"code":"InvalidParameter","message":"voice cosyvoice-v3.5-plus-role01-abc not exist"}`,
	}
	if got := audioSpeechPublicError(deleted); got != "该音色不存在或已被删除，请重新选择音色" {
		t.Fatalf("deleted voice error = %q", got)
	}

	// 经过 uncertainGeneration 包装后仍能识别（errors.As 穿透 %w 链）。
	wrapped := fmt.Errorf("%w: %w", errGenerationSubmissionUncertain, deleted)
	if got := audioSpeechPublicError(wrapped); got != "该音色不存在或已被删除，请重新选择音色" {
		t.Fatalf("wrapped deleted voice error = %q", got)
	}

	// 与音色无关的错误不受影响。
	other := &provider.ProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"message":"text too long"}`}
	if got := audioSpeechPublicError(other); got == "该音色不存在或已被删除，请重新选择音色" {
		t.Fatal("unrelated error should not be mapped to the deleted-voice message")
	}
	if got := audioSpeechPublicError(errors.New("network down")); got == "" {
		t.Fatal("expected a fallback message")
	}
}
