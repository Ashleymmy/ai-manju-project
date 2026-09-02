package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

const (
	AssetExportSelectionSelected = "selected"
	AssetExportSelectionFilter   = "filter"
	AssetExportSelectionFolder   = "folder"

	AssetExportRetention         = 7 * 24 * time.Hour
	AssetExportDispatchInterval  = time.Second
	AssetExportRunningLease      = 10 * time.Minute
	AssetExportHeartbeatInterval = 30 * time.Second
	AssetExportMaxAssets         = 5000
	// AssetExportProgressChunkSize balances visible progress with database write load.
	AssetExportProgressChunkSize = 100
	// AssetExportCopyBufferSize limits allocations while streaming large media into ZIP files.
	AssetExportCopyBufferSize     = 256 * 1024
	AssetExportMaxFragmentBytes   = 5 * 1024 * 1024
	AssetExportManifestJSONName   = "manifest.json"
	AssetExportManifestCSVName    = "manifest.csv"
	AssetExportCanvasFragmentName = "canvas-fragment.json"
)

var (
	ErrAssetExportSelection = errors.New("asset export selection is invalid")
	ErrAssetExportNotReady  = errors.New("asset export is not ready")
	ErrAssetExportExpired   = errors.New("asset export has expired")
)

type AssetExportFilter struct {
	FolderID              string     `json:"folder_id,omitempty"`
	IncludeDescendants    bool       `json:"include_descendants,omitempty"`
	TagIDs                []string   `json:"tag_ids,omitempty"`
	TagMatch              string     `json:"tag_match,omitempty"`
	IncludeTagDescendants bool       `json:"include_tag_descendants,omitempty"`
	SmartView             string     `json:"smart_view,omitempty"`
	Type                  string     `json:"type,omitempty"`
	Category              string     `json:"category,omitempty"`
	SourceType            string     `json:"source_type,omitempty"`
	SourceProjectID       string     `json:"source_project_id,omitempty"`
	Keyword               string     `json:"keyword,omitempty"`
	CreatedFrom           *time.Time `json:"created_from,omitempty"`
	CreatedTo             *time.Time `json:"created_to,omitempty"`
	Sort                  string     `json:"sort,omitempty"`
}

type AssetExportCreateInput struct {
	SelectionMode  string
	AssetIDs       []string
	FolderID       string
	Filter         AssetExportFilter
	CanvasFragment model.JSONB
}

type AssetExportContent struct {
	Batch  model.AssetExportBatch
	Object storage.StorageObject
	Reader io.ReadCloser
}

type AssetExportService struct {
	exports repository.AssetExportRepository
	assets  *AssetService
	folders *AssetFolderService
	storage storage.Storage
	usage   interface {
		RecordExport(workspaceID string, userID string, exportID string, assetIDs []string) error
	}
}

func NewAssetExportService(exports repository.AssetExportRepository, assets *AssetService, folders *AssetFolderService, store storage.Storage) *AssetExportService {
	return &AssetExportService{exports: exports, assets: assets, folders: folders, storage: store}
}

func (s *AssetExportService) SetAssetUsageRecorder(recorder interface {
	RecordExport(workspaceID string, userID string, exportID string, assetIDs []string) error
}) {
	s.usage = recorder
}

func (s *AssetExportService) Create(userID string, scope string, input AssetExportCreateInput) (model.AssetExportBatch, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	selectionMode := strings.TrimSpace(strings.ToLower(input.SelectionMode))
	fragment := normalizeExportFragment(input.CanvasFragment)
	if len(input.CanvasFragment) > 0 && len(fragment) == 0 {
		return model.AssetExportBatch{}, ErrAssetExportSelection
	}
	var assets []model.Asset
	var err error
	switch selectionMode {
	case AssetExportSelectionSelected:
		if len(uniqueAssetStrings(input.AssetIDs)) == 0 && len(fragment) > 0 {
			assets = []model.Asset{}
		} else if len(uniqueAssetStrings(input.AssetIDs)) == 0 || len(uniqueAssetStrings(input.AssetIDs)) > AssetExportMaxAssets {
			err = ErrAssetExportSelection
		} else {
			assets, _, err = s.assets.activeAssetsForMutation(input.AssetIDs, workspaceID)
		}
	case AssetExportSelectionFolder:
		input.Filter.FolderID = strings.TrimSpace(input.FolderID)
		input.Filter.IncludeDescendants = true
		if input.Filter.FolderID == "" {
			err = ErrAssetExportSelection
		} else {
			assets, err = s.assetsForFilter(userID, scope, input.Filter)
		}
	case AssetExportSelectionFilter:
		assets, err = s.assetsForFilter(userID, scope, input.Filter)
	default:
		err = ErrAssetExportSelection
	}
	if err != nil {
		return model.AssetExportBatch{}, err
	}
	if (len(assets) == 0 && len(fragment) == 0) || len(assets) > AssetExportMaxAssets {
		return model.AssetExportBatch{}, ErrAssetExportSelection
	}
	kind := model.AssetExportKindAssets
	if len(fragment) > 0 {
		kind = model.AssetExportKindCanvasFragment
	}
	ids := assetIDs(assets)
	selection, _ := json.Marshal(map[string]any{"mode": selectionMode, "asset_ids": ids, "folder_id": input.FolderID, "filter": input.Filter})
	batchID := "asset_export_" + randomHex(12)
	batch := model.AssetExportBatch{
		ID: batchID, UserID: userID, WorkspaceID: workspaceID, Scope: scope, Kind: kind,
		Status: model.AssetExportStatusQueued, SelectionMode: selectionMode, Selection: model.JSONB(selection),
		CanvasFragment: fragment, Total: len(ids), Error: model.JSONB("{}"),
	}
	items := make([]model.AssetExportItem, 0, len(ids))
	for index, assetID := range ids {
		items = append(items, model.AssetExportItem{
			ID: "asset_export_item_" + randomHex(12), ExportID: batchID, AssetID: assetID,
			Position: index + 1, Status: model.AssetExportItemStatusPending, Error: model.JSONB("{}"),
		})
	}
	created, err := s.exports.Create(batch, items)
	if err == nil {
		created.Scope = scope
	}
	return created, err
}

func (s *AssetExportService) Get(id string, userID string, scope string) (model.AssetExportBatch, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	batch, items, err := s.exports.Get(strings.TrimSpace(id), workspaceID)
	if err != nil {
		return model.AssetExportBatch{}, err
	}
	if batch.ExpiresAt != nil && !batch.ExpiresAt.After(time.Now().UTC()) && batch.Status != model.AssetExportStatusExpired {
		_ = s.expireBatch(context.Background(), batch)
		batch.Status, batch.StorageKey = model.AssetExportStatusExpired, ""
	}
	batch.Scope, batch.Items = WorkspaceScopeFromID(batch.WorkspaceID), items
	return batch, nil
}

func (s *AssetExportService) List(userID string, scope string) ([]model.AssetExportBatch, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	items, err := s.exports.List(workspaceID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Scope = WorkspaceScopeFromID(items[index].WorkspaceID)
	}
	return items, nil
}

func (s *AssetExportService) Cancel(id string, userID string, scope string) (model.AssetExportBatch, error) {
	batch, err := s.exports.Cancel(strings.TrimSpace(id), WorkspaceIDForScope(scope, userID))
	if err == nil {
		batch.Scope = WorkspaceScopeFromID(batch.WorkspaceID)
	}
	return batch, err
}

func (s *AssetExportService) OpenContent(ctx context.Context, id string, userID string, scope string) (AssetExportContent, error) {
	batch, err := s.exports.GetBatch(strings.TrimSpace(id), WorkspaceIDForScope(scope, userID))
	if err != nil {
		return AssetExportContent{}, err
	}
	if batch.ExpiresAt != nil && !batch.ExpiresAt.After(time.Now().UTC()) {
		_ = s.expireBatch(context.WithoutCancel(ctx), batch)
		return AssetExportContent{}, ErrAssetExportExpired
	}
	if batch.Status == model.AssetExportStatusExpired {
		return AssetExportContent{}, ErrAssetExportExpired
	}
	if (batch.Status != model.AssetExportStatusSucceeded && batch.Status != model.AssetExportStatusPartialFailed) || batch.StorageKey == "" {
		return AssetExportContent{}, ErrAssetExportNotReady
	}
	reader, object, err := s.storage.Get(ctx, batch.StorageKey)
	if err != nil {
		return AssetExportContent{}, err
	}
	return AssetExportContent{Batch: batch, Object: object, Reader: reader}, nil
}

func (s *AssetExportService) StartDispatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = AssetExportDispatchInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			_ = s.DispatchOnce(context.WithoutCancel(ctx))
			_, _ = s.CleanupExpired(context.WithoutCancel(ctx))
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *AssetExportService) DispatchOnce(ctx context.Context) error {
	batch, items, claimed, err := s.exports.ClaimNext(time.Now().UTC().Add(-AssetExportRunningLease))
	if err != nil || !claimed {
		return err
	}
	return s.buildArchive(ctx, batch, items)
}

func (s *AssetExportService) CleanupExpired(ctx context.Context) (int, error) {
	batches, err := s.exports.ListExpired(time.Now().UTC(), 100)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, batch := range batches {
		if err := s.expireBatch(ctx, batch); err != nil {
			continue
		}
		count++
	}
	return count, nil
}

func (s *AssetExportService) assetsForFilter(userID string, scope string, filter AssetExportFilter) ([]model.Asset, error) {
	assets, total, err := s.assets.listLibraryForExport(userID, scope, AssetLibraryInput{
		FolderID: filter.FolderID, IncludeDescendants: filter.IncludeDescendants, Type: filter.Type,
		TagIDs: filter.TagIDs, TagMatch: filter.TagMatch, IncludeTagDescendants: filter.IncludeTagDescendants, SmartView: filter.SmartView,
		Category: filter.Category, SourceType: filter.SourceType, SourceProjectID: filter.SourceProjectID,
		Keyword: filter.Keyword, CreatedFrom: filter.CreatedFrom, CreatedTo: filter.CreatedTo,
		Sort: defaultStringValue(filter.Sort, "created_at_asc"),
	}, AssetExportMaxAssets)
	if err != nil {
		return nil, err
	}
	if total > AssetExportMaxAssets || len(assets) > AssetExportMaxAssets {
		return nil, ErrAssetExportSelection
	}
	return assets, nil
}

func (s *AssetExportService) buildArchive(ctx context.Context, batch model.AssetExportBatch, items []model.AssetExportItem) error {
	stopHeartbeat := s.startHeartbeat(ctx, batch.ID)
	defer stopHeartbeat()

	temporary, err := os.CreateTemp("", "ai-manju-asset-export-*.zip")
	if err != nil {
		return s.failBatch(batch.ID, err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	archive := zip.NewWriter(temporary)
	closed := false
	closeArchive := func() error {
		if closed {
			return nil
		}
		closed = true
		if err := archive.Close(); err != nil {
			_ = temporary.Close()
			return err
		}
		return temporary.Close()
	}

	if len(batch.CanvasFragment) > 0 {
		if err := writeZipBytes(archive, AssetExportCanvasFragmentName, batch.CanvasFragment); err != nil {
			_ = closeArchive()
			return s.failBatch(batch.ID, err)
		}
	}
	folders := make([]model.AssetFolder, 0)
	if s.folders != nil {
		folderViews, _ := s.folders.List(batch.UserID, WorkspaceScopeFromID(batch.WorkspaceID))
		folders = make([]model.AssetFolder, 0, len(folderViews))
		for _, view := range folderViews {
			folders = append(folders, view.AssetFolder)
		}
	}
	folderPaths := buildExportFolderPaths(folders)
	assets, err := s.assets.repo.ListByWorkspaceIDs(exportItemAssetIDs(items), batch.WorkspaceID)
	if err != nil {
		_ = closeArchive()
		return s.failBatch(batch.ID, err)
	}
	assetsByID := make(map[string]model.Asset, len(assets))
	for _, asset := range assets {
		assetsByID[asset.ID] = asset
	}

	manifest := make([]assetExportManifestRow, 0, len(items))
	usedPaths := make(map[string]bool)
	copyBuffer := make([]byte, AssetExportCopyBufferSize)
	updates := make([]repository.AssetExportItemUpdate, 0, AssetExportProgressChunkSize)
	succeeded, failed := 0, 0
	succeededAssetIDs := make([]string, 0, len(items))
	flushProgress := func() (bool, error) {
		if len(updates) > 0 {
			if err := s.exports.UpdateItems(updates); err != nil {
				return false, err
			}
			updates = updates[:0]
		}
		if err := s.exports.UpdateProgress(batch.ID, succeeded, failed); err != nil {
			return false, err
		}
		current, err := s.exports.GetBatch(batch.ID, batch.WorkspaceID)
		if err != nil {
			return false, err
		}
		return current.Status == model.AssetExportStatusCanceled, nil
	}

	for index, item := range items {
		if index%AssetExportProgressChunkSize == 0 {
			current, err := s.exports.GetBatch(batch.ID, batch.WorkspaceID)
			if err != nil {
				_ = closeArchive()
				return err
			}
			if current.Status == model.AssetExportStatusCanceled {
				_ = closeArchive()
				return nil
			}
		}

		asset, found := assetsByID[item.AssetID]
		row := manifestRowForAsset(asset, folderPaths)
		row.AssetID = item.AssetID
		if !found {
			assetErr := repository.ErrAssetNotFound
			failed++
			row.Status, row.Error = model.AssetExportItemStatusFailed, safeExportError(assetErr)
			manifest = append(manifest, row)
			updates = append(updates, repository.AssetExportItemUpdate{ID: item.ID, Status: model.AssetExportItemStatusFailed, Error: exportErrorJSON(assetErr)})
		} else {
			archivePath := uniqueExportArchivePath(asset, row.FolderPath, usedPaths)
			content, contentErr := s.assets.openContentForAsset(ctx, asset, batch.UserID, WorkspaceScopeFromID(batch.WorkspaceID))
			if contentErr == nil {
				contentErr = copyAssetToZip(archive, archivePath, asset, content.Reader, copyBuffer)
				_ = content.Reader.Close()
			}
			if contentErr != nil {
				failed++
				row.Status, row.Error = model.AssetExportItemStatusFailed, safeExportError(contentErr)
				updates = append(updates, repository.AssetExportItemUpdate{ID: item.ID, Status: model.AssetExportItemStatusFailed, Error: exportErrorJSON(contentErr)})
			} else {
				succeeded++
				succeededAssetIDs = append(succeededAssetIDs, item.AssetID)
				row.Status, row.ArchivePath = model.AssetExportItemStatusSucceeded, archivePath
				updates = append(updates, repository.AssetExportItemUpdate{ID: item.ID, Status: model.AssetExportItemStatusSucceeded, ArchivePath: archivePath, Error: model.JSONB("{}")})
			}
			manifest = append(manifest, row)
		}

		if len(updates) >= AssetExportProgressChunkSize {
			canceled, err := flushProgress()
			if err != nil {
				_ = closeArchive()
				return s.failBatch(batch.ID, err)
			}
			if canceled {
				_ = closeArchive()
				return nil
			}
		}
	}
	if len(updates) > 0 {
		canceled, err := flushProgress()
		if err != nil {
			_ = closeArchive()
			return s.failBatch(batch.ID, err)
		}
		if canceled {
			_ = closeArchive()
			return nil
		}
	}
	if err := writeAssetExportManifests(archive, manifest); err != nil {
		_ = closeArchive()
		return s.failBatch(batch.ID, err)
	}
	if err := closeArchive(); err != nil {
		return s.failBatch(batch.ID, err)
	}
	current, err := s.exports.GetBatch(batch.ID, batch.WorkspaceID)
	if err != nil {
		return err
	}
	if current.Status == model.AssetExportStatusCanceled {
		return nil
	}
	if succeeded == 0 && len(batch.CanvasFragment) == 0 {
		return s.failBatch(batch.ID, errors.New("all asset files failed to export"))
	}
	file, err := os.Open(temporaryPath)
	if err != nil {
		return s.failBatch(batch.ID, err)
	}
	defer file.Close()
	storageKey := assetExportStorageKey(batch.WorkspaceID, batch.ID)
	_ = s.storage.Delete(ctx, storageKey)
	object, err := s.storage.Put(ctx, storageKey, file, storage.PutMeta{ContentType: "application/zip"})
	if err != nil {
		return s.failBatch(batch.ID, err)
	}
	current, err = s.exports.GetBatch(batch.ID, batch.WorkspaceID)
	if err != nil {
		_ = s.storage.Delete(context.WithoutCancel(ctx), storageKey)
		return err
	}
	if current.Status == model.AssetExportStatusCanceled {
		_ = s.storage.Delete(context.WithoutCancel(ctx), storageKey)
		return nil
	}
	status := model.AssetExportStatusSucceeded
	if failed > 0 {
		status = model.AssetExportStatusPartialFailed
	}
	expiresAt := time.Now().UTC().Add(AssetExportRetention)
	fileName := fmt.Sprintf("ai-manju-assets-%s-%s.zip", time.Now().UTC().Format("20060102"), shortExportID(batch.ID))
	if err := s.exports.Finalize(batch.ID, status, storageKey, fileName, object.Size, model.JSONB("{}"), &expiresAt); err != nil {
		_ = s.storage.Delete(context.WithoutCancel(ctx), storageKey)
		return err
	}
	if s.usage != nil {
		if usageErr := s.usage.RecordExport(batch.WorkspaceID, batch.UserID, batch.ID, succeededAssetIDs); usageErr != nil {
			log.Printf("asset_export_id=%s event=asset_usage_record_failed reason=%q", batch.ID, usageErr.Error())
		}
	}
	current, err = s.exports.GetBatch(batch.ID, batch.WorkspaceID)
	if err == nil && current.Status == model.AssetExportStatusCanceled {
		_ = s.storage.Delete(context.WithoutCancel(ctx), storageKey)
	}
	return err
}

func exportItemAssetIDs(items []model.AssetExportItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.AssetID)
	}
	return ids
}

func (s *AssetExportService) startHeartbeat(ctx context.Context, batchID string) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(AssetExportHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				_ = s.exports.Touch(batchID)
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(done) }) }
}

func (s *AssetExportService) failBatch(id string, err error) error {
	_ = s.exports.Finalize(id, model.AssetExportStatusFailed, "", "", 0, exportErrorJSON(err), nil)
	return err
}

func (s *AssetExportService) expireBatch(ctx context.Context, batch model.AssetExportBatch) error {
	if batch.StorageKey != "" {
		if err := s.storage.Delete(ctx, batch.StorageKey); err != nil {
			return err
		}
	}
	return s.exports.MarkExpired(batch.ID)
}

type assetExportManifestRow struct {
	AssetID        string         `json:"asset_id"`
	Name           string         `json:"name"`
	Type           string         `json:"type"`
	ContentType    string         `json:"content_type"`
	Size           int64          `json:"size"`
	ArchivePath    string         `json:"archive_path,omitempty"`
	FolderPath     string         `json:"folder_path"`
	Category       string         `json:"category"`
	Tags           []string       `json:"tags"`
	SourceType     string         `json:"source_type"`
	SourceProject  string         `json:"source_project_id"`
	SourceBatch    string         `json:"source_batch_id"`
	SourceItem     string         `json:"source_item_id"`
	SourceJob      string         `json:"source_job_id"`
	SourceMetadata map[string]any `json:"source_metadata"`
	CreatedAt      time.Time      `json:"created_at"`
	Status         string         `json:"status"`
	Error          string         `json:"error,omitempty"`
}

func manifestRowForAsset(asset model.Asset, folderPaths map[string]string) assetExportManifestRow {
	tags := []string{}
	_ = json.Unmarshal(asset.Tags, &tags)
	metadata := map[string]any{}
	_ = json.Unmarshal(asset.SourceMetadata, &metadata)
	return assetExportManifestRow{
		AssetID: asset.ID, Name: asset.Name, Type: asset.Type, ContentType: asset.ContentType, Size: asset.Size,
		FolderPath: exportFolderPath(asset, folderPaths), Category: asset.Category, Tags: tags,
		SourceType: asset.SourceType, SourceProject: asset.SourceProjectID, SourceBatch: asset.SourceBatchID,
		SourceItem: asset.SourceItemID, SourceJob: asset.SourceJobID, SourceMetadata: metadata, CreatedAt: asset.CreatedAt,
	}
}

func buildExportFolderPaths(folders []model.AssetFolder) map[string]string {
	byID := make(map[string]model.AssetFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	resolved := make(map[string]string, len(folders))
	visiting := make(map[string]bool, len(folders))
	var resolve func(string) string
	resolve = func(id string) string {
		if value, ok := resolved[id]; ok {
			return value
		}
		folder, ok := byID[id]
		if !ok || visiting[id] {
			return ""
		}
		visiting[id] = true
		parentPath := resolve(folder.ParentID)
		value := parentPath
		if folder.SystemKey != model.AssetFolderSystemKeyRoot {
			value = path.Join(parentPath, safeArchiveSegment(folder.Name))
		}
		delete(visiting, id)
		resolved[id] = value
		return value
	}
	for id := range byID {
		resolve(id)
	}
	return resolved
}

func exportFolderPath(asset model.Asset, folderPaths map[string]string) string {
	if folderPath := folderPaths[asset.FolderID]; folderPath != "" {
		return folderPath
	}
	return path.Join("未归档", safeArchiveSegment(AssetCategoryLabel(asset.Category)))
}

func uniqueExportArchivePath(asset model.Asset, folderPath string, used map[string]bool) string {
	name := safeArchiveSegment(asset.Name)
	if name == "" || name == "unnamed" {
		name = asset.ID
	}
	if filepath.Ext(name) == "" {
		name += exportAssetExtension(asset)
	}
	candidate := path.Join(folderPath, name)
	key := strings.ToLower(candidate)
	if !used[key] {
		used[key] = true
		return candidate
	}
	extension := path.Ext(name)
	base := strings.TrimSuffix(name, extension)
	candidate = path.Join(folderPath, base+"-"+shortExportID(asset.ID)+extension)
	for index := 2; used[strings.ToLower(candidate)]; index++ {
		candidate = path.Join(folderPath, fmt.Sprintf("%s-%s-%d%s", base, shortExportID(asset.ID), index, extension))
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}

func safeArchiveSegment(value string) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, runeValue := range value {
		if unicode.IsControl(runeValue) || strings.ContainsRune(`<>:"/\|?*`, runeValue) {
			builder.WriteRune('_')
		} else {
			builder.WriteRune(runeValue)
		}
	}
	result := strings.Trim(builder.String(), " .")
	if result == "" || result == "." || result == ".." {
		return "unnamed"
	}
	return result
}

func exportAssetExtension(asset model.Asset) string {
	if extension := strings.ToLower(filepath.Ext(asset.URL)); extension != "" {
		return extension
	}
	switch strings.ToLower(asset.ContentType) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	default:
		if asset.Type == "image" {
			return ".png"
		}
		return ".bin"
	}
}

func copyAssetToZip(archive *zip.Writer, archivePath string, asset model.Asset, reader io.Reader, buffer []byte) error {
	entry, err := archive.CreateHeader(&zip.FileHeader{Name: archivePath, Method: assetExportZipMethod(asset)})
	if err != nil {
		return err
	}
	_, err = io.CopyBuffer(entry, reader, buffer)
	return err
}

func assetExportZipMethod(asset model.Asset) uint16 {
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(asset.ContentType, ";")[0]))
	if strings.HasPrefix(contentType, "video/") || strings.HasPrefix(contentType, "audio/") {
		return zip.Store
	}
	switch contentType {
	case "image/avif", "image/gif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp":
		return zip.Store
	}
	switch strings.ToLower(filepath.Ext(asset.URL)) {
	case ".avif", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".m4a", ".mov", ".mp3", ".mp4", ".ogg", ".png", ".wav", ".webm", ".webp":
		return zip.Store
	}
	return zip.Deflate
}

func writeZipBytes(archive *zip.Writer, name string, value []byte) error {
	entry, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = entry.Write(value)
	return err
}

func writeAssetExportManifests(archive *zip.Writer, rows []assetExportManifestRow) error {
	payload, err := json.MarshalIndent(map[string]any{"version": 1, "generated_at": time.Now().UTC(), "assets": rows}, "", "  ")
	if err != nil {
		return err
	}
	if err := writeZipBytes(archive, AssetExportManifestJSONName, payload); err != nil {
		return err
	}
	buffer := &bytes.Buffer{}
	writer := csv.NewWriter(buffer)
	_ = writer.Write([]string{"asset_id", "name", "type", "content_type", "size", "archive_path", "folder_path", "category", "tags", "source_type", "source_project_id", "source_batch_id", "source_item_id", "source_job_id", "created_at", "status", "error"})
	for _, row := range rows {
		_ = writer.Write([]string{row.AssetID, row.Name, row.Type, row.ContentType, fmt.Sprint(row.Size), row.ArchivePath, row.FolderPath, row.Category, strings.Join(row.Tags, "|"), row.SourceType, row.SourceProject, row.SourceBatch, row.SourceItem, row.SourceJob, row.CreatedAt.Format(time.RFC3339), row.Status, row.Error})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	return writeZipBytes(archive, AssetExportManifestCSVName, buffer.Bytes())
}

func normalizeExportFragment(raw model.JSONB) model.JSONB {
	if len(raw) == 0 {
		return nil
	}
	if len(raw) > AssetExportMaxFragmentBytes || !json.Valid(raw) {
		return nil
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	payload, _ := json.Marshal(value)
	return model.JSONB(payload)
}

func exportErrorJSON(err error) model.JSONB {
	payload, _ := json.Marshal(map[string]any{"message": safeExportError(err)})
	return model.JSONB(payload)
}

func safeExportError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func assetExportStorageKey(workspaceID string, exportID string) string {
	return filepath.ToSlash(filepath.Join("exports", assetWorkspacePath(workspaceID), exportID+".zip"))
}

func shortExportID(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "asset_export_"))
	if len(value) > 8 {
		return value[:8]
	}
	return value
}
