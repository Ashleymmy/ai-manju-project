package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/storage"
)

func TestExportHealthRejectsEachFailedDependencyWithoutSecrets(t *testing.T) {
	for _, failed := range []string{"", "database", "storage", "dispatcher", "temporary"} {
		t.Run(failed, func(t *testing.T) {
			probe := func(name string) error {
				if name == failed {
					return errors.New("private-dsn-or-token")
				}
				return nil
			}
			checks := exportHealthChecks{
				database:   func(context.Context) error { return probe("database") },
				storage:    func(context.Context) error { return probe("storage") },
				dispatcher: func(time.Time) bool { return failed != "dispatcher" },
				temporary:  func() error { return probe("temporary") },
			}
			r := httptest.NewRecorder()
			exportHealthHandler(checks).ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
			code := 200
			if failed != "" {
				code = 503
			}
			if r.Code != code || strings.Contains(r.Body.String(), "private-dsn-or-token") {
				t.Fatalf("unexpected response: %d %s", r.Code, r.Body.String())
			}
			if r.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("health must not be cached")
			}
		})
	}
}

func TestExportHealthTemporaryAndLocalStorage(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	t.Setenv("TMP", t.TempDir())
	if err := probeExportTemporary(); err != nil {
		t.Fatal(err)
	}
	if err := probeExportStorage(context.Background(), storage.NewLocalFSStorage(t.TempDir())); err != nil {
		t.Fatal(err)
	}
}
