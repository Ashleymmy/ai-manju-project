package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/joho/godotenv"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "count assets without rebuilding usage aggregates")
	workspace := flag.String("workspace", "", "optional workspace id")
	flag.Parse()
	_ = godotenv.Load()
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		log.Fatal("DATABASE_URL or DB_HOST is required")
	}
	db, err := database.OpenPostgres(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open postgres: %v", err)
	}
	workspaceIDs := []string{}
	if value := strings.TrimSpace(*workspace); value != "" {
		workspaceIDs = append(workspaceIDs, value)
	} else if err := db.Model(&model.Asset{}).Distinct().Where("workspace_id <> ''").Pluck("workspace_id", &workspaceIDs).Error; err != nil {
		log.Fatalf("list workspaces: %v", err)
	}
	assetRepo := repository.NewGormAssetRepository(db)
	usage := service.NewAssetUsageService(repository.NewGormAssetUsageRepository(db), assetRepo, repository.NewGormAssetReferenceRepository(db), repository.NewGormAssetLineageRepository(db))
	total := 0
	for _, workspaceID := range workspaceIDs {
		if *dryRun {
			assets, listErr := assetRepo.ListByWorkspace(workspaceID)
			if listErr != nil {
				log.Fatalf("list assets for %s: %v", workspaceID, listErr)
			}
			total += len(assets)
			continue
		}
		count, reconcileErr := usage.ReconcileWorkspace(workspaceID)
		if reconcileErr != nil {
			log.Fatalf("reconcile %s: %v", workspaceID, reconcileErr)
		}
		total += count
	}
	mode := "reconciled"
	if *dryRun {
		mode = "planned"
	}
	fmt.Printf("asset usage %s: workspaces=%d assets=%d\n", mode, len(workspaceIDs), total)
}
