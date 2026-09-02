package storage

import (
	"context"
	"io"
	"time"
)

type PutMeta struct {
	ContentType string
	Size        int64
}

type StorageObject struct {
	Key         string
	URL         string
	Size        int64
	ContentType string
	ModifiedAt  time.Time
}

// Storage is the asset persistence boundary. Current production uses
// LocalFSStorage; future object stores should implement this interface without
// changing handlers or repositories.
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, meta PutMeta) (StorageObject, error)
	Get(ctx context.Context, key string) (io.ReadCloser, StorageObject, error)
	Delete(ctx context.Context, key string) error
	Stat(ctx context.Context, key string) (StorageObject, error)
	URL(ctx context.Context, key string) (string, error)
}
