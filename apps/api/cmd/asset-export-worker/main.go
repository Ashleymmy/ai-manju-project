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
	assetStore, err := storage.NewConfiguredStorage(cfg)
	if err != nil {
		log.Fatal(err)
	}
	assetService := service.NewAssetService(assetRepo, assetStore)
	assetService.SetFolderService(folderService)
	exportService := service.NewAssetExportService(
		repository.NewGormAssetExportRepository(db), assetService, folderService, assetStore,
	)
	exportService.SetAssetUsageRecorder(service.NewAssetUsageService(
		repository.NewGormAssetUsageRepository(db), assetRepo, repository.NewGormAssetReferenceRepository(db), repository.NewGormAssetLineageRepository(db),
	))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("export worker database handle unavailable")
	}
	defer sqlDB.Close()
	health, stopped, err := startExportHealth(exportHealthChecks{
		database:   sqlDB.PingContext,
		storage:    func(ctx context.Context) error { return probeExportStorage(ctx, assetStore) },
		dispatcher: exportService.DispatcherReady,
		temporary:  probeExportTemporary,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer health.Close()
	log.Printf("asset export worker started")
	exportService.StartDispatcher(ctx, service.AssetExportDispatchInterval)
	select {
	case <-ctx.Done():
	case <-stopped:
		log.Fatal("asset export worker health server stopped")
	}
	log.Printf("asset export worker stopped")
}
