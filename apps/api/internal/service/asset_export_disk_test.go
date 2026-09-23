package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Simulate readable remote media and a store that refuses ALL archive uploads.
// This verifies that fixing exports does not depend on increasing a NAS limit.
type exportSourceOnlyStore struct {
	storage.Storage
	mediaSize int64
	puts      int
}

func (s *exportSourceOnlyStore) Stat(_ context.Context, key string) (storage.StorageObject, error) {
	return storage.StorageObject{Key: key, Size: s.mediaSize, ContentType: "image/png"}, nil
}
func (s *exportSourceOnlyStore) Get(ctx context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	object, err := s.Stat(ctx, key)
	return io.NopCloser(io.LimitReader(exportZeroReader{}, s.mediaSize)), object, err
}
func (s *exportSourceOnlyStore) Put(context.Context, string, io.Reader, storage.PutMeta) (storage.StorageObject, error) {
	s.puts++
	return storage.StorageObject{}, errors.New("Storage request failed (HTTP 413)")
}

func TestAssetExportUnboundedSelectionMemory(t *testing.T) {
	verifyLargeExportSelection(t, repository.NewMemoryAssetRepository(), repository.NewMemoryAssetFolderRepository(), repository.NewMemoryAssetExportRepository())
}

func TestAssetExportUnboundedSelectionPostgres(t *testing.T) {
	dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASSET_TEST_DATABASE_URL is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.AssetFolder{}, &model.AssetExportBatch{}, &model.AssetExportItem{}); err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	defer tx.Rollback()
	verifyLargeExportSelection(t, repository.NewGormAssetRepository(tx), repository.NewGormAssetFolderRepository(tx), repository.NewGormAssetExportRepository(tx))
}

func verifyLargeExportSelection(t *testing.T, assets repository.AssetRepository, folders repository.AssetFolderRepository, exports repository.AssetExportRepository) {
	t.Helper()
	const count = 10001
	user, scope := "selection_"+randomHex(6), WorkspaceScopePersonal
	workspace := WorkspaceIDForScope(scope, user)
	folderService := NewAssetFolderService(folders, assets)
	folder, err := folderService.Create(user, scope, AssetFolderCreateInput{Name: "大目录"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := folderService.Create(user, scope, AssetFolderCreateInput{Name: "子目录", ParentID: folder.ID})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, count)
	for i := range ids {
		ids[i] = fmt.Sprintf("%s_%05d", user, i)
		folderID := folder.ID
		if i%2 == 0 {
			folderID = child.ID
		}
		_, err := assets.Create(model.Asset{ID: ids[i], UserID: user, WorkspaceID: workspace, FolderID: folderID, Name: ids[i], Type: "image", URL: "/file.png", Tags: model.JSONB("[]"), SourceMetadata: model.JSONB("{}")})
		if err != nil {
			t.Fatal(err)
		}
	}
	service := NewAssetService(assets, storage.NewLocalFSStorage(t.TempDir()))
	service.SetFolderService(folderService)
	exporter := NewAssetExportService(exports, service, folderService, service.storage)
	for _, input := range []AssetExportCreateInput{
		{SelectionMode: AssetExportSelectionFolder, FolderID: folder.ID},
		{SelectionMode: AssetExportSelectionFilter, Filter: AssetExportFilter{Type: "image"}},
		{SelectionMode: AssetExportSelectionSelected, AssetIDs: ids},
	} {
		batch, err := exporter.Create(user, scope, input)
		if err != nil || batch.Total != count {
			t.Fatalf("%s total=%d err=%v", input.SelectionMode, batch.Total, err)
		}
		_, items, err := exports.Get(batch.ID, workspace)
		seen := map[string]bool{}
		for _, item := range items {
			seen[item.AssetID] = true
		}
		if err != nil || len(seen) != count || len(items) != count {
			t.Fatalf("lost/duplicate selected assets: %d / %d %v", len(seen), len(items), err)
		}
	}
	page, err := service.ListLibrary(user, scope, AssetLibraryInput{Page: 1, PageSize: 30})
	if err != nil || len(page.Items) != 30 || page.Total != count {
		t.Fatalf("public pagination changed: %d / %d %v", len(page.Items), page.Total, err)
	}
}

func TestAssetExportLargeDiskArchive(t *testing.T) {
	if os.Getenv("ASSET_EXPORT_CAPACITY_TEST") != "1" {
		t.Skip("set ASSET_EXPORT_CAPACITY_TEST=1 for large disk / ZIP64 verification")
	}
	for _, scenario := range []struct {
		name      string
		count     int
		mediaSize int64
	}{
		{"10001_assets_625MiB", 10001, 64 * 1024},
		{"ZIP64_65536_assets", 65536, 1},
		{"ZIP64_file_over_4GiB", 1, (1 << 32) + 256},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			verifyLargeDiskArchive(t, scenario.count, scenario.mediaSize)
		})
	}
}

func verifyLargeDiskArchive(t *testing.T, count int, mediaSize int64) {
	t.Helper()
	h := newAssetExportTestHarness(t)
	folder, err := h.folders.Create(h.userID, h.scope, AssetFolderCreateInput{Name: "数万素材"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("large_%05d", i)
		_, err := h.assets.repo.Create(model.Asset{ID: id, UserID: h.userID, WorkspaceID: WorkspaceIDForScope(h.scope, h.userID), FolderID: folder.ID,
			Name: id + ".png", Type: "image", ContentType: "image/png", Size: mediaSize, URL: "/" + id + ".png", Tags: model.JSONB("[]"), SourceMetadata: model.JSONB("{}")})
		if err != nil {
			t.Fatal(err)
		}
	}
	source := &exportSourceOnlyStore{mediaSize: mediaSize}
	h.assets.storage, h.exports.storage = source, source
	directory := t.TempDir()
	archiveStore := storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: directory})
	h.exports.SetArchiveStorage(archiveStore)
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionFolder, FolderID: folder.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil || finished.Status != model.AssetExportStatusSucceeded || finished.Succeeded != count || finished.Failed != 0 {
		t.Fatalf("finished: %+v %v", finished, err)
	}
	if source.puts != 0 {
		t.Fatalf("still uploaded whole ZIP: %d", source.puts)
	}
	// A separate API service instance reads the persisted archive using the shared volume.
	api := NewAssetExportService(h.exportRepo, h.assets, h.folders, source)
	api.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: directory}))
	content, err := api.OpenContent(context.Background(), batch.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(content.Reader.(io.ReaderAt), content.Object.Size)
	if err != nil {
		t.Fatal(err)
	}
	mediaCount := 0
	for _, entry := range archive.File {
		reader, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		size, err := io.Copy(io.Discard, reader)
		reader.Close()
		if err != nil {
			t.Fatalf("CRC: %v", err)
		}
		if strings.HasSuffix(entry.Name, ".png") {
			mediaCount++
			if size != mediaSize {
				t.Fatalf("truncated media: %d", size)
			}
		}
	}
	content.Reader.Close()
	if mediaCount != count || content.Object.Size < int64(count)*mediaSize {
		t.Fatalf("incomplete archive: %d %d", mediaCount, content.Object.Size)
	}
	pending, _ := filepath.Glob(filepath.Join(directory, ".asset-export-*.pending"))
	if len(pending) != 0 {
		t.Fatalf("staging files remain: %v", pending)
	}
	if _, err := api.OpenContent(context.Background(), batch.ID, "another_user", h.scope); !errors.Is(err, repository.ErrAssetExportNotFound) {
		t.Fatalf("cross-account access: %v", err)
	}
	if err := h.exports.expireBatch(context.Background(), finished); err != nil {
		t.Fatal(err)
	}
	if _, err := archiveStore.Stat(context.Background(), finished.StorageKey); !os.IsNotExist(err) {
		t.Fatalf("expiry left archive: %v", err)
	}
	t.Logf("%d media CRC-verified, bytes=%d, media-store uploads=%d, separate API read/expiry/isolation passed", count, content.Object.Size, source.puts)
}

type flakyExportStore struct {
	storage.Storage
	attempts int
	broken   bool
}

func (s *flakyExportStore) Get(ctx context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	reader, object, err := s.Storage.Get(ctx, key)
	if err != nil {
		return reader, object, err
	}
	s.attempts++
	if s.broken || s.attempts == 1 {
		reader.Close()
		return io.NopCloser(io.MultiReader(strings.NewReader("truncated"), failingExportReader{})), object, nil
	}
	return reader, object, nil
}

type failingExportReader struct{}

func (failingExportReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestAssetExportRetriesSourceBeforeAddingZIPEntry(t *testing.T) {
	h := newAssetExportTestHarness(t)
	asset := h.upload(t, "retry_source", "retry.png", "complete-source-data", "", model.AssetCategoryOther)
	source := &flakyExportStore{Storage: h.store}
	h.assets.storage = source
	h.exports.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: t.TempDir()}))
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
	media := 0
	for name, data := range entries {
		if strings.HasSuffix(name, ".png") {
			media++
			if !bytes.Equal(data, []byte("complete-source-data")) {
				t.Fatalf("truncated archive entry: %q", data)
			}
		}
	}
	if media != 1 || source.attempts != 2 {
		t.Fatalf("media=%d attempts=%d", media, source.attempts)
	}
}

type blockingExportReader struct {
	closed chan struct{}
	once   sync.Once
}

func (r *blockingExportReader) Read([]byte) (int, error) { <-r.closed; return 0, context.Canceled }
func (r *blockingExportReader) Close() error             { r.once.Do(func() { close(r.closed) }); return nil }

type blockingExportStore struct {
	storage.Storage
	started chan struct{}
	reader  *blockingExportReader
}

func (s *blockingExportStore) Get(ctx context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	reader, object, err := s.Storage.Get(ctx, key)
	if reader != nil {
		reader.Close()
	}
	close(s.started)
	return s.reader, object, err
}

func TestAssetExportNeverIncludesFailedSourceFragments(t *testing.T) {
	h := newAssetExportTestHarness(t)
	broken := h.upload(t, "broken", "broken.png", "original-complete-file", "", model.AssetCategoryOther)
	good := h.upload(t, "good", "good.png", "original-complete-file", "", model.AssetCategoryOther)
	flaky := &flakyExportStore{Storage: h.store, broken: true}
	h.assets.storage = &selectivelyBrokenExportStore{Storage: h.store, broken: flaky, key: AssetStorageKey(WorkspaceIDForScope(h.scope, h.userID), broken.ID, ".png")}
	h.exports.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: t.TempDir()}))
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{good.ID, broken.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, _ := h.exports.Get(batch.ID, h.userID, h.scope)
	if state.Status != model.AssetExportStatusPartialFailed || state.Succeeded != 1 || state.Failed != 1 {
		t.Fatalf("state=%+v", state)
	}
	entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
	for name, content := range entries {
		if strings.HasSuffix(name, "broken.png") || strings.Contains(string(content), "truncated") {
			t.Fatalf("failed source leaked into ZIP: %s", name)
		}
	}
}

type selectivelyBrokenExportStore struct {
	storage.Storage
	broken *flakyExportStore
	key    string
}

func (s *selectivelyBrokenExportStore) Get(ctx context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	if key == s.key {
		return s.broken.Get(ctx, key)
	}
	return s.Storage.Get(ctx, key)
}

func TestAssetExportCancellationInterruptsBlockedRead(t *testing.T) {
	h := newAssetExportTestHarness(t)
	asset := h.upload(t, "cancel_source", "cancel.png", "source-data", "", model.AssetCategoryOther)
	source := &blockingExportStore{Storage: h.store, started: make(chan struct{}), reader: &blockingExportReader{closed: make(chan struct{})}}
	h.assets.storage = source
	directory := t.TempDir()
	h.exports.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: directory}))
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- h.exports.DispatchOnce(context.Background()) }()
	select {
	case <-source.started:
	case <-time.After(time.Second * 5):
		t.Fatal("read not started")
	}
	if _, err := h.exports.Cancel(batch.ID, h.userID, h.scope); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(AssetExportProgressInterval * 3):
		t.Fatal("canceled export is stuck")
	}
	final, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil || final.Status != model.AssetExportStatusCanceled || final.StorageKey != "" {
		t.Fatalf("cancellation lost: %+v %v", final, err)
	}
	files, _ := os.ReadDir(directory)
	if len(files) != 0 {
		t.Fatalf("canceled export left files: %v", files)
	}
}

// Simulate losing the database acknowledgement after a successful commit.
type ambiguousExportFinalize struct {
	repository.AssetExportRepository
	unreadable bool
	finalized  bool
}

func (r *ambiguousExportFinalize) Finalize(id, status, key, name string, size int64, payload model.JSONB, expires *time.Time) error {
	if err := r.AssetExportRepository.Finalize(id, status, key, name, size, payload, expires); err != nil {
		return err
	}
	r.finalized = true
	return errors.New("connection lost after commit")
}

func (r *ambiguousExportFinalize) GetBatch(id, workspace string) (model.AssetExportBatch, error) {
	if r.finalized && r.unreadable {
		return model.AssetExportBatch{}, errors.New("database unavailable")
	}
	return r.AssetExportRepository.GetBatch(id, workspace)
}

func TestAssetExportKeepsPublishedArchiveOnAmbiguousCommit(t *testing.T) {
	for _, unreadable := range []bool{false, true} {
		t.Run(fmt.Sprintf("database_unavailable_%t", unreadable), func(t *testing.T) {
			h := newAssetExportTestHarness(t)
			asset := h.upload(t, "commit", "commit.png", "complete-source-data", "", model.AssetCategoryOther)
			h.exports.SetArchiveStorage(storage.NewExportArchiveStorage(config.Config{AssetExportStorageDir: t.TempDir()}))
			h.exports.exports = &ambiguousExportFinalize{AssetExportRepository: h.exportRepo, unreadable: unreadable}
			batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
			if err != nil {
				t.Fatal(err)
			}
			if err := h.exports.DispatchOnce(context.Background()); err == nil {
				t.Fatal("expected ambiguous commit error")
			}
			// Once connectivity recovers, the committed archive must still download.
			h.exports.exports = h.exportRepo
			entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
			if len(entries) == 0 {
				t.Fatal("committed archive lost")
			}
		})
	}
}
