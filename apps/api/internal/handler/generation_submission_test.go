package handler

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

func TestTextAmbiguousSubmissionDoesNotReplayOrSwitchProvider(t *testing.T) {
	for _, scenario := range []string{"5xx", "408", "truncated", "malformed"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				switch scenario {
				case "5xx":
					w.WriteHeader(503)
				case "408":
					w.WriteHeader(408)
				case "truncated":
					w.Header().Set("Content-Length", "1000")
				}
				_, _ = w.Write([]byte("private incomplete response"))
			}))
			defer upstream.Close()
			config := generationTestConfig("supplier", "")
			config.BaseURL, config.TextModel = upstream.URL+"/v1", "text"
			candidates := []modelSelection{{Config: config, Model: "text"}, {Config: config, Model: "text"}}
			_, _, err := generateTextWithCandidates(context.Background(), candidates, provider.TextGenerationRequest{Prompt: "test"})
			if calls != 1 || !errors.Is(err, errGenerationSubmissionUncertain) {
				t.Fatalf("ambiguous call replayed: calls=%d err=%v", calls, err)
			}
			if strings.Contains(generationPublicError(err), "private") || !strings.Contains(generationPublicError(err), "请勿重复") {
				t.Fatal("unsafe public message")
			}
		})
	}
}

func TestAudioAmbiguousSubmissionDoesNotReplayOrSwitchProvider(t *testing.T) {
	for _, scenario := range []string{"5xx", "408", "truncated"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				w.Header().Set("Content-Type", "audio/mpeg")
				if scenario == "5xx" {
					w.WriteHeader(502)
				} else if scenario == "408" {
					w.WriteHeader(408)
				} else {
					w.Header().Set("Content-Length", "1000")
				}
				_, _ = w.Write([]byte("private-partial-audio"))
			}))
			defer upstream.Close()
			router, repo := newProviderTestRouter(t, "secret")
			for _, id := range []string{"audio-a", "audio-b"} {
				config := generationTestConfig(id, "")
				config.AudioModel, config.BaseURL = "voice", upstream.URL+"/v1"
				_, _ = repo.UpsertModelProvider(config)
			}
			cookie := loginCookie(t, router, "member", "secret")
			result := performJSON(router, http.MethodPost, "/api/ai/audio/speech", `{"model":"audio-a::voice","input":"hello"}`, cookie)
			if result.Code != 502 || calls != 1 || !strings.Contains(result.Body.String(), "请勿重复提交") || strings.Contains(result.Body.String(), "private") {
				t.Fatalf("unsafe audio handling: status=%d calls=%d", result.Code, calls)
			}
		})
	}
}

func TestGenerationRetryRequiresProvenRejection(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 409, 422, 429} {
		if !safeToRepeatGeneration(&provider.ProviderHTTPError{StatusCode: status}) {
			t.Fatalf("definite rejection %d not retryable", status)
		}
	}
	for _, err := range []error{context.DeadlineExceeded, io.ErrUnexpectedEOF, &net.OpError{Op: "read", Err: io.EOF}, &provider.ProviderHTTPError{StatusCode: 408}, &provider.ProviderHTTPError{StatusCode: 502}} {
		if safeToRepeatGeneration(err) {
			t.Fatalf("unsafe retry: %T", err)
		}
	}
	if !safeToRepeatGeneration(&net.OpError{Op: "dial", Err: errors.New("connection refused")}) {
		t.Fatal("preconnection failure cannot retry")
	}
	if safeToRepeatGeneration(&url.Error{Op: "Get", URL: "http://provider.test/receipt", Err: &net.OpError{Op: "dial", Err: errors.New("connection refused")}}) {
		t.Fatal("redirected receipt dial failure must not replay original POST")
	}
}

func TestTextSubmissionRedirectCannotReplayPaidPOST(t *testing.T) {
	for _, status := range []int{http.StatusTemporaryRedirect, http.StatusPermanentRedirect, http.StatusSeeOther} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			posts, gets := 0, 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					posts++
				} else {
					gets++
				}
				if r.URL.Path == "/receipt" {
					http.Error(w, "private receipt missing", 404)
					return
				}
				http.Redirect(w, r, "/receipt", status)
			}))
			defer upstream.Close()
			config := generationTestConfig("supplier", "")
			config.BaseURL, config.TextModel = upstream.URL+"/v1", "text"
			_, _, err := generateTextWithCandidates(context.Background(), []modelSelection{{Config: config, Model: "text"}, {Config: config, Model: "text"}}, provider.TextGenerationRequest{Prompt: "test"})
			if posts != 1 || !errors.Is(err, errGenerationSubmissionUncertain) {
				t.Fatalf("redirect replayed paid request: posts=%d err=%v", posts, err)
			}
			if status == http.StatusSeeOther && gets != 1 {
				t.Fatal("safe receipt GET was lost")
			}
		})
	}
}

func TestTextReceiptConnectionFailureDoesNotReplayPOST(t *testing.T) {
	posts := 0
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts++
		w.Header().Set("Connection", "close")
		_ = upstream.Listener.Close()
		http.Redirect(w, r, "/receipt", http.StatusSeeOther)
	}))
	defer upstream.Close()
	config := generationTestConfig("supplier", "")
	config.BaseURL, config.TextModel = upstream.URL+"/v1", "text"
	_, _, err := generateTextWithCandidates(context.Background(), []modelSelection{{Config: config, Model: "text"}}, provider.TextGenerationRequest{Prompt: "test"})
	if posts != 1 || !errors.Is(err, provider.ErrSubmissionReceiptInterrupted) || !errors.Is(err, errGenerationSubmissionUncertain) {
		t.Fatalf("receipt connection error not isolated: posts=%d err=%v", posts, err)
	}
}

func TestComicTextErrorsNeverExposeWrappedSupplierResponse(t *testing.T) {
	for _, status := range []int{429, 503} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "private-provider-details", status) }))
			defer upstream.Close()
			repo := repository.NewMemoryModelProviderRepository()
			config := generationTestConfig("supplier", "")
			config.BaseURL, config.TextModel = upstream.URL+"/v1", "text"
			_, _ = repo.UpsertModelProvider(config)
			h := NewModelProviderHandler(repo, provider.NewSecretBox("test"))
			_, err := h.GenerateBackgroundText(context.Background(), "supplier::text", provider.TextGenerationRequest{Prompt: "test"})
			if err == nil || strings.Contains(err.Error(), "private-provider-details") || strings.Contains(err.Error(), upstream.URL) {
				t.Fatalf("unsafe comic error %v", err)
			}
			if status == 503 && !errors.Is(err, service.ErrComicTextSubmissionUncertain) {
				t.Fatal("uncertainty lost")
			}
		})
	}
}
