package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
)

func TestExportArchivePublishesOnSharedDiskAndKeepsPendingPrivate(t *testing.T) {
	root := t.TempDir()
	cfg := config.Config{AssetExportStorageDir: root}
	worker, api := NewExportArchiveStorage(cfg), NewExportArchiveStorage(cfg)
	file, err := worker.CreateTemporary()
	if err != nil {
		t.Fatal(err)
	}
	name := file.Name()
	key := ExportArchiveKeyPrefix + "personal/user/export-attempt.zip"
	if _, _, err := api.Get(context.Background(), key); !os.IsNotExist(err) {
		t.Fatalf("unpublished archive: %v", err)
	}
	file.WriteString("archive bytes")
	file.Close()
	object, err := worker.Commit(context.Background(), name, key)
	if err != nil || object.Size != 13 {
		t.Fatalf("commit: %+v %v", object, err)
	}
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("commit left a second archive copy")
	}
	reader, _, err := api.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(reader)
	reader.Close()
	if err != nil || string(body) != "archive bytes" {
		t.Fatalf("download: %q %v", body, err)
	}
	if err := api.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
}

func TestExportArchiveCleanupOnlyRemovesOldPendingFiles(t *testing.T) {
	root := t.TempDir()
	store := NewExportArchiveStorage(config.Config{AssetExportStorageDir: root})
	old, _ := store.CreateTemporary()
	old.Close()
	fresh, _ := store.CreateTemporary()
	fresh.Close()
	keep := filepath.Join(root, "other-file")
	os.WriteFile(keep, []byte("keep"), 0o600)
	before := time.Now().Add(-2 * exportStagingRetention)
	os.Chtimes(old.Name(), before, before)
	if err := store.CleanupStaging(time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old.Name()); !os.IsNotExist(err) {
		t.Fatal("old staging file remains")
	}
	for _, file := range []string{fresh.Name(), keep} {
		if _, err := os.Stat(file); err != nil {
			t.Fatalf("removed non-stale file: %v", err)
		}
	}
}
