package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
)

const (
	// ExportArchiveKeyPrefix distinguishes disk archives from legacy object-store ZIPs.
	ExportArchiveKeyPrefix = "local-exports/"
	// Incomplete files are never published. Allow interrupted workers a day before
	// removing their abandoned staging files; active writes refresh their mtime.
	exportStagingRetention = 24 * time.Hour
	exportStagingPattern   = ".asset-export-*.pending"
)

// ExportArchiveStorage keeps ZIPs on a persistent volume shared by API and the
// export worker. It never sends complete archives through media upload limits.
type ExportArchiveStorage struct{ *LocalFSStorage }

func NewExportArchiveStorage(cfg config.Config) *ExportArchiveStorage {
	directory := strings.TrimSpace(cfg.AssetExportStorageDir)
	if directory == "" {
		directory = filepath.Join(cfg.AssetStorageDir, "export-archives")
	}
	return &ExportArchiveStorage{NewLocalFSStorage(directory)}
}

func (s *ExportArchiveStorage) CreateTemporary() (*os.File, error) {
	if err := s.ensureSharedAssetDir(s.baseDir); err != nil {
		return nil, err
	}
	return os.CreateTemp(s.baseDir, exportStagingPattern)
}

// Commit publishes a closed ZIP by a same-filesystem rename, with no second
// full copy and no partially downloadable object. Keys are unique per attempt.
func (s *ExportArchiveStorage) Commit(ctx context.Context, fileName, key string) (StorageObject, error) {
	if err := ctx.Err(); err != nil {
		return StorageObject{}, err
	}
	if !strings.HasPrefix(key, ExportArchiveKeyPrefix) {
		return StorageObject{}, errors.New("invalid export archive key")
	}
	target, err := s.safePath(key)
	if err != nil {
		return StorageObject{}, err
	}
	if err := s.ensureSharedAssetDir(filepath.Dir(target)); err != nil {
		return StorageObject{}, err
	}
	if err := os.Chmod(fileName, sharedAssetFileMode); err != nil {
		return StorageObject{}, err
	}
	if err := os.Rename(fileName, target); err != nil {
		return StorageObject{}, err
	}
	object, err := s.Stat(ctx, key)
	if err != nil {
		// A canceled publication must not leak an unreferenced completed ZIP.
		_ = os.Remove(target)
	}
	return object, err
}

func (s *ExportArchiveStorage) Probe(context.Context) error {
	file, err := s.CreateTemporary()
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write([]byte("health"))
	return errors.Join(writeErr, file.Close())
}

func (s *ExportArchiveStorage) CleanupStaging(now time.Time) error {
	files, err := filepath.Glob(filepath.Join(s.baseDir, exportStagingPattern))
	if err != nil {
		return err
	}
	for _, name := range files {
		info, err := os.Stat(name)
		if err != nil || !info.Mode().IsRegular() || now.Sub(info.ModTime()) <= exportStagingRetention {
			continue
		}
		if err := os.Remove(name); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
