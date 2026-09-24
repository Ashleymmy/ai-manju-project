package repository

import (
	"errors"
	"os"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestGormProjectSummariesDoNotReadSnapshots(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for PostgreSQL integration")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.Project{}, &model.CanvasSnapshot{}); err != nil {
		t.Fatal(err)
	}
	repo := NewGormProjectRepository(db)
	id := "summary-no-snapshot-test"
	if _, err := repo.Create(model.Project{ID: id, Title: "旧画布", OwnerID: id, WorkspaceID: "default:" + id}); err != nil {
		t.Fatal(err)
	}
	defer repo.Delete(id)
	if _, err := repo.UpsertSnapshot(model.CanvasSnapshot{ProjectID: id, Data: model.JSONB(`{"nodes":[{"id":"keep"}]}`)}); err != nil {
		t.Fatal(err)
	}
	reads := 0
	if err := db.Callback().Query().Before("gorm:query").Register("test:unavailable_snapshots", func(tx *gorm.DB) {
		if tx.Statement.Table == "project_snapshots" {
			reads++
			tx.AddError(errors.New("snapshot storage unavailable"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Query().Remove("test:unavailable_snapshots")
	items, err := repo.ListSummariesByWorkspace("default:" + id)
	if err != nil || len(items) != 1 || reads != 0 || len(items[0].Data) != 0 {
		t.Fatalf("summary depends on snapshots: items=%v reads=%d error=%v", items, reads, err)
	}
	if _, err := repo.ListByWorkspace("default:" + id); err == nil || reads != 1 {
		t.Fatalf("full list should still read snapshots: reads=%d error=%v", reads, err)
	}
}
