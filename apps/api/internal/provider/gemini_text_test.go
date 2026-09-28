package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/httpsecurity"
	"github.com/ai-manju/api/internal/model"
)

const geminiTestPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWo0AAAAASUVORK5CYII="

func TestGeminiNativeTextRetainsImagesRolesAndSystemInstruction(t *testing.T) {
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts++
		if r.Method != "POST" || r.URL.Path != "/v1beta/models/gemini:generateContent" {
			t.Errorf("unexpected generation request %s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		contents := body["contents"].([]any)
		if len(contents) != 3 || contents[1].(map[string]any)["role"] != "model" {
			t.Errorf("conversation lost: %#v", contents)
		}
		parts := contents[2].(map[string]any)["parts"].([]any)
		inline := parts[1].(map[string]any)["inlineData"].(map[string]any)
		if inline["mimeType"] != "image/png" || inline["data"] != geminiTestPNG {
			t.Error("image lost")
		}
		system := body["systemInstruction"].(map[string]any)["parts"].([]any)
		if system[0].(map[string]any)["text"] != "Describe faithfully" {
			t.Error("system prompt lost")
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"one image"}]}}]}`))
	}))
	defer server.Close()
	client, _ := NewOpenAICompatibleClient(model.ModelProviderConfig{BaseURL: server.URL + "/v1beta", TextModel: "gemini", AuthType: model.ModelProviderAuthTypeXGoogAPIKey, TimeoutMS: 1000}, "test")
	result, err := client.GenerateTextRequest(context.Background(), TextGenerationRequest{Messages: []map[string]any{
		{"role": "system", "content": "Describe faithfully"},
		{"role": "user", "content": "hello"},
		{"role": "assistant", "content": "show me"},
		{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": "Describe this"}, map[string]any{"type": "input_image", "image_url": map[string]any{"url": "data:image/png;base64," + geminiTestPNG}}}},
	}})
	if err != nil || result.Text != "one image" || posts != 1 {
		t.Fatalf("result=%+v err=%v posts=%d", result, err, posts)
	}
}

func TestGeminiTextReferenceFetchIsCredentiallessAndRejectsInvalidImagesBeforePOST(t *testing.T) {
	posts, gets := 0, 0
	png, _ := base64.StdEncoding.DecodeString(geminiTestPNG)
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gets++
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Goog-Api-Key") != "" || r.Header.Get("X-Secret") != "" {
			t.Error("reference leaked provider credentials")
		}
		if r.URL.Path == "/bad" {
			_, _ = w.Write([]byte("<html>expired</html>"))
			return
		}
		_, _ = w.Write(png)
	}))
	defer media.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { posts++ }))
	defer upstream.Close()
	client, _ := NewOpenAICompatibleClient(model.ModelProviderConfig{BaseURL: upstream.URL + "/v1beta", TextModel: "gemini", AuthType: model.ModelProviderAuthTypeXGoogAPIKey, TimeoutMS: 1000}, "test")
	client.mediaClient = httpsecurity.NewMediaClient(time.Second, media.URL)
	data, mime, err := client.geminiTextImage(context.Background(), media.URL+"/ok", geminiTextReferenceBytes)
	if err != nil || len(data) != len(png) || mime != "image/png" {
		t.Fatal("reference fetch failed", err)
	}
	for _, raw := range []string{media.URL + "/bad", "data:image/png;base64,invalid", "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<html>error</html>")), "http://169.254.169.254/latest/meta-data/"} {
		_, err := client.GenerateTextRequest(context.Background(), TextGenerationRequest{Messages: []map[string]any{{"role": "user", "content": []map[string]any{{"type": "image_url", "image_url": raw}}}}})
		if !errors.Is(err, ErrTextInputNotSubmitted) {
			t.Errorf("input silently ignored or submitted: %v", err)
		}
		if err != nil && strings.Contains(err.Error(), "169.254") {
			t.Error("reference URL leaked")
		}
	}
	if posts != 0 || gets != 2 {
		t.Fatalf("posts=%d gets=%d", posts, gets)
	}
	if _, _, err := client.geminiTextImage(context.Background(), "data:image/png;base64,"+geminiTestPNG, 1); !errors.Is(err, ErrTextInputNotSubmitted) {
		t.Fatal("reference limit ignored")
	}
}
