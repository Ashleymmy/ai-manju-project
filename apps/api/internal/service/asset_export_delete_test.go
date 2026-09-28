package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

type exportDeleteFailureStorage struct{ storage.Storage }

func (s exportDeleteFailureStorage) Delete(context.Context, string) error {
	return errors.New("archive storage unavailable")
}

func TestAssetExportDeleteCleansArchiveAndPreservesSource(t *testing.T) {
	for _, disk := range []bool{false, true} {
		t.Run(map[bool]string{false: "media-store", true: "archive-disk"}[disk], func(t *testing.T) {
			h := newAssetExportTestHarness(t)
			if disk {
				h.exports.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: t.TempDir()}))
			}
			asset := h.upload(t, "delete-source", "source.png", "source-pixels", "", "")
			batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			if err := h.exports.Delete(ctx, batch.ID, h.userID, h.scope); !errors.Is(err, repository.ErrAssetExportActive) {
				t.Fatalf("active delete: %v", err)
			}
			if err := h.exports.DispatchOnce(ctx); err != nil {
				t.Fatal(err)
			}
			finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
			if err != nil {
				t.Fatal(err)
			}
			store, err := h.exports.archiveReaderStore(finished.StorageKey)
			if err != nil {
				t.Fatal(err)
			}
			if err := h.exports.Delete(ctx, batch.ID, "other-user", h.scope); !errors.Is(err, repository.ErrAssetExportNotFound) {
				t.Fatalf("cross-account: %v", err)
			}
			if err := h.exports.Delete(ctx, batch.ID, h.userID, WorkspaceScopeTeam); !errors.Is(err, repository.ErrAssetExportNotFound) {
				t.Fatalf("cross-scope: %v", err)
			}
			if err := h.exports.Delete(ctx, batch.ID, h.userID, h.scope); err != nil {
				t.Fatal(err)
			}
			if _, err := h.exports.Get(batch.ID, h.userID, h.scope); !errors.Is(err, repository.ErrAssetExportNotFound) {
				t.Fatalf("record survived: %v", err)
			}
			if reader, _, err := store.Get(ctx, finished.StorageKey); err == nil {
				reader.Close()
				t.Fatal("archive survived")
			}
			content, err := h.assets.OpenContent(ctx, asset.ID, h.userID, h.scope)
			if err != nil {
				t.Fatalf("original asset removed: %v", err)
			}
			content.Reader.Close()
		})
	}
}

func TestAssetExportDeleteStorageFailurePreservesRecordForRetry(t *testing.T) {
	h := newAssetExportTestHarness(t)
	asset := h.upload(t, "retry-source", "source.png", "source-pixels", "", "")
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	h.exports.storage = exportDeleteFailureStorage{h.store}
	if err := h.exports.Delete(context.Background(), batch.ID, h.userID, h.scope); err == nil {
		t.Fatal("expected storage failure")
	}
	if _, err := h.exports.Get(batch.ID, h.userID, h.scope); err != nil {
		t.Fatalf("lost retryable record: %v", err)
	}
	h.exports.storage = h.store
	if err := h.exports.Delete(context.Background(), batch.ID, h.userID, h.scope); err != nil {
		t.Fatal(err)
	}
}

type deletedDuringFinalizeRepo struct {
	repository.AssetExportRepository
	workspace, archiveKey string
}

func (r *deletedDuringFinalizeRepo) Finalize(id, status, key, name string, size int64, payload model.JSONB, expires *time.Time) error {
	if status == model.AssetExportStatusSucceeded {
		r.archiveKey = key
		if _, err := r.Cancel(id, r.workspace); err != nil {
			return err
		}
		if err := r.Delete(id, r.workspace); err != nil {
			return err
		}
	}
	return r.AssetExportRepository.Finalize(id, status, key, name, size, payload, expires)
}

func TestAssetExportDeletionDuringFinalizeDoesNotLeakArchive(t *testing.T) {
	h := newAssetExportTestHarness(t)
	wrapped := &deletedDuringFinalizeRepo{AssetExportRepository: h.exportRepo, workspace: WorkspaceIDForScope(h.scope, h.userID)}
	h.exports.exports = wrapped
	asset := h.upload(t, "race-source", "source.png", "source-pixels", "", "")
	if _, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}}); err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); !errors.Is(err, repository.ErrAssetExportNotFound) {
		t.Fatalf("expected concurrent deletion, got %v", err)
	}
	if wrapped.archiveKey == "" {
		t.Fatal("test did not reach archive finalization")
	}
	if reader, _, err := h.store.Get(context.Background(), wrapped.archiveKey); err == nil {
		reader.Close()
		t.Fatal("orphan archive after deletion")
	}
	content, err := h.assets.OpenContent(context.Background(), asset.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	content.Reader.Close()
}
