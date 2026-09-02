package repository

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestGormAnnouncementRepositoryListAnnouncementsReturnsCreatedRows(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}

	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatalf("OpenPostgres() error = %v", err)
	}

	repo := NewGormAnnouncementRepository(db)
	prefix := "ann_list_test_" + randomRepositoryHex(6)
	t.Cleanup(func() {
		_ = db.Where("id LIKE ?", prefix+"%").Delete(&model.SystemAnnouncement{}).Error
	})

	now := time.Now().UTC()
	want := 3
	for i := 0; i < want; i++ {
		_, err := repo.CreateAnnouncement(model.SystemAnnouncement{
			ID:          fmt.Sprintf("%s_%d", prefix, i),
			Title:       fmt.Sprintf("Announcement %d", i),
			Content:     "body",
			Kind:        model.SystemAnnouncementKindNotice,
			CreatedBy:   "tester",
			PublishedAt: now.Add(time.Duration(i) * time.Minute),
		})
		if err != nil {
			t.Fatalf("CreateAnnouncement(%d) error = %v", i, err)
		}
	}

	items, err := repo.ListAnnouncements(0)
	if err != nil {
		t.Fatalf("ListAnnouncements() error = %v", err)
	}

	seen := make([]model.SystemAnnouncement, 0, want)
	for _, item := range items {
		if len(item.ID) >= len(prefix) && item.ID[:len(prefix)] == prefix {
			seen = append(seen, item)
		}
	}
	if len(seen) != want {
		t.Fatalf("ListAnnouncements() returned %d test rows, want %d; total rows=%d", len(seen), want, len(items))
	}
	for i := 1; i < len(seen); i++ {
		if seen[i-1].PublishedAt.Before(seen[i].PublishedAt) {
			t.Fatalf("ListAnnouncements() is not sorted by published_at desc: %+v", seen)
		}
	}
}
