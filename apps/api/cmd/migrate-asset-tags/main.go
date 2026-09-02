package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/tagmigration"
	"github.com/joho/godotenv"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "print the legacy asset tag backfill plan without writing")
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
	result, err := tagmigration.Run(db, *dryRun)
	if err != nil {
		log.Fatalf("migrate asset tags: %v", err)
	}
	mode := "applied"
	if *dryRun {
		mode = "planned"
	}
	fmt.Printf("asset tag migration %s: scanned=%d tagged_assets=%d workspaces=%d tags_to_create=%d bindings_to_create=%d origins_to_create=%d created_tags=%d created_bindings=%d created_origins=%d\n",
		mode, result.ScannedAssets, result.TaggedAssets, result.Workspaces, result.TagsToCreate, result.BindingsToCreate,
		result.OriginsToCreate, result.CreatedTags, result.CreatedBindings, result.CreatedOrigins)
}
