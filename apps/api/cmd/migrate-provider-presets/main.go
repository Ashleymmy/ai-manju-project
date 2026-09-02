package main

import (
	"flag"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/providerpresetmigration"
	"github.com/ai-manju/api/internal/repository"
	"github.com/joho/godotenv"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "print planned model provider preset migration changes without writing")
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
	repo := repository.NewGormModelProviderRepository(db)

	var result providerpresetmigration.Result
	if *dryRun {
		configs, err := repo.ListModelProviders()
		if err != nil {
			log.Fatalf("list model providers: %v", err)
		}
		result = providerpresetmigration.Plan(configs)
	} else {
		result, err = providerpresetmigration.Apply(repo)
		if err != nil {
			log.Fatalf("migrate model providers: %v", err)
		}
	}

	mode := "applied"
	if *dryRun {
		mode = "planned"
	}
	fmt.Printf("model provider preset migration %s: scanned=%d updated=%d\n", mode, result.Scanned, result.Updated)
	for _, update := range result.Updates {
		changes := append([]string{}, update.Changes...)
		sort.Strings(changes)
		fmt.Printf("- %s: %s\n", update.ID, strings.Join(changes, ", "))
	}
}
