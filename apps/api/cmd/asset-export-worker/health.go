package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/ai-manju/api/internal/storage"
)

const exportHealthTimeout = 5 * time.Second

type exportHealthChecks struct {
	database   func(context.Context) error
	storage    func(context.Context) error
	dispatcher func(time.Time) bool
	temporary  func() error
}

func exportHealthHandler(checks exportHealthChecks) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), exportHealthTimeout)
		defer cancel()
		state := map[string]bool{
			"database":   checks.database(ctx) == nil,
			"storage":    checks.storage(ctx) == nil,
			"dispatcher": checks.dispatcher(time.Now()),
			"temporary":  checks.temporary() == nil,
		}
		ready := true
		for _, ok := range state {
			ready = ready && ok
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if !ready {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		// 依赖异常只返回分类布尔值，不暴露连接串或签名 URL。
		_ = json.NewEncoder(w).Encode(map[string]any{"ready": ready, "checks": state})
	})
	return mux
}

func probeExportStorage(ctx context.Context, store storage.Storage) error {
	if probe, ok := store.(interface{ Probe(context.Context) error }); ok {
		return probe.Probe(ctx)
	}
	_, err := store.Stat(ctx, "health/probe")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func probeExportTemporary() error {
	file, err := os.CreateTemp("", "asset-export-health-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write([]byte("health"))
	closeErr := file.Close()
	return errors.Join(err, closeErr)
}

func startExportHealth(checks exportHealthChecks) (*http.Server, <-chan error, error) {
	address := os.Getenv("ASSET_EXPORT_HEALTH_ADDR")
	if address == "" {
		address = "127.0.0.1:3104"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, nil, errors.New("export worker health listener unavailable")
	}
	server := &http.Server{Handler: exportHealthHandler(checks), ReadHeaderTimeout: 3 * time.Second, WriteTimeout: 7 * time.Second}
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	return server, stopped, nil
}
