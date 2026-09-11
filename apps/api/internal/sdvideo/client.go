package sdvideo

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
)

var ErrDisabled = errors.New("sd-video gateway is disabled")

const maxResultBytes = int64(512 * 1024 * 1024)

type Client struct {
	baseURL       string
	cfg           config.Config
	client        *http.Client
	private       ed25519.PrivateKey
	drainAccepted bool
}

type TaskResponse struct {
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	Error     json.RawMessage `json:"error"`
	RequestID string          `json:"request_id"`
}

type Error struct {
	StatusCode int
	Message    string
}

func (e *Error) Error() string {
	return fmt.Sprintf("sd-video request failed (%d): %s", e.StatusCode, e.Message)
}

func NewClient(cfg config.Config) *Client {
	if name := os.Getenv("SD_VIDEO_JWT_PRIVATE_KEY_FILE"); name != "" {
		data, err := os.ReadFile(name)
		if err != nil {
			cfg.SDVideoJWTPrivateKey = ""
		} else {
			cfg.SDVideoJWTPrivateKey = string(data)
		}
	}
	private, _ := parsePrivateKey(cfg.SDVideoJWTPrivateKey)
	timeout := time.Duration(cfg.SDVideoRequestTimeoutMilli) * time.Millisecond
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if filename := os.Getenv("SD_VIDEO_CA_FILE"); filename != "" {
		certs, err := os.ReadFile(filename)
		pool, poolErr := x509.SystemCertPool()
		if poolErr != nil {
			pool = x509.NewCertPool()
		}
		if err != nil || !pool.AppendCertsFromPEM(certs) {
			private = nil
		} else {
			transport.TLSClientConfig.RootCAs = pool
		}
	}
	base, err := url.Parse(cfg.SDVideoBaseURL)
	if err != nil || base.User != nil || (cfg.AppEnv == "production" && base.Scheme != "https") {
		private = nil
	}
	httpClient := &http.Client{Timeout: timeout, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("sd-video service redirects are forbidden")
	}}
	return &Client{baseURL: strings.TrimRight(cfg.SDVideoBaseURL, "/"), cfg: cfg, client: httpClient, private: private}
}

func (c *Client) Enabled() bool {
	return c.baseURL != "" && len(c.private) == ed25519.PrivateKeySize
}

// Mode exposes the rollout mode without leaking any credentials.  The
// gateway uses this to keep shadow traffic validation-only while active mode
// is the only mode that creates a remote task.
func (c *Client) Mode() string { return strings.ToLower(strings.TrimSpace(c.cfg.SDVideoMode)) }

func (c *Client) Shadow() bool { return c.Enabled() && c.Mode() == "shadow" }

func (c *Client) AllowsCreation(workspace, modelID string) bool {
	allows := func(values []string, expected string) bool {
		if len(values) == 0 {
			return true
		}
		for _, value := range values {
			if strings.TrimPrefix(value, "sdvideo/") == expected {
				return true
			}
		}
		return false
	}
	return c.Mode() == "active" && allows(c.cfg.SDVideoAllowedWorkspaces, workspace) && allows(c.cfg.SDVideoAllowedModels, strings.TrimPrefix(modelID, "sdvideo/"))
}

// 仅 Bridge 调用：关闭新任务入口后，继续发送已持久化、已获准的 outbox。
func (c *Client) CreateAcceptedTask(ctx context.Context, user model.User, workspace string, payload map[string]any) (TaskResponse, error) {
	accepted := *c
	accepted.cfg.SDVideoMode = "active"
	accepted.drainAccepted = true
	return accepted.CreateTask(ctx, user, workspace, payload)
}

// IsNotFound lets the Studio handlers probe the private task store when the
// browser did not include the model query parameter (for example after a
// refresh).  A legacy provider task simply falls through to the old route.
func IsNotFound(err error) bool {
	var requestErr *Error
	return errors.As(err, &requestErr) && requestErr.StatusCode == http.StatusNotFound
}

func (c *Client) CreateTask(ctx context.Context, user model.User, workspaceID string, payload map[string]any) (TaskResponse, error) {
	if c.Mode() != "active" {
		return TaskResponse{}, ErrDisabled
	}
	if previous := stringValue(payload["retry_task_id"]); previous != "" {
		return c.doJSON(ctx, http.MethodPost, "/v1/tasks/"+urlPathEscape(previous)+"/retry", user, workspaceID, map[string]any{
			"studio_job_id": payload["studio_job_id"], "studio_message_id": payload["studio_message_id"],
		})
	}
	if payload["model"] == "toolkit/erase" {
		// JSON 持久化后的 references 为 []any，不能依赖创建时的 Go 容器类型。
		raw, _ := json.Marshal(payload["references"])
		var references []map[string]any
		if json.Unmarshal(raw, &references) != nil || len(references) != 1 {
			return TaskResponse{}, errors.New("erase input is invalid")
		}
		request := map[string]any{"idempotency_key": payload["idempotency_key"], "storage_token": references[0]["storage_token"], "mode": payload["tool_mode"], "studio_job_id": payload["studio_job_id"]}
		return c.doJSON(ctx, http.MethodPost, "/v1/toolkit/erase", user, workspaceID, request)
	}
	return c.doJSON(ctx, http.MethodPost, "/v1/tasks", user, workspaceID, payload)
}

func (c *Client) GetTask(ctx context.Context, user model.User, workspaceID, taskID string) (TaskResponse, error) {
	return c.doJSON(ctx, http.MethodGet, "/v1/tasks/"+urlPathEscape(taskID), user, workspaceID, nil)
}

func (c *Client) CancelTask(ctx context.Context, user model.User, workspaceID, taskID string) (TaskResponse, error) {
	return c.doJSON(ctx, http.MethodPost, "/v1/tasks/"+urlPathEscape(taskID)+"/cancel", user, workspaceID, nil)
}

func (c *Client) RetryTask(ctx context.Context, user model.User, workspaceID, taskID string) (TaskResponse, error) {
	return c.doJSON(ctx, http.MethodPost, "/v1/tasks/"+urlPathEscape(taskID)+"/retry", user, workspaceID, nil)
}

func (c *Client) ListModels(ctx context.Context, user model.User, workspaceID string) (TaskResponse, error) {
	return c.doJSON(ctx, http.MethodGet, "/v1/models", user, workspaceID, nil)
}

// 仅由固定路由的 Gateway 使用，不导出上游地址给浏览器。
func (c *Client) BusinessRequest(ctx context.Context, method, path string, user model.User, workspaceID string, payload any) (TaskResponse, error) {
	if !strings.HasPrefix(path, "/v1/") || strings.ContainsAny(path, "\\\r\n") {
		return TaskResponse{}, errors.New("invalid business path")
	}
	return c.doJSON(ctx, method, path, user, workspaceID, payload)
}

// UploadInput copies a Studio-owned reference into the standalone service's
// isolated input bucket. The returned storage key is opaque to the browser
// and is scoped by the short-lived service token.
func (c *Client) UploadInput(ctx context.Context, user model.User, workspaceID, name, contentType string, body []byte) (string, error) {
	if len(body) == 0 {
		return "", errors.New("sd-video input is empty")
	}
	presign, err := c.doJSON(ctx, http.MethodPost, "/v1/inputs/presign", user, workspaceID, map[string]any{
		"name": name, "content_type": contentType, "size_bytes": len(body),
	})
	if err != nil {
		return "", err
	}
	var data map[string]any
	if err := json.Unmarshal(presign.Data, &data); err != nil {
		return "", err
	}
	token := strings.TrimSpace(stringValue(data["upload_token"]))
	if token == "" {
		return "", errors.New("sd-video input presign did not return upload token")
	}
	req, err := c.newRequest(ctx, http.MethodPut, "/v1/inputs/"+urlPathEscape(token), user, workspaceID, nil)
	if err != nil {
		return "", err
	}
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", firstNonEmpty(contentType, "application/octet-stream"))
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if readErr != nil {
		return "", readErr
	}
	var uploaded TaskResponse
	if json.Unmarshal(raw, &uploaded) != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 || !uploaded.Success {
		return "", &Error{StatusCode: resp.StatusCode, Message: "reference upload rejected"}
	}
	digest := sha256.Sum256(body)
	if _, err := c.doJSON(ctx, http.MethodPost, "/v1/inputs/complete", user, workspaceID, map[string]any{"upload_token": token, "sha256": hex.EncodeToString(digest[:])}); err != nil {
		return "", err
	}
	return token, nil
}

func (c *Client) Result(ctx context.Context, user model.User, workspaceID, taskID string) ([]byte, string, error) {
	return c.download(ctx, user, workspaceID, "/v1/tasks/"+urlPathEscape(taskID)+"/result")
}

func (c *Client) AssetContent(ctx context.Context, user model.User, workspaceID, assetID string) ([]byte, string, error) {
	return c.download(ctx, user, workspaceID, "/v1/volcano/assets/"+urlPathEscape(assetID)+"/content")
}

func (c *Client) Thumbnail(ctx context.Context, user model.User, workspaceID, kind, id string) ([]byte, string, error) {
	path := "/v1/media/"
	if kind == "volcano" {
		path = "/v1/volcano/assets/"
	} else if kind != "media" {
		return nil, "", errors.New("invalid thumbnail kind")
	}
	return c.downloadLimited(ctx, user, workspaceID, path+urlPathEscape(id)+"/thumbnail", 2*1024*1024)
}

func (c *Client) download(ctx context.Context, user model.User, workspaceID, path string) ([]byte, string, error) {
	return c.downloadLimited(ctx, user, workspaceID, path, maxResultBytes)
}

func (c *Client) downloadLimited(ctx context.Context, user model.User, workspaceID, path string, limit int64) ([]byte, string, error) {
	if !c.Enabled() {
		return nil, "", ErrDisabled
	}
	req, err := c.newRequest(ctx, http.MethodGet, path, user, workspaceID, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
		return nil, "", &Error{StatusCode: resp.StatusCode, Message: string(body)}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err == nil && int64(len(body)) > limit {
		return nil, "", errors.New("sd-video result exceeds maximum size")
	}
	return body, resp.Header.Get("Content-Type"), err
}

func (c *Client) doJSON(ctx context.Context, method, path string, user model.User, workspaceID string, payload any) (TaskResponse, error) {
	if !c.Enabled() {
		return TaskResponse{}, ErrDisabled
	}
	req, err := c.newRequest(ctx, method, path, user, workspaceID, payload)
	if err != nil {
		return TaskResponse{}, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return TaskResponse{}, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if readErr != nil {
		return TaskResponse{}, readErr
	}
	var envelope TaskResponse
	if json.Unmarshal(body, &envelope) != nil {
		return TaskResponse{}, &Error{StatusCode: resp.StatusCode, Message: string(body)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		return envelope, &Error{StatusCode: resp.StatusCode, Message: string(envelope.Error)}
	}
	return envelope, nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, user model.User, workspaceID string, payload any) (*http.Request, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.sign(user, workspaceID))
	req.Header.Set("X-Request-ID", requestID())
	return req, nil
}

func (c *Client) sign(user model.User, workspaceID string) string {
	now := time.Now().UTC()
	header := map[string]any{"alg": "EdDSA", "kid": c.cfg.SDVideoJWTKeyID, "typ": "JWT"}
	claims := map[string]any{
		"iss":          c.cfg.SDVideoJWTIssuer,
		"aud":          c.cfg.SDVideoJWTAudience,
		"sub":          user.ID,
		"workspace_id": workspaceID,
		"role":         user.Role,
		"scope":        "tasks:read tasks:write models:read assets:read assets:write conversations:read conversations:write toolkit:read toolkit:write",
		"iat":          now.Unix(),
		"exp":          now.Add(5 * time.Minute).Unix(),
		"jti":          requestID(),
	}
	if user.Role == model.UserRoleSuperAdmin {
		claims["role"] = "admin"
		claims["scope"] = claims["scope"].(string) + " admin"
	}
	if c.drainAccepted {
		claims["scope"] = claims["scope"].(string) + " tasks:drain"
	}
	encode := func(value any) string {
		data, _ := json.Marshal(value)
		return base64.RawURLEncoding.EncodeToString(data)
	}
	unsigned := encode(header) + "." + encode(claims)
	signature := ed25519.Sign(c.private, []byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func parsePrivateKey(raw string) (ed25519.PrivateKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if strings.Contains(raw, "BEGIN") {
		block, _ := pemDecode([]byte(raw))
		if block == nil {
			return nil, errors.New("invalid SD_VIDEO_JWT_PRIVATE_KEY PEM")
		}
		key, err := x509.ParsePKCS8PrivateKey(block)
		if err != nil {
			return nil, err
		}
		private, ok := key.(ed25519.PrivateKey)
		if !ok {
			return nil, errors.New("SD_VIDEO_JWT_PRIVATE_KEY must be Ed25519")
		}
		return private, nil
	}
	decoded, err := base64.RawStdEncoding.DecodeString(raw)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(raw)
	}
	if err != nil {
		decoded, err = hex.DecodeString(raw)
	}
	if err != nil || len(decoded) != ed25519.PrivateKeySize {
		return nil, errors.New("SD_VIDEO_JWT_PRIVATE_KEY must be base64/hex Ed25519 private key")
	}
	return ed25519.PrivateKey(decoded), nil
}

func pemDecode(data []byte) ([]byte, []byte) {
	// Kept tiny to avoid pulling another JWT dependency into the Go API.
	for _, marker := range []string{"-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----"} {
		data = bytes.ReplaceAll(data, []byte(marker), nil)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(string(data)), ""))
	if err != nil {
		return nil, nil
	}
	return decoded, nil
}

func requestID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		sum := sha256.Sum256([]byte(time.Now().UTC().String()))
		return hex.EncodeToString(sum[:16])
	}
	return hex.EncodeToString(buf)
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func urlPathEscape(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "/", "%2F"), " ", "%20")
}
