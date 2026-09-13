package storage

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

const signedAssetTTL = 300 // CDN Type A 的鉴权有效期须同样配置为 300 秒。

type OSSStorage struct {
	bucket  *oss.Bucket
	cdnBase string
	cdnKey  string
}

func NewConfiguredStorage(cfg config.Config) (Storage, error) {
	if cfg.AssetStorageBackend == "" || cfg.AssetStorageBackend == "local" {
		return NewLocalFSStorage(cfg.AssetStorageDir), nil
	}
	if cfg.AssetStorageBackend == "supabase" {
		return NewSupabaseStorage(cfg)
	}
	if cfg.AssetStorageBackend != "oss" {
		return nil, errors.New("unsupported ASSET_STORAGE_BACKEND")
	}
	if cfg.OSSEndpoint == "" || cfg.OSSBucket == "" || cfg.OSSAccessKeyID == "" || cfg.OSSAccessKeySecret == "" {
		return nil, errors.New("Studio OSS configuration is incomplete")
	}
	endpoint, err := url.Parse(cfg.OSSEndpoint)
	if err != nil || endpoint.Host == "" || (cfg.AppEnv == "production" && endpoint.Scheme != "https") {
		return nil, errors.New("invalid Studio OSS HTTPS endpoint")
	}
	client, err := oss.New(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret, oss.SecurityToken(cfg.OSSSecurityToken), oss.Timeout(10, 120))
	if err != nil {
		return nil, errors.New("cannot initialize OSS client")
	}
	bucket, err := client.Bucket(cfg.OSSBucket)
	if err != nil {
		return nil, err
	}
	if cfg.AssetCDNBaseURL != "" {
		u, err := url.Parse(cfg.AssetCDNBaseURL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || (u.Path != "" && u.Path != "/") || cfg.AssetCDNAuthKey == "" {
			return nil, errors.New("CDN requires HTTPS origin and Type A signing key")
		}
	}
	return &OSSStorage{bucket: bucket, cdnBase: strings.TrimRight(cfg.AssetCDNBaseURL, "/"), cdnKey: cfg.AssetCDNAuthKey}, nil
}

func validateObjectKey(key string) error {
	if key == "" || strings.ContainsAny(key, "\\\x00\r\n") || strings.HasPrefix(key, "/") || path.Clean(key) != key || key == ".." || strings.HasPrefix(key, "../") {
		return errors.New("invalid object key")
	}
	return nil
}

func (s *OSSStorage) Put(ctx context.Context, key string, reader io.Reader, meta PutMeta) (StorageObject, error) {
	if err := validateObjectKey(key); err != nil {
		return StorageObject{}, err
	}
	options := []oss.Option{oss.WithContext(ctx), oss.ContentType(meta.ContentType), oss.ForbidOverWrite(true)}
	if err := s.bucket.PutObject(key, reader, options...); err != nil {
		var remote oss.ServiceError
		if errors.As(err, &remote) && remote.StatusCode == http.StatusConflict {
			return StorageObject{}, os.ErrExist
		}
		return StorageObject{}, errors.New("OSS upload failed")
	}
	return s.Stat(ctx, key)
}
func (s *OSSStorage) Stat(ctx context.Context, key string) (StorageObject, error) {
	if err := validateObjectKey(key); err != nil {
		return StorageObject{}, err
	}
	header, err := s.bucket.GetObjectDetailedMeta(key, oss.WithContext(ctx))
	if err != nil {
		var remote oss.ServiceError
		if errors.As(err, &remote) && remote.StatusCode == http.StatusNotFound {
			return StorageObject{}, os.ErrNotExist
		}
		return StorageObject{}, errors.New("OSS object metadata unavailable")
	}
	size, _ := strconv.ParseInt(header.Get("Content-Length"), 10, 64)
	modified, _ := http.ParseTime(header.Get("Last-Modified"))
	return StorageObject{Key: key, Size: size, ContentType: header.Get("Content-Type"), ModifiedAt: modified}, nil
}
func (s *OSSStorage) Get(ctx context.Context, key string) (io.ReadCloser, StorageObject, error) {
	meta, err := s.Stat(ctx, key)
	if err != nil {
		return nil, meta, err
	}
	body, err := s.bucket.GetObject(key, oss.WithContext(ctx))
	if err != nil {
		return nil, meta, errors.New("OSS download failed")
	}
	return body, meta, nil
}
func (s *OSSStorage) Delete(ctx context.Context, key string) error {
	if err := validateObjectKey(key); err != nil {
		return err
	}
	if err := s.bucket.DeleteObject(key, oss.WithContext(ctx)); err != nil {
		return errors.New("OSS delete failed")
	}
	return nil
}
func (s *OSSStorage) URL(ctx context.Context, key string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := validateObjectKey(key); err != nil {
		return "", err
	}
	if s.cdnBase == "" {
		return s.bucket.SignURL(key, oss.HTTPGet, signedAssetTTL)
	}
	u, _ := url.Parse(s.cdnBase)
	u.Path = "/" + key
	nonce := make([]byte, 8)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	fields := fmt.Sprintf("%d-%s-0", time.Now().Unix(), hex.EncodeToString(nonce))
	digest := md5.Sum([]byte(u.EscapedPath() + "-" + fields + "-" + s.cdnKey))
	u.RawQuery = "auth_key=" + fields + "-" + hex.EncodeToString(digest[:])
	return u.String(), nil
}
