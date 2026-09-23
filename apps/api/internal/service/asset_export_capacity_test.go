package service

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/storage"
)

// Generate media bodies on demand so this regression exercises ZIP disk usage,
// not hundreds of megabytes of fixture allocations or source-file staging.
type exportCapacityStorage struct {
	storage.Storage
	mediaSize int64
}

type exportZeroReader struct{}

func (exportZeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func (s exportCapacityStorage) Get(ctx context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	if strings.HasPrefix(key, "exports/") {
		return s.Storage.Get(ctx, key)
	}
	object, err := s.Storage.Stat(ctx, key)
	if err != nil {
		return nil, object, err
	}
	object.Size = s.mediaSize
	return io.NopCloser(io.LimitReader(exportZeroReader{}, s.mediaSize)), object, nil
}

func TestAssetExportFolderExceedsLegacyTemporaryCapacity(t *testing.T) {
	if testing.Short() {
		t.Skip("writes and validates a 280 MiB ZIP")
	}
	// 35 ordinary 8 MiB PNGs already exceed the old cloud /tmp limit of 256 MiB.
	const count = 35
	const mediaSize = 8 * 1024 * 1024
	h := newAssetExportTestHarness(t)
	folder, err := h.folders.Create(h.userID, h.scope, AssetFolderCreateInput{Name: "容量回归"})
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < count; index++ {
		h.upload(t, fmt.Sprintf("capacity_%02d", index), fmt.Sprintf("素材_%02d.png", index), "fixture", folder.ID, model.AssetCategoryOther)
	}
	h.assets.storage = exportCapacityStorage{Storage: h.store, mediaSize: mediaSize}
	batch, err := h.exports.Create(h.userID, h.scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionFolder, FolderID: folder.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished, err := h.exports.Get(batch.ID, h.userID, h.scope)
	if err != nil || finished.Status != model.AssetExportStatusSucceeded || finished.Succeeded != count || finished.Failed != 0 || finished.Size < count*mediaSize {
		t.Fatalf("export: status=%s succeeded=%d failed=%d bytes=%d error=%v", finished.Status, finished.Succeeded, finished.Failed, finished.Size, err)
	}
	reader, object, err := h.store.Get(context.Background(), finished.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	archive, err := zip.NewReader(reader.(io.ReaderAt), object.Size)
	if err != nil {
		t.Fatal(err)
	}
	mediaCount := 0
	for _, entry := range archive.File {
		content, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		// Reading every entry to EOF checks ZIP CRCs as well as file counts/sizes.
		size, copyErr := io.Copy(io.Discard, content)
		closeErr := content.Close()
		if copyErr != nil || closeErr != nil {
			t.Fatalf("invalid ZIP entry: %v / %v", copyErr, closeErr)
		}
		if strings.HasSuffix(entry.Name, ".png") {
			mediaCount++
			if size != mediaSize {
				t.Fatalf("truncated media: %d", size)
			}
		}
	}
	if mediaCount != count {
		t.Fatalf("media entries = %d, want %d", mediaCount, count)
	}
	t.Logf("exported and CRC-verified %d media files, ZIP bytes=%d", mediaCount, finished.Size)
}
