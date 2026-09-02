package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"github.com/ai-manju/api/internal/assetmigration"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/joho/godotenv"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "print the asset folder and lineage backfill plan without writing")
	flag.Parse()
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		log.Fatal("DATABASE_URL or DB_HOST is required")
	}
	db, err := database.OpenPostgres(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open postgres: %v", err)
	}
	result, err := assetmigration.RunWithArchiveTimezone(db, *dryRun, cfg.AssetArchiveTimezone)
	if err != nil {
		log.Fatalf("migrate asset library: %v", err)
	}
	mode := "applied"
	if *dryRun {
		mode = "planned"
	}
	fmt.Printf("asset library migration %s: scanned=%d workspaces=%d folders_to_create=%d workspace_backfills=%d comic=%d job=%d legacy=%d already_managed=%d updated=%d canvas_to_refile=%d canvas_refiled=%d\n",
		mode, result.ScannedAssets, result.Workspaces, result.FoldersToCreate, result.WorkspaceBackfills,
		result.ComicAssetsToBackfill, result.JobAssetsToBackfill, result.LegacyAssetsToBackfill, result.AlreadyManaged, result.UpdatedAssets,
		result.CanvasAssetsToRefile, result.CanvasAssetsRefiled)
}
