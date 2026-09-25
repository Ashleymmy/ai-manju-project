package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/httpsecurity"
	"github.com/ai-manju/api/internal/model"
)

func TestProxyBlobCDNRedirectDropsProviderAuth(t *testing.T) {
	hits := 0
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		for _, name := range []string{"Authorization", "X-Api-Key", "Referer", "Cookie"} {
			if r.Header.Get(name) != "" {
				t.Errorf("leaked %s", name)
			}
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("video-body"))
	}))
	defer cdn.Close()
	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("missing provider auth")
		}
		http.Redirect(w, r, cdn.URL+"/signed-output?signature=dummy", http.StatusTemporaryRedirect)
	}))
	defer start.Close()
	client, err := NewOpenAICompatibleClient(model.ModelProviderConfig{BaseURL: start.URL, AuthType: model.ModelProviderAuthTypeBearer, TimeoutMS: 1000}, "dummy")
	if err != nil {
		t.Fatal(err)
	}
	// The CDN is explicitly trusted only for the local test fixture.
	client.mediaClient = httpsecurity.NewMediaClient(time.Second, cdn.URL)
	data, kind, err := client.ProxyBlob(context.Background(), http.MethodGet, "/videos/task/content", nil, false)
	if err != nil || string(data) != "video-body" || kind != "video/mp4" || hits != 1 {
		t.Fatalf("content redirect failed: kind=%s hits=%d err=%v", kind, hits, err)
	}
	_, _, err = client.ProxyBlob(context.Background(), http.MethodPost, "/audio/speech", map[string]any{"input": "hello"}, true)
	if err == nil || hits != 1 {
		t.Fatal("must not follow foreign paid POST redirect")
	}
}

func TestProxyBlobRejectsPrivateForeignRedirect(t *testing.T) {
	hits := 0
	private := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer private.Close()
	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, private.URL, http.StatusFound) }))
	defer start.Close()
	client, _ := NewOpenAICompatibleClient(model.ModelProviderConfig{BaseURL: start.URL, AuthType: model.ModelProviderAuthTypeNone, TimeoutMS: 1000}, "")
	_, _, err := client.ProxyBlob(context.Background(), http.MethodGet, "/videos/task/content", nil, false)
	if err == nil || hits != 0 {
		t.Fatal("followed private foreign redirect")
	}
}
