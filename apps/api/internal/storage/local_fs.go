package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	// API and the non-root worker share this volume in Docker Compose.
	sharedAssetDirMode  os.FileMode = 0o777
	sharedAssetFileMode os.FileMode = 0o644
)

type LocalFSStorage struct {
	baseDir string
}

func NewLocalFSStorage(baseDir string) *LocalFSStorage {
	return &LocalFSStorage{baseDir: baseDir}
}

func (s *LocalFSStorage) Put(ctx context.Context, key string, r io.Reader, meta PutMeta) (StorageObject, error) {
	if err := ctx.Err(); err != nil {
		return StorageObject{}, err
	}
	target, err := s.safePath(key)
	if err != nil {
		return StorageObject{}, err
	}
	if err := s.ensureSharedAssetDir(filepath.Dir(target)); err != nil {
		return StorageObject{}, err
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, sharedAssetFileMode)
	if err != nil {
		return StorageObject{}, err
	}
	written, copyErr := file.ReadFrom(r)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(target)
		return StorageObject{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(target)
		return StorageObject{}, closeErr
	}
	object, err := s.Stat(ctx, key)
	if err != nil {
		return StorageObject{}, err
	}
	object.Size = written
	object.ContentType = meta.ContentType
	return object, nil
}

func (s *LocalFSStorage) ensureSharedAssetDir(path string) error {
	if err := os.MkdirAll(path, sharedAssetDirMode); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	base, err := filepath.Abs(s.baseDir)
	if err != nil {
		return err
	}
	target, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(base, target)
	if err != nil {
		return err
	}
	if relative == "." {
		return os.Chmod(base, sharedAssetDirMode)
	}
	if strings.HasPrefix(relative, ".."+string(os.PathSeparator)) || relative == ".." {
		return fmt.Errorf("invalid asset path")
	}
	if err := os.Chmod(base, sharedAssetDirMode); err != nil {
		return err
	}
	current := base
	for _, segment := range strings.Split(relative, string(os.PathSeparator)) {
		if segment == "." || segment == "" {
			continue
		}
		current = filepath.Join(current, segment)
		if err := os.Chmod(current, sharedAssetDirMode); err != nil {
			return err
		}
	}
	return nil
}

func (s *LocalFSStorage) Get(ctx context.Context, key string) (io.ReadCloser, StorageObject, error) {
	if err := ctx.Err(); err != nil {
		return nil, StorageObject{}, err
	}
	target, err := s.safePath(key)
	if err != nil {
		return nil, StorageObject{}, err
	}
	file, err := os.Open(target)
	if err != nil {
		return nil, StorageObject{}, err
	}
	object, err := s.Stat(ctx, key)
	if err != nil {
		_ = file.Close()
		return nil, StorageObject{}, err
	}
	return file, object, nil
}

func (s *LocalFSStorage) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target, err := s.safePath(key)
	if err != nil {
		return err
	}
	err = os.Remove(target)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *LocalFSStorage) Stat(ctx context.Context, key string) (StorageObject, error) {
	if err := ctx.Err(); err != nil {
		return StorageObject{}, err
	}
	target, err := s.safePath(key)
	if err != nil {
		return StorageObject{}, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return StorageObject{}, err
	}
	url, err := s.URL(ctx, key)
	if err != nil {
		return StorageObject{}, err
	}
	return StorageObject{
		Key:        filepath.ToSlash(filepath.Clean(key)),
		URL:        url,
		Size:       info.Size(),
		ModifiedAt: info.ModTime(),
	}, nil
}

func (s *LocalFSStorage) URL(ctx context.Context, key string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	base := filepath.Base(key)
	assetID := strings.TrimSuffix(base, filepath.Ext(base))
	if strings.TrimSpace(assetID) == "" {
		return "", fmt.Errorf("invalid asset key")
	}
	return "/api/assets/" + assetID + "/content", nil
}

func (s *LocalFSStorage) safePath(relativePath string) (string, error) {
	base, err := filepath.Abs(s.baseDir)
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(base, relativePath))
	if err != nil {
		return "", err
	}
	if target != base && !strings.HasPrefix(target, base+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid asset path")
	}
	return target, nil
}

// S3Storage is intentionally left as a future implementation seam. Do not add
// cloud SDK dependencies until an object-storage work order is accepted.
type S3Storage struct{}
