package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
)

func testStorageToken(changes map[string]any) string {
	now := time.Now().Unix()
	claims := map[string]any{"role": studioStorageRole, "sub": "service-id", "iat": now, "exp": now + 300, "storage_buckets": []string{"studio-test-assets"}}
	for key, value := range changes {
		claims[key] = value
	}
	body, _ := json.Marshal(claims)
	return base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA"}`)) + "." + base64.RawURLEncoding.EncodeToString(body) + ".test-signature"
}

func testSupabase(t *testing.T, handler http.HandlerFunc) (*SupabaseStorage, config.Config) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	cfg := config.Config{AssetStorageBackend: "supabase", SupabaseStorageURL: server.URL,
		SupabaseStorageBucket: "studio-test-assets", SupabaseStorageToken: testStorageToken(nil),
		SupabaseStoragePublicURL: "https://media.example.invalid"}
	s, err := NewSupabaseStorage(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s.client.Transport = server.Client().Transport
	return s, cfg
}

func TestSupabaseCRUDAndSignedURL(t *testing.T) {
	key := "personal/owner/中文 #?%.mp4"
	payload := []byte("test-video")
	s, _ := testSupabase(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/storage/v1/") || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("unexpected endpoint or credentials")
		}
		switch {
		case strings.Contains(r.URL.Path, "/object/sign/"):
			json.NewEncoder(w).Encode(map[string]string{"signedURL": strings.TrimPrefix(r.URL.EscapedPath(), "/storage/v1") + "?token=media-token"})
		case strings.Contains(r.URL.Path, "/bucket/"):
			io.WriteString(w, `{"id":"studio-test-assets","public":false}`)
		case r.Method == "DELETE":
			var body struct {
				Prefixes []string `json:"prefixes"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if len(body.Prefixes) != 1 || body.Prefixes[0] != key {
				t.Error("delete targets differ")
			}
		case r.Method == "POST":
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, payload) || r.Header.Get("x-upsert") != "false" {
				t.Error("upload changed payload or overwrite policy")
			}
		default:
			if !strings.HasSuffix(r.URL.Path, key) {
				t.Error("object key was not preserved")
			}
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Length", "10")
			if r.Method == "GET" {
				w.Write(payload)
			}
		}
	})
	ctx := context.Background()
	obj, err := s.Put(ctx, key, bytes.NewReader(payload), PutMeta{ContentType: "video/mp4"})
	if err != nil || obj.Size != 10 || obj.ContentType != "video/mp4" {
		t.Fatalf("put/stat: %+v %v", obj, err)
	}
	stream, _, err := s.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(stream)
	stream.Close()
	if !bytes.Equal(body, payload) {
		t.Fatal("download differs")
	}
	url, err := s.URL(ctx, key)
	if err != nil || !strings.HasPrefix(url, "https://media.example.invalid/storage/v1/object/sign/") {
		t.Fatalf("signing: %s %v", url, err)
	}
	if err := s.Probe(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
}

func TestSupabaseCredentialRejectionAndRotation(t *testing.T) {
	s, cfg := testSupabase(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, key := range []string{".", "..", "a/../b", "a//b", "/a", "a\tb"} {
		if _, err := s.target(key); err == nil {
			t.Fatalf("accepted invalid key %q", key)
		}
	}
	for _, change := range []map[string]any{
		{"role": "service_role"}, {"storage_buckets": []string{"private"}}, {"sub": ""},
		{"exp": time.Now().Unix() - 1}, {"exp": time.Now().Unix() + 3600}, {"iat": time.Now().Unix() + 60},
	} {
		s.token = testStorageToken(change)
		if _, err := s.credentials(); err == nil {
			t.Fatalf("accepted invalid token claims: %v", change)
		}
	}
	s.token = cfg.SupabaseStorageToken
	s.apiKey = testStorageToken(map[string]any{"role": "service_role"})
	if _, err := s.credentials(); err == nil {
		t.Fatal("accepted privileged gateway key")
	}
	s.apiKey = testStorageToken(map[string]any{"role": "anon"})
	s.tokenFile = filepath.Join(t.TempDir(), "token")
	first := testStorageToken(map[string]any{"jti": "first"})
	second := testStorageToken(map[string]any{"jti": "second"})
	for _, token := range []string{first, second} {
		if err := os.WriteFile(s.tokenFile, []byte(token), 0600); err != nil {
			t.Fatal(err)
		}
		headers, err := s.credentials()
		if err != nil || headers.Get("Authorization") != "Bearer "+token {
			t.Fatalf("rotation failed: %v", err)
		}
	}
	for _, bucket := range []string{"private", "studio-sdvideo-test-results", "studio-a/../private"} {
		cfg.SupabaseStorageBucket = bucket
		if _, err := NewConfiguredStorage(cfg); err == nil {
			t.Fatalf("accepted bucket %s", bucket)
		}
	}
}

func TestSupabaseFailureAndSigningBoundaries(t *testing.T) {
	for _, status := range []int{400, 404, 409, 503, 307} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			s, _ := testSupabase(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", "https://do-not-follow.invalid/private")
				w.WriteHeader(status)
				io.WriteString(w, `{"statusCode":"409","message":"sensitive-provider-details"}`)
			})
			_, err := s.Put(context.Background(), "results/x", strings.NewReader("x"), PutMeta{})
			if err == nil || strings.Contains(err.Error(), "sensitive") || strings.Contains(err.Error(), "https://") {
				t.Fatalf("unsafe result: %v", err)
			}
			if status == 400 || status == 409 {
				if !errors.Is(err, os.ErrExist) {
					t.Fatal(err)
				}
			}
			if status == 404 && !errors.Is(err, os.ErrNotExist) {
				t.Fatal(err)
			}
		})
	}
	for _, signed := range []string{
		"https://external.invalid/object/sign/studio-test-assets/results/x?token=t",
		"/object/sign/studio-test-assets/results/other?token=t",
		"/object/sign/private/results/x?token=t", "/object/sign/studio-test-assets/results/x",
		"/object/sign/studio-test-assets/results/x?token=t&token=u",
	} {
		s, _ := testSupabase(t, func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]string{"signedURL": signed})
		})
		if _, err := s.URL(context.Background(), "results/x"); err == nil {
			t.Fatalf("accepted invalid signed URL %s", signed)
		}
	}
	for _, body := range []string{`{"id":"studio-test-assets","public":true}`, `{"id":"studio-test-assets"}`, `{"id":"private","public":false}`} {
		s, _ := testSupabase(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, body) })
		if err := s.Probe(context.Background()); err == nil {
			t.Fatalf("accepted wrong/private bucket response: %s", body)
		}
	}
}

func TestSupabaseHEAD400ResolvesActualMetadataStatus(t *testing.T) {
	for _, status := range []int{200, 403, 404, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			requests := 0
			s, _ := testSupabase(t, func(w http.ResponseWriter, r *http.Request) {
				requests++
				if r.Method == http.MethodHead {
					w.WriteHeader(400)
					return
				}
				if r.URL.Path != "/storage/v1/object/info/authenticated/studio-test-assets/results/object" {
					t.Error("fallback must only request object metadata")
				}
				if status == 200 {
					io.WriteString(w, `{"name":"results/object","bucket_id":"studio-test-assets","size":9,"content_type":"video/mp4"}`)
				} else {
					w.WriteHeader(400)
					json.NewEncoder(w).Encode(map[string]any{"statusCode": status})
				}
			})
			meta, err := s.Stat(context.Background(), "results/object")
			if requests != 2 {
				t.Fatal("expected HEAD followed by one metadata lookup")
			}
			if status == 200 && (err != nil || meta.Size != 9) {
				t.Fatalf("metadata: %+v %v", meta, err)
			}
			if status == 404 && !errors.Is(err, os.ErrNotExist) {
				t.Fatal("missing object must map to not-exist")
			}
			if (status == 403 || status == 503) && (err == nil || errors.Is(err, os.ErrNotExist)) {
				t.Fatal("permission/outage must not become not-exist")
			}
		})
	}
}
