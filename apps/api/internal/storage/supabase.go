package storage

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
)

const (
	// 此身份只由本地存储受信端签发；云端应用不持有 Storage JWT 签名密钥。
	studioStorageRole       = "studio_storage_service"
	storageTokenMaxLifetime = 300
	storageResponseLimit    = 64 * 1024
	storageRequestTimeout   = 120 * time.Second
)

var storageBucketPattern = regexp.MustCompile(`^studio-[a-z0-9][a-z0-9-]{1,60}$`)

type storageHTTPError struct{ status int }

func (e *storageHTTPError) Error() string {
	return fmt.Sprintf("Storage request failed (HTTP %d)", e.status)
}

// SupabaseStorage 只调用 Storage API，不访问旧 Auth、PostgREST 或业务数据库。
type SupabaseStorage struct {
	origin       string
	publicOrigin string
	bucket       string
	token        string
	tokenFile    string
	apiKey       string
	apiKeyFile   string
	client       *http.Client
}

func storageOrigin(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("Storage endpoint must be an HTTPS origin")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func NewSupabaseStorage(cfg config.Config) (*SupabaseStorage, error) {
	origin, err := storageOrigin(cfg.SupabaseStorageURL)
	if err != nil {
		return nil, err
	}
	public := cfg.SupabaseStoragePublicURL
	if public == "" {
		public = origin
	}
	public, err = storageOrigin(public)
	if err != nil {
		return nil, err
	}
	if !storageBucketPattern.MatchString(cfg.SupabaseStorageBucket) || strings.HasPrefix(cfg.SupabaseStorageBucket, "studio-sdvideo-") {
		return nil, errors.New("Studio requires its own studio-* Storage bucket")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil // 私网凭据请求不经过环境变量指定的代理。
	if cfg.SupabaseStorageCAFile != "" {
		pem, err := os.ReadFile(cfg.SupabaseStorageCAFile)
		if err != nil {
			return nil, errors.New("cannot read Storage CA file")
		}
		roots, err := x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM(pem) {
			return nil, errors.New("invalid Storage CA certificate")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}
	s := &SupabaseStorage{origin: origin, publicOrigin: public, bucket: cfg.SupabaseStorageBucket,
		token: cfg.SupabaseStorageToken, tokenFile: cfg.SupabaseStorageTokenFile,
		apiKey: cfg.SupabaseStorageAPIKey, apiKeyFile: cfg.SupabaseStorageAPIKeyFile,
		client: &http.Client{Transport: transport, Timeout: storageRequestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
	}
	if _, err := s.credentials(); err != nil {
		return nil, err
	}
	return s, nil
}

func readStorageSecret(value, file string) (string, error) {
	if file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			return "", errors.New("cannot read Storage credential file")
		}
		value = string(data)
	}
	value = strings.TrimSpace(value)
	if strings.ContainsAny(value, "\r\n") || len(value) > storageResponseLimit {
		return "", errors.New("invalid Storage credential")
	}
	return value, nil
}

func (s *SupabaseStorage) credentials() (http.Header, error) {
	// 每次请求重新读取原子替换的令牌文件，使轮换不依赖容器重启。
	token, err := readStorageSecret(s.token, s.tokenFile)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[2] == "" {
		return nil, errors.New("a scoped Storage JWT is required")
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	var jwtHeader struct {
		Algorithm string `json:"alg"`
	}
	if err != nil || json.Unmarshal(header, &jwtHeader) != nil {
		return nil, errors.New("invalid Storage JWT header")
	}
	switch jwtHeader.Algorithm {
	case "HS256", "RS256", "ES256", "EdDSA":
	default:
		return nil, errors.New("invalid Storage JWT algorithm")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid Storage JWT")
	}
	var claims struct {
		Role    string   `json:"role"`
		Subject string   `json:"sub"`
		Expires int64    `json:"exp"`
		Issued  int64    `json:"iat"`
		Buckets []string `json:"storage_buckets"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return nil, errors.New("invalid Storage JWT claims")
	}
	now := time.Now().Unix()
	allowed := false
	for _, bucket := range claims.Buckets {
		if bucket == s.bucket {
			allowed = true
		}
	}
	if claims.Role != studioStorageRole || claims.Subject == "" || !allowed || claims.Issued <= 0 || claims.Issued > now+30 || claims.Expires <= now || claims.Expires <= claims.Issued || claims.Expires-claims.Issued > storageTokenMaxLifetime {
		return nil, errors.New("Storage JWT must be unexpired, short-lived and scoped to the Studio bucket")
	}
	// 本地解码仅防误配；JWT 签名和真实权限仍由 Storage 服务验证。
	key, err := readStorageSecret(s.apiKey, s.apiKeyFile)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(key, "sb_secret_") {
		return nil, errors.New("privileged Storage gateway API key is forbidden")
	}
	if key != "" {
		parts := strings.Split(key, ".")
		if len(parts) != 3 {
			return nil, errors.New("Storage gateway requires its public anon JWT key")
		}
		data, err := base64.RawURLEncoding.DecodeString(parts[1])
		var gateway struct {
			Role string `json:"role"`
		}
		if err != nil || json.Unmarshal(data, &gateway) != nil || gateway.Role != "anon" {
			return nil, errors.New("privileged Storage gateway API key is forbidden")
		}
	}
	headers := http.Header{"Authorization": {"Bearer " + token}}
	if key != "" {
		headers.Set("apikey", key)
	}
	return headers, nil
}

func (s *SupabaseStorage) target(key string) (string, error) {
	if err := validateObjectKey(key); err != nil {
		return "", err
	}
	parts := strings.Split(key, "/")
	for i, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsFunc(part, func(r rune) bool { return r < 32 }) {
			return "", errors.New("invalid Storage object key")
		}
		parts[i] = url.PathEscape(part)
	}
	return url.PathEscape(s.bucket) + "/" + strings.Join(parts, "/"), nil
}

func (s *SupabaseStorage) request(ctx context.Context, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	headers, err := s.credentials()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, s.origin+"/storage/v1/"+path, body)
	if err != nil {
		return nil, errors.New("invalid Storage request")
	}
	req.Header = headers
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if method == http.MethodPost {
		req.Header.Set("x-upsert", "false")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("Storage request unavailable")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		status := resp.StatusCode
		if status == http.StatusBadRequest {
			data, _ := io.ReadAll(io.LimitReader(resp.Body, storageResponseLimit))
			var apiError struct {
				Status json.RawMessage `json:"statusCode"`
			}
			if json.Unmarshal(data, &apiError) == nil {
				if value, err := strconv.Atoi(strings.Trim(string(apiError.Status), `"`)); err == nil && (value == 404 || value == 409 || value == 403) {
					status = value
				}
			}
		}
		switch status {
		case http.StatusNotFound:
			return nil, os.ErrNotExist
		case http.StatusConflict:
			return nil, os.ErrExist
		}
		return nil, &storageHTTPError{status: status}
	}
	return resp, nil
}

func objectFromResponse(key string, resp *http.Response) StorageObject {
	size, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	modified, _ := http.ParseTime(resp.Header.Get("Last-Modified"))
	return StorageObject{Key: key, Size: size, ContentType: resp.Header.Get("Content-Type"), ModifiedAt: modified}
}

func (s *SupabaseStorage) Put(ctx context.Context, key string, r io.Reader, meta PutMeta) (StorageObject, error) {
	target, err := s.target(key)
	if err != nil {
		return StorageObject{}, err
	}
	resp, err := s.request(ctx, http.MethodPost, "object/"+target, r, meta.ContentType)
	if err != nil {
		return StorageObject{}, err
	}
	resp.Body.Close()
	return s.Stat(ctx, key)
}

func (s *SupabaseStorage) Stat(ctx context.Context, key string) (StorageObject, error) {
	target, err := s.target(key)
	if err != nil {
		return StorageObject{}, err
	}
	resp, err := s.request(ctx, http.MethodHead, "object/authenticated/"+target, nil, "")
	if err != nil {
		var status *storageHTTPError
		if errors.As(err, &status) && status.status == http.StatusBadRequest {
			// v1.48.26 的 HEAD 缺失对象只返回 400，没有 JSON body。
			// 用轻量 info 接口确认真实状态，不能把权限/配置错误也当作 404。
			return s.statInfo(ctx, key, target)
		}
		return StorageObject{}, err
	}
	defer resp.Body.Close()
	return objectFromResponse(key, resp), nil
}

func (s *SupabaseStorage) statInfo(ctx context.Context, key, target string) (StorageObject, error) {
	resp, err := s.request(ctx, http.MethodGet, "object/info/authenticated/"+target, nil, "")
	if err != nil {
		return StorageObject{}, err
	}
	defer resp.Body.Close()
	var info struct {
		Name        string    `json:"name"`
		Bucket      string    `json:"bucket_id"`
		Size        *int64    `json:"size"`
		ContentType string    `json:"content_type"`
		Modified    time.Time `json:"last_modified"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, storageResponseLimit)).Decode(&info) != nil || info.Name != key || info.Bucket != s.bucket || info.Size == nil || *info.Size < 0 {
		return StorageObject{}, errors.New("invalid Storage object info response")
	}
	return StorageObject{Key: key, Size: *info.Size, ContentType: info.ContentType, ModifiedAt: info.Modified}, nil
}

func (s *SupabaseStorage) Get(ctx context.Context, key string) (io.ReadCloser, StorageObject, error) {
	target, err := s.target(key)
	if err != nil {
		return nil, StorageObject{}, err
	}
	resp, err := s.request(ctx, http.MethodGet, "object/authenticated/"+target, nil, "")
	if err != nil {
		return nil, StorageObject{}, err
	}
	return resp.Body, objectFromResponse(key, resp), nil
}

func (s *SupabaseStorage) Delete(ctx context.Context, key string) error {
	if _, err := s.target(key); err != nil {
		return err
	}
	body, _ := json.Marshal(map[string][]string{"prefixes": {key}})
	resp, err := s.request(ctx, http.MethodDelete, "object/"+url.PathEscape(s.bucket), bytes.NewReader(body), "application/json")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (s *SupabaseStorage) URL(ctx context.Context, key string) (string, error) {
	target, err := s.target(key)
	if err != nil {
		return "", err
	}
	body, _ := json.Marshal(map[string]int{"expiresIn": signedAssetTTL})
	resp, err := s.request(ctx, http.MethodPost, "object/sign/"+target, bytes.NewReader(body), "application/json")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		SignedURL string `json:"signedURL"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, storageResponseLimit)).Decode(&result) != nil {
		return "", errors.New("invalid Storage signing response")
	}
	u, err := url.Parse(result.SignedURL)
	if err != nil || u.User != nil || u.Fragment != "" {
		return "", errors.New("invalid Storage signed URL")
	}
	if u.IsAbs() || u.Host != "" {
		if u.Scheme != "https" || (u.Scheme+"://"+u.Host != s.origin && u.Scheme+"://"+u.Host != s.publicOrigin) {
			return "", errors.New("external Storage signing origin rejected")
		}
	}
	expected := "/storage/v1/object/sign/" + target
	decoded, _ := url.PathUnescape(expected)
	if strings.TrimPrefix(u.Path, "/storage/v1") != strings.TrimPrefix(decoded, "/storage/v1") || len(u.Query()["token"]) != 1 || u.Query().Get("token") == "" {
		return "", errors.New("Storage signed URL does not match requested object")
	}
	return s.publicOrigin + expected + "?" + u.RawQuery, nil
}

// Probe 只查询当前专属桶，不枚举账号中的旧桶，也不写探针文件。
func (s *SupabaseStorage) Probe(ctx context.Context) error {
	resp, err := s.request(ctx, http.MethodGet, "bucket/"+url.PathEscape(s.bucket), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var bucket struct {
		ID     string `json:"id"`
		Public *bool  `json:"public"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, storageResponseLimit)).Decode(&bucket) != nil || bucket.ID != s.bucket || bucket.Public == nil || *bucket.Public {
		return errors.New("Storage bucket must exist and be private")
	}
	return nil
}
