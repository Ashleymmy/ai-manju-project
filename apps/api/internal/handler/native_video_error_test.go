package handler

import (
	"github.com/ai-manju/api/internal/model"
	"strings"
	"testing"
)

func TestNativeVideoJobErrorsDistinguishAcceptedTasksWithoutExposingDiagnostics(t *testing.T) {
	for _, code := range []string{"video_submission_uncertain", "video_result_pending", "provider_request_failed"} {
		got := nativeVideoJobError(model.JSONB(`{"code":"` + code + `","message":"supplier secret https://private.test/?token=private"}`))
		message := got["message"].(string)
		if strings.Contains(message, "secret") || strings.Contains(message, "private") {
			t.Fatal("diagnostics leaked")
		}
		if code != "provider_request_failed" && (!strings.Contains(message, "勿重复") || got["code"] != code) {
			t.Fatalf("accepted task reported as model unavailable: %v", got)
		}
		if code == "provider_request_failed" && message != errGenerationUnavailable.Error() {
			t.Fatal("legacy failure behavior changed")
		}
	}
}

func TestNativeVideoReferenceTimeoutIsNotModelUnavailable(t *testing.T) {
	got := nativeVideoJobError(model.JSONB(`{"code":"video_reference_timeout","message":"private supplier diagnostics"}`))
	if got["code"] != "video_reference_timeout" || !strings.Contains(got["message"].(string), "参考视频") || strings.Contains(got["message"].(string), "private") {
		t.Fatalf("incorrect public reference error: %v", got)
	}
}
