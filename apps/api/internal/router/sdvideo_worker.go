package router

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
)

// 复用 API 仓库初始化，但不启动 HTTP handler、其他 dispatcher 或模型执行。
func RunSDVideoBridge(ctx context.Context, cfg config.Config) error {
	if cfg.StorageDriver != "postgres" {
		return errors.New("bridge worker requires PostgreSQL")
	}
	client := sdvideo.NewClient(cfg)
	if !client.Enabled() {
		return errors.New("bridge service credentials are not configured")
	}
	repos, _, _ := newRepositories(cfg)
	store, err := storage.NewConfiguredStorage(cfg)
	if err != nil {
		return err
	}
	assets := service.NewAssetService(repos.assetRepo, store)
	assets.SetReferenceRepository(repos.assetReferenceRepo)
	assets.SetLineageService(service.NewAssetLineageService(repos.assetLineageRepo, repos.assetRepo, repos.tagRepo))
	folders := service.NewAssetFolderService(repos.assetFolderRepo, repos.assetRepo)
	assets.SetFolderService(folders)
	jobs := service.NewJobService(repos.jobRepo, nil, "", cfg.JobMaxAttempts)
	worker := service.NewSDVideoBridge(jobs, repos.userRepo, client, assets, time.Duration(cfg.SDVideoBridgeIntervalSec)*time.Second, cfg.SDVideoBridgeBatchSize)
	address := os.Getenv("SD_VIDEO_BRIDGE_HEALTH_ADDR")
	if address == "" {
		address = "127.0.0.1:3103"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return errors.New("bridge health listener unavailable")
	}
	server := &http.Server{Handler: bridgeHealthHandler(worker), ReadHeaderTimeout: 3 * time.Second, WriteTimeout: 5 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()
	defer server.Close()
	worker.Start(ctx)
	select {
	case <-ctx.Done():
		return nil
	case <-serverErrors:
		return errors.New("bridge health server stopped")
	}
}
