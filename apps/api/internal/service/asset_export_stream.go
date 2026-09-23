package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func (s *AssetExportService) createArchiveTemporary() (*os.File, error) {
	if s.archives != nil {
		return s.archives.CreateTemporary()
	}
	return os.CreateTemp("", "ai-manju-asset-export-*.zip")
}

// Stage only one source file at a time. An interrupted source must never leave a
// truncated ZIP entry; retries complete before archive.CreateHeader is called.
func (s *AssetExportService) stageExportAsset(ctx context.Context, batch model.AssetExportBatch, asset model.Asset, buffer []byte) (*os.File, int64, error) {
	var last error
	for attempt := 0; attempt < AssetExportReadAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, 0, err
		}
		if attempt > 0 {
			timer := time.NewTimer(AssetExportRetryDelay * time.Duration(attempt))
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, 0, ctx.Err()
			case <-timer.C:
			}
		}
		content, err := s.assets.openContentForAsset(ctx, asset, batch.UserID, WorkspaceScopeFromID(batch.WorkspaceID))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, repository.ErrAssetNotFound) {
				return nil, 0, err
			}
			last = err
			continue
		}
		file, err := s.createArchiveTemporary()
		if err != nil {
			content.Reader.Close()
			return nil, 0, exportDiskError{err}
		}
		stopClose := context.AfterFunc(ctx, func() { _ = content.Reader.Close() })
		written, copyErr := io.CopyBuffer(file, exportContextReader{ctx, exportProgressReader{content.Reader, s.recordDispatchProgress}}, buffer)
		stopClose()
		_ = content.Reader.Close()
		if copyErr == nil && content.Object.Size > 0 && written != content.Object.Size {
			copyErr = fmt.Errorf("asset content incomplete: expected %d bytes, received %d", content.Object.Size, written)
		}
		if copyErr == nil {
			_, copyErr = file.Seek(0, io.SeekStart)
		}
		if copyErr == nil {
			return file, written, nil
		}
		file.Close()
		os.Remove(file.Name())
		var pathErr *os.PathError
		if errors.As(copyErr, &pathErr) && pathErr.Op == "write" {
			return nil, 0, exportDiskError{copyErr}
		}
		last = copyErr
	}
	return nil, 0, last
}

type exportDiskError struct{ error }

func (e exportDiskError) Unwrap() error { return e.error }

type exportContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r exportContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func (s *AssetExportService) watchExportCancellation(ctx context.Context, batch model.AssetExportBatch, cancel context.CancelFunc) {
	ticker := time.NewTicker(AssetExportProgressInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			current, err := s.exports.GetBatch(batch.ID, batch.WorkspaceID)
			if err == nil && current.Status != model.AssetExportStatusRunning {
				cancel()
				return
			}
		}
	}
}
