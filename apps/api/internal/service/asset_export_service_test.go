package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

type assetExportTestHarness struct {
	assets     *AssetService
	folders    *AssetFolderService
	exports    *AssetExportService
	exportRepo *repository.MemoryAssetExportRepository
	store      storage.Storage
	userID     string
	scope      string
}

func newAssetExportTestHarness(t *testing.T) assetExportTestHarness {
	t.Helper()
	assetRepo := repository.NewMemoryAssetRepository()
	folderRepo := repository.NewMemoryAssetFolderRepository()
	store := storage.NewLocalFSStorage(t.TempDir())
	folders := NewAssetFolderService(folderRepo, assetRepo)
	assets := NewAssetService(assetRepo, store)
	assets.SetFolderService(folders)
	exportRepo := repository.NewMemoryAssetExportRepository()
	return assetExportTestHarness{
		assets: assets, folders: folders, exports: NewAssetExportService(exportRepo, assets, folders, store),
		exportRepo: exportRepo, store: store, userID: "asset_export_user", scope: WorkspaceScopePersonal,
	}
}

func (h assetExportTestHarness) upload(t *testing.T, id string, name string, body string, folderID string, category string) model.Asset {
	t.Helper()
	asset, err := h.assets.Upload(context.Background(), AssetUploadInput{
		ID: id, UserID: h.userID, Scope: h.scope, Type: "image", Name: name, Extension: ".png",
		ContentType: "image/png", SizeLimit: 1024 * 1024, Reader: strings.NewReader(body),
		Registration: AssetRegistrationContext{
			FolderID: folderID, Category: category, SourceType: model.AssetSourceCanvas,
			SourceProjectID: "canvas_test", SourceBatchID: "batch_test", SourceItemID: "item_" + id,
			SourceJobID: "job_" + id, SourceMetadata: map[string]any{"node_id": "node_" + id},
		},
		Tags: []string{"hero", "approved"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return asset
}

func TestAssetExportSelectedWritesMediaAndManifests(t *testing.T) {
	h := newAssetExportTestHarness(t)
	parent, err := h.folders.Create(h.userID, h.scope, AssetFolderCreateInput{Name: "角色:主角"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.folders.Create(h.userID, h.scope, AssetFolderCreateInput{Name: "第一*组", ParentID: parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	first := h.upload(t, "asset_export_one", "同名?.png", "first-media", child.ID, model.AssetCategoryCharacter)
	second := h.upload(t, "asset_export_two", "同名?.png", "second-media", child.ID, model.AssetCategoryCharacter)

	fragment := model.JSONB(`{"version":1,"nodes":[{"id":"node_a"}],"edges":[],"omitted_external_edges":[]}`)
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{
		SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{first.ID, second.ID}, CanvasFragment: fragment,
	})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Total != 2 || batch.Kind != model.AssetExportKindCanvasFragment {
		t.Fatalf("created batch = %+v", batch)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != model.AssetExportStatusSucceeded || finished.Succeeded != 2 || finished.Failed != 0 {
		t.Fatalf("finished batch = %+v", finished)
	}
	if finished.ExpiresAt == nil || time.Until(*finished.ExpiresAt) < AssetExportRetention-time.Minute {
		t.Fatalf("expires_at = %v", finished.ExpiresAt)
	}

	entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
	for _, required := range []string{AssetExportManifestJSONName, AssetExportManifestCSVName, AssetExportCanvasFragmentName} {
		if _, ok := entries[required]; !ok {
			t.Fatalf("missing %s; entries=%v", required, mapKeys(entries))
		}
	}
	mediaEntries := make([]string, 0)
	for name, body := range entries {
		if string(body) == "first-media" || string(body) == "second-media" {
			mediaEntries = append(mediaEntries, name)
		}
	}
	if len(mediaEntries) != 2 || mediaEntries[0] == mediaEntries[1] {
		t.Fatalf("media entries = %v", mediaEntries)
	}
	for _, name := range mediaEntries {
		if !strings.HasPrefix(name, "角色_主角/第一_组/") {
			t.Fatalf("unsanitized or wrong logical path %q", name)
		}
	}
	var manifest struct {
		Assets []assetExportManifestRow `json:"assets"`
	}
	if err := json.Unmarshal(entries[AssetExportManifestJSONName], &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Assets) != 2 || len(manifest.Assets[0].Tags) != 2 || manifest.Assets[0].SourceProject != "canvas_test" {
		t.Fatalf("manifest = %+v", manifest.Assets)
	}
}

func TestAssetExportFilterFreezesSelectionAndAllowsPartialFailure(t *testing.T) {
	h := newAssetExportTestHarness(t)
	first := h.upload(t, "asset_filter_one", "one.png", "one", "", model.AssetCategoryCharacter)
	second := h.upload(t, "asset_filter_two", "two.png", "two", "", model.AssetCategoryCharacter)
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{
		SelectionMode: AssetExportSelectionFilter,
		Filter:        AssetExportFilter{Category: model.AssetCategoryCharacter},
	})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Total != 2 {
		t.Fatalf("frozen total = %d", batch.Total)
	}
	_ = h.upload(t, "asset_filter_late", "late.png", "late", "", model.AssetCategoryCharacter)
	workspaceID := WorkspaceIDForScope(h.scope, h.userID)
	if err := h.store.Delete(context.Background(), AssetStorageKey(workspaceID, second.ID, ".png")); err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Total != 2 || finished.Status != model.AssetExportStatusPartialFailed || finished.Succeeded != 1 || finished.Failed != 1 {
		t.Fatalf("finished batch = %+v", finished)
	}
	entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
	for _, body := range entries {
		if string(body) == "late" {
			t.Fatal("asset created after batch freeze leaked into archive")
		}
	}
	foundFirst := false
	for _, body := range entries {
		foundFirst = foundFirst || string(body) == "one"
	}
	if !foundFirst || first.ID == "" {
		t.Fatal("expected successful frozen asset media")
	}
}

func TestAssetExportCancelAndExpiry(t *testing.T) {
	h := newAssetExportTestHarness(t)
	asset := h.upload(t, "asset_cancel", "cancel.png", "cancel", "", model.AssetCategoryOther)
	canceled, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.exports.Cancel(canceled.ID, h.userID, h.scope); err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	canceledState, err := h.exports.Get(canceled.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	if canceledState.Status != model.AssetExportStatusCanceled || canceledState.Canceled != 1 || canceledState.FinishedAt == nil {
		t.Fatalf("canceled batch = %+v", canceledState)
	}

	active, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, AssetIDs: []string{asset.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, _, err := h.exportRepo.Get(active.ID, WorkspaceIDForScope(h.scope, h.userID))
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if err := h.exportRepo.Finalize(finished.ID, finished.Status, finished.StorageKey, finished.FileName, finished.Size, finished.Error, &past); err != nil {
		t.Fatal(err)
	}
	if _, err := h.exports.OpenContent(context.Background(), active.ID, h.userID, h.scope); !errors.Is(err, ErrAssetExportExpired) {
		t.Fatalf("expired content error = %v", err)
	}
	expired, err := h.exports.Get(active.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Status != model.AssetExportStatusExpired || expired.StorageKey != "" {
		t.Fatalf("expired batch = %+v", expired)
	}
}

func TestAssetExportAllowsFragmentWithoutMedia(t *testing.T) {
	h := newAssetExportTestHarness(t)
	fragment := model.JSONB(`{"version":1,"nodes":[{"id":"text_only","type":"text"}],"connections":[],"omitted_external_connections":[]}`)
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionSelected, CanvasFragment: fragment})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Total != 0 || batch.Kind != model.AssetExportKindCanvasFragment {
		t.Fatalf("fragment batch = %+v", batch)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != model.AssetExportStatusSucceeded {
		t.Fatalf("fragment status = %s", finished.Status)
	}
	entries := readAssetExportZip(t, h.exports, batch.ID, h.userID, h.scope)
	if _, ok := entries[AssetExportCanvasFragmentName]; !ok {
		t.Fatalf("fragment missing: %v", mapKeys(entries))
	}
}

func readAssetExportZip(t *testing.T, service *AssetExportService, id string, userID string, scope string) map[string][]byte {
	t.Helper()
	content, err := service.OpenContent(context.Background(), id, userID, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer content.Reader.Close()
	payload, err := io.ReadAll(content.Reader)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatal(err)
	}
	entries := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(stream)
		closeErr := stream.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		entries[filepath.ToSlash(file.Name)] = body
	}
	return entries
}

func mapKeys(values map[string][]byte) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}

type countingAssetRepository struct {
	repository.AssetRepository
	mu              sync.Mutex
	bulkLookupCalls int
	singleCalls     int
	libraryCalls    int
}

func (r *countingAssetRepository) ListByWorkspaceIDs(ids []string, workspaceID string) ([]model.Asset, error) {
	r.mu.Lock()
	r.bulkLookupCalls++
	r.mu.Unlock()
	return r.AssetRepository.ListByWorkspaceIDs(ids, workspaceID)
}

func (r *countingAssetRepository) GetByWorkspace(id string, workspaceID string) (model.Asset, error) {
	r.mu.Lock()
	r.singleCalls++
	r.mu.Unlock()
	return r.AssetRepository.GetByWorkspace(id, workspaceID)
}

func (r *countingAssetRepository) ListLibrary(filter repository.AssetLibraryFilter) ([]model.Asset, int64, error) {
	r.mu.Lock()
	r.libraryCalls++
	r.mu.Unlock()
	return r.AssetRepository.ListLibrary(filter)
}

func (r *countingAssetRepository) resetLookupCounts() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bulkLookupCalls, r.singleCalls, r.libraryCalls = 0, 0, 0
}

func (r *countingAssetRepository) lookupCounts() (int, int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bulkLookupCalls, r.singleCalls, r.libraryCalls
}

type trackingAssetExportRepository struct {
	repository.AssetExportRepository
	mu       sync.Mutex
	progress []int
}

func (r *trackingAssetExportRepository) UpdateProgress(id string, succeeded int, failed int) error {
	r.mu.Lock()
	r.progress = append(r.progress, succeeded+failed)
	r.mu.Unlock()
	return r.AssetExportRepository.UpdateProgress(id, succeeded, failed)
}

func (r *trackingAssetExportRepository) progressSnapshots() []int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]int(nil), r.progress...)
}

func TestAssetExportLargeBatchUsesBulkLookupsAndPublishesProgress(t *testing.T) {
	baseAssetRepo := repository.NewMemoryAssetRepository()
	assetRepo := &countingAssetRepository{AssetRepository: baseAssetRepo}
	folderRepo := repository.NewMemoryAssetFolderRepository()
	store := storage.NewLocalFSStorage(t.TempDir())
	folders := NewAssetFolderService(folderRepo, assetRepo)
	assets := NewAssetService(assetRepo, store)
	assets.SetFolderService(folders)
	baseExportRepo := repository.NewMemoryAssetExportRepository()
	exportRepo := &trackingAssetExportRepository{AssetExportRepository: baseExportRepo}
	exports := NewAssetExportService(exportRepo, assets, folders, store)

	const assetCount = 500
	for index := 0; index < assetCount; index++ {
		id := fmt.Sprintf("asset_large_%04d", index)
		asset, err := assets.Upload(context.Background(), AssetUploadInput{
			ID: id, UserID: "asset_large_user", Scope: WorkspaceScopePersonal, Type: "image", Name: id + ".png",
			Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: strings.NewReader("media-" + id),
		})
		if err != nil {
			t.Fatal(err)
		}
		if asset.ID == "" {
			t.Fatal("uploaded asset id is empty")
		}
	}
	assetRepo.resetLookupCounts()
	batch, err := exports.Create("asset_large_user", WorkspaceScopePersonal, AssetExportCreateInput{
		SelectionMode: AssetExportSelectionFilter, Filter: AssetExportFilter{Type: "image"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := exports.Get(batch.ID, "asset_large_user", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != model.AssetExportStatusSucceeded || finished.Succeeded != assetCount || finished.Failed != 0 {
		t.Fatalf("large batch = %+v", finished)
	}
	bulkCalls, singleCalls, libraryCalls := assetRepo.lookupCounts()
	if bulkCalls != 1 || singleCalls != 0 || libraryCalls != 1 {
		t.Fatalf("asset lookup calls: bulk=%d single=%d library=%d", bulkCalls, singleCalls, libraryCalls)
	}
	progress := exportRepo.progressSnapshots()
	if len(progress) != assetCount/AssetExportProgressChunkSize || progress[0] != AssetExportProgressChunkSize || progress[len(progress)-1] != assetCount {
		t.Fatalf("progress snapshots = %v", progress)
	}
}

func TestAssetExportZipMethodSkipsRecompressingMedia(t *testing.T) {
	if method := assetExportZipMethod(model.Asset{ContentType: "image/png"}); method != zip.Store {
		t.Fatalf("png method = %d", method)
	}
	if method := assetExportZipMethod(model.Asset{ContentType: "video/mp4"}); method != zip.Store {
		t.Fatalf("mp4 method = %d", method)
	}
	if method := assetExportZipMethod(model.Asset{ContentType: "image/svg+xml"}); method != zip.Deflate {
		t.Fatalf("svg method = %d", method)
	}
}
