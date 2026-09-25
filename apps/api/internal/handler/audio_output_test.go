package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestSpeechRouteDoesNotDeliverHTMLAsGeneratedAudio(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("<!doctype html><html>private gateway diagnostics</html>"))
	}))
	defer upstream.Close()
	router, repo := newProviderTestRouter(t, "secret")
	config := generationTestConfig("audio-output", "")
	config.AudioModel = "voice"
	config.BaseURL = upstream.URL + "/v1"
	if _, err := repo.UpsertModelProvider(config); err != nil {
		t.Fatal(err)
	}
	cookie := loginCookie(t, router, "member", "secret")
	badInput := performJSON(router, http.MethodPost, "/api/ai/audio/speech", `{"model":"audio-output::voice","input":" "}`, cookie)
	if badInput.Code != 400 || calls != 0 {
		t.Fatal("empty speech input reached supplier")
	}
	rec := performJSON(router, http.MethodPost, "/api/ai/audio/speech", `{"model":"audio-output::voice","input":"hello"}`, cookie)
	if rec.Code != 502 || strings.Contains(rec.Body.String(), "private gateway") || calls != model.GenerationAttemptsPerProvider {
		t.Fatalf("invalid response: status=%d calls=%d", rec.Code, calls)
	}
}

func TestSpeechRejectsNonMediaSuccessfulResponses(t *testing.T) {
	for _, tc := range []struct{ body, contentType string }{
		{"", "audio/mpeg"},
		{"<html><body>sign in</body></html>", "text/html"},
		{"  <!doctype html><html>gateway error</html>", "audio/mpeg"},
		{`{"success":true,"task_id":"not-audio"}`, "application/json"},
		{`{"error":"rejected"}`, "application/octet-stream"},
		{"plain error", "text/plain"},
	} {
		if validSpeechOutput([]byte(tc.body), tc.contentType) {
			t.Errorf("accepted non-media response type=%s", tc.contentType)
		}
	}
	for _, tc := range []struct{ body, contentType string }{
		{"audio-bytes", "audio/mpeg"},
		{"\x00\x01\xff\x00", "application/octet-stream"},
		{"OggS\x00\x01", "application/ogg"},
	} {
		if !validSpeechOutput([]byte(tc.body), tc.contentType) {
			t.Errorf("rejected supported response type=%s", tc.contentType)
		}
	}
}
