package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()
	if cfg.StorageDriver != "postgres" {
		log.Fatalf("asset export worker requires STORAGE_DRIVER=postgres, got %q", cfg.StorageDriver)
	}
	db, err := database.OpenPostgresWithPool(cfg.DatabaseURL, database.PoolConfig{
		MaxOpenConns: cfg.DBMaxOpenConns, MaxIdleConns: cfg.DBMaxIdleConns,
		MaxLifetime: time.Duration(cfg.DBConnMaxLifetimeSeconds) * time.Second,
	})
	if err != nil {
		log.Fatalf("open PostgreSQL: %v", err)
	}
	assetRepo := repository.NewGormAssetRepository(db)
	folderService := service.NewAssetFolderService(repository.NewGormAssetFolderRepository(db), assetRepo)
	if err := folderService.SetArchiveTimezone(cfg.AssetArchiveTimezone); err != nil {
		log.Fatalf("invalid ASSET_ARCHIVE_TIMEZONE: %v", err)
	}
	assetService := service.NewAssetService(assetRepo, storage.NewLocalFSStorage(cfg.AssetStorageDir))
	assetService.SetFolderService(folderService)
	exportService := service.NewAssetExportService(
		repository.NewGormAssetExportRepository(db), assetService, folderService, storage.NewLocalFSStorage(cfg.AssetStorageDir),
	)
	exportService.SetAssetUsageRecorder(service.NewAssetUsageService(
		repository.NewGormAssetUsageRepository(db), assetRepo, repository.NewGormAssetReferenceRepository(db), repository.NewGormAssetLineageRepository(db),
	))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	log.Printf("asset export worker started")
	exportService.StartDispatcher(ctx, service.AssetExportDispatchInterval)
	<-ctx.Done()
	log.Printf("asset export worker stopped")
}
