//go:build storageintegration

package storage

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
)

// 由 check-storage-api.py 在独立容器与新密钥环境显式执行，不跳过默认单元测试。
func TestSupabaseLive(t *testing.T) {
	endpoint, caFile, tokenFile := os.Getenv("STORAGE_INTEGRATION_URL"), os.Getenv("STORAGE_INTEGRATION_CA_FILE"), os.Getenv("STORAGE_INTEGRATION_TOKEN_FILE")
	if endpoint == "" || caFile == "" || tokenFile == "" {
		t.Fatal("live Storage integration requires the isolated runner")
	}
	s, err := NewSupabaseStorage(config.Config{SupabaseStorageURL: endpoint, SupabaseStorageCAFile: caFile,
		SupabaseStorageTokenFile: tokenFile, SupabaseStorageBucket: "studio-test-assets"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key, content := "integration/go-roundtrip.bin", []byte("go-live-storage-roundtrip")
	meta, err := s.Put(ctx, key, bytes.NewReader(content), PutMeta{ContentType: "application/octet-stream"})
	if err != nil || meta.Size != int64(len(content)) {
		t.Fatalf("upload/stat: %v size=%d", err, meta.Size)
	}
	if _, err = s.Put(ctx, key, bytes.NewReader(content), PutMeta{ContentType: "application/octet-stream"}); !errors.Is(err, os.ErrExist) {
		t.Fatalf("duplicate upload: %v", err)
	}
	reader, _, err := s.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(reader)
	reader.Close()
	if err != nil || !bytes.Equal(content, actual) {
		t.Fatal("download mismatch")
	}
	if err := s.Probe(ctx); err != nil {
		t.Fatal(err)
	}
	signed, err := s.URL(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := os.ReadFile(caFile)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(certificate) {
		t.Fatal("invalid test CA")
	}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}, Timeout: 10 * time.Second}
	request, _ := http.NewRequest(http.MethodGet, signed, nil)
	request.Header.Set("Range", "bytes=0-1")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal("signed download failed")
	}
	actual, err = io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 206 || !bytes.Equal(actual, content[:2]) {
		t.Fatal("signed Range download differs")
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Stat(ctx, key); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted object: %v", err)
	}
}
