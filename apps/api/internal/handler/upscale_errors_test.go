package handler

import (
	"errors"
	"net/http"
	"testing"

	"github.com/ai-manju/api/internal/provider"
)

func TestUpscaleInputRejectedOnlyAdvisesUserFixableProblems(t *testing.T) {
	cases := []struct {
		text  string
		video bool
		want  bool
	}{
		{`{"Code":"InvalidFile.Resolution","Message":"image resolution exceeds limit"}`, false, true},
		{`{"Code":"InvalidImage.Size","Message":"image too large"}`, false, true},
		{`{"Code":"InvalidFile.Type","Message":"unsupported image format"}`, false, true},
		{`{"Code":"InvalidFile.Download","Message":"download failed"}`, false, true},
		{"InvalidFile.Resolution video resolution must be less than 1920x1080", true, true},
		{`{"Code":"Throttling.User","Message":"Request was denied due to user flow control."}`, false, false},
		{`{"Code":"InvalidAccessKeyId.NotFound","Message":"Specified access key is not found."}`, false, false},
		{`{"Code":"Unauthorized","Message":"service not open"}`, true, false},
		{`{"Code":"InternalError","Message":"image size check failed"}`, false, false},
		{"", false, false},
	}
	for _, tc := range cases {
		got := upscaleInputRejected(tc.text, tc.video) != ""
		if got != tc.want {
			t.Fatalf("upscaleInputRejected(%q, %v) advice=%v, want %v", tc.text, tc.video, got, tc.want)
		}
	}
}

func TestUpscaleRateLimitedRecognisesAliyunThrottling(t *testing.T) {
	throttled := &provider.ProviderHTTPError{StatusCode: http.StatusBadGateway, Body: `{"Code":"Throttling.User"}`}
	if !upscaleRateLimited(throttled) {
		t.Fatal("Throttling.User should be treated as rate limited")
	}
	if upscaleRateLimited(errors.New("boom")) {
		t.Fatal("plain errors are not rate limits")
	}
}
