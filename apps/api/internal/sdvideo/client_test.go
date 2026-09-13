package sdvideo

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
)

func TestClientCreateTaskSignsAndUnwrapsStandaloneEnvelope(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/tasks" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") == "" {
			t.Fatal("missing service authorization")
		}
		_, _ = w.Write([]byte(`{"success":true,"data":{"task_id":"sdv_test","status":"queued"},"error":null,"request_id":"req-1"}`))
	}))
	defer server.Close()

	_ = public
	cfg := config.Config{
		SDVideoBaseURL:             server.URL,
		SDVideoMode:                "active",
		SDVideoJWTPrivateKey:       base64.RawStdEncoding.EncodeToString(private),
		SDVideoJWTIssuer:           "ai-manju-studio",
		SDVideoJWTAudience:         "sd-video",
		SDVideoJWTKeyID:            "test",
		SDVideoRequestTimeoutMilli: 1000,
	}
	client := NewClient(cfg)
	if !client.Enabled() {
		t.Fatal("client should be enabled")
	}
	response, err := client.CreateTask(context.Background(), model.User{ID: "user-1", Role: "member"}, "workspace-1", map[string]any{"model": "seedance-2.0"})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Data, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["task_id"] != "sdv_test" {
		t.Fatalf("data = %v", payload)
	}
}

func TestClientUploadInputPresignsAndUploadsWithServiceToken(t *testing.T) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/inputs/presign" {
			_, _ = w.Write([]byte(`{"success":true,"data":{"upload_token":"inputs/workspace/user/file.png"},"error":null,"request_id":"presign-1"}`))
			return
		}
		if r.Method == http.MethodPut && r.URL.Path == "/v1/inputs/inputs/workspace/user/file.png" {
			body := make([]byte, 32)
			n, _ := r.Body.Read(body)
			if string(body[:n]) != "image-bytes" {
				t.Fatalf("uploaded body = %q", body[:n])
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"storage_key":"inputs/workspace/user/file.png"},"error":null,"request_id":"upload-1"}`))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v1/inputs/complete" {
			var payload map[string]string
			if json.NewDecoder(r.Body).Decode(&payload) != nil {
				t.Error("invalid completion body")
			}
			digest := sha256.Sum256([]byte("image-bytes"))
			if payload["sha256"] != hex.EncodeToString(digest[:]) || payload["upload_token"] != "inputs/workspace/user/file.png" {
				t.Error("missing input checksum")
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{},"error":null,"request_id":"complete-1"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	client := NewClient(config.Config{
		SDVideoBaseURL: server.URL, SDVideoMode: "active",
		SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private),
		SDVideoJWTIssuer:     "ai-manju-studio", SDVideoJWTAudience: "sd-video",
		SDVideoJWTKeyID: "test", SDVideoRequestTimeoutMilli: 1000,
	})
	token, err := client.UploadInput(context.Background(), model.User{ID: "user"}, "workspace", "file.png", "image/png", []byte("image-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if token != "inputs/workspace/user/file.png" {
		t.Fatalf("token = %s", token)
	}
}
