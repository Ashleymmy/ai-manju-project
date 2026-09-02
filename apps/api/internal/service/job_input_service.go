package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"mime"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/storage"
)

const (
	// StagedInputKeysPayloadField is internal job metadata used for terminal cleanup.
	StagedInputKeysPayloadField = "staged_input_keys"
	// InputStorageKeyPayloadField identifies the primary staged video input.
	InputStorageKeyPayloadField       = "input_storage_key"
	jobInputRoot                      = "jobs/inputs"
	defaultJobInputMaxBytes     int64 = 100 * 1024 * 1024
)

var (
	ErrJobInputTooLarge = errors.New("job input exceeds upload limit")
	safeJobInputSegment = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)
	safeJobInputExt     = regexp.MustCompile(`^\.[a-z0-9]{1,8}$`)
)

type JobInputUpload struct {
	FieldName   string
	FileName    string
	ContentType string
	Reader      io.Reader
}

type StagedJobInput struct {
	FieldName   string `json:"field_name"`
	FileName    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	StorageKey  string `json:"storage_key"`
}

func (input StagedJobInput) Payload() map[string]any {
	return map[string]any{
		"field_name":   input.FieldName,
		"filename":     input.FileName,
		"content_type": input.ContentType,
		"size":         input.Size,
		"sha256":       input.SHA256,
		"storage_key":  input.StorageKey,
	}
}

type JobInputService struct {
	store    storage.Storage
	maxBytes int64
}

func NewJobInputService(store storage.Storage, maxBytes int64) *JobInputService {
	if maxBytes <= 0 {
		maxBytes = defaultJobInputMaxBytes
	}
	return &JobInputService{store: store, maxBytes: maxBytes}
}

func (s *JobInputService) Stage(ctx context.Context, workspaceID string, uploads []JobInputUpload) ([]StagedJobInput, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("job input storage is not configured")
	}
	if len(uploads) == 0 {
		return []StagedJobInput{}, nil
	}
	prefix, err := JobInputWorkspacePrefix(workspaceID)
	if err != nil {
		return nil, err
	}
	batchID, err := randomJobInputID()
	if err != nil {
		return nil, err
	}

	staged := make([]StagedJobInput, 0, len(uploads))
	for _, upload := range uploads {
		if upload.Reader == nil {
			_ = s.Cleanup(context.WithoutCancel(ctx), workspaceID, StagedInputKeys(staged))
			return nil, errors.New("job input reader is required")
		}
		fileID, err := randomJobInputID()
		if err != nil {
			_ = s.Cleanup(context.WithoutCancel(ctx), workspaceID, StagedInputKeys(staged))
			return nil, err
		}
		key := strings.Join([]string{jobInputRoot, prefix, batchID, fileID + safeUploadExtension(upload.FileName, upload.ContentType)}, "/")
		reader := newBoundedHashReader(upload.Reader, s.maxBytes)
		_, putErr := s.store.Put(ctx, key, reader, storage.PutMeta{ContentType: strings.TrimSpace(upload.ContentType)})
		if putErr != nil {
			keys := append(StagedInputKeys(staged), key)
			_ = s.Cleanup(context.WithoutCancel(ctx), workspaceID, keys)
			return nil, fmt.Errorf("stage job input: %w", putErr)
		}
		staged = append(staged, StagedJobInput{
			FieldName:   strings.TrimSpace(upload.FieldName),
			FileName:    strings.TrimSpace(upload.FileName),
			ContentType: strings.TrimSpace(upload.ContentType),
			Size:        reader.Size(),
			SHA256:      reader.SHA256(),
			StorageKey:  key,
		})
	}
	return staged, nil
}

func (s *JobInputService) Cleanup(ctx context.Context, workspaceID string, keys []string) error {
	if s == nil || s.store == nil || len(keys) == 0 {
		return nil
	}
	prefix, err := JobInputWorkspacePrefix(workspaceID)
	if err != nil {
		return err
	}
	allowed := jobInputRoot + "/" + prefix + "/"
	var cleanupErr error
	for _, key := range keys {
		rawKey := strings.TrimSpace(key)
		parts := strings.Split(strings.ReplaceAll(rawKey, "\\", "/"), "/")
		invalidSegment := false
		for _, part := range parts {
			if part == ".." || part == "." || part == "" {
				invalidSegment = true
				break
			}
		}
		key = path.Clean(rawKey)
		if rawKey == "" || strings.Contains(rawKey, "\\") || strings.HasPrefix(rawKey, "/") || invalidSegment || key == "." || !strings.HasPrefix(key, allowed) {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("refusing to delete invalid staged input key %q", key))
			continue
		}
		if err := s.store.Delete(ctx, key); err != nil {
			cleanupErr = errors.Join(cleanupErr, err)
		}
	}
	return cleanupErr
}

func (s *JobInputService) CleanupPayload(ctx context.Context, workspaceID string, payload model.JSONB) error {
	return s.Cleanup(ctx, workspaceID, StagedInputKeysFromPayload(payload))
}

func StagedInputKeys(inputs []StagedJobInput) []string {
	keys := make([]string, 0, len(inputs))
	for _, input := range inputs {
		if strings.TrimSpace(input.StorageKey) != "" {
			keys = append(keys, input.StorageKey)
		}
	}
	return keys
}

func StagedInputKeysFromPayload(payload model.JSONB) []string {
	var raw map[string]any
	if len(payload) == 0 || json.Unmarshal(payload, &raw) != nil {
		return nil
	}
	values, ok := raw[StagedInputKeysPayloadField].([]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(values))
	for _, value := range values {
		if key := strings.TrimSpace(fmt.Sprint(value)); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

func JobInputWorkspacePrefix(workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	switch {
	case strings.HasPrefix(workspaceID, "default:"):
		return "personal/" + safeWorkspaceSegment(strings.TrimPrefix(workspaceID, "default:")), nil
	case strings.HasPrefix(workspaceID, "team:"):
		return "team/" + safeWorkspaceSegment(strings.TrimPrefix(workspaceID, "team:")), nil
	default:
		return "", fmt.Errorf("unsupported workspace id %q", workspaceID)
	}
}

func safeWorkspaceSegment(value string) string {
	value = safeJobInputSegment.ReplaceAllString(strings.TrimSpace(value), "_")
	value = strings.Trim(value, "_")
	if value == "" {
		return "unknown"
	}
	return value
}

func safeUploadExtension(fileName string, contentType string) string {
	contentType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	if extensions, _ := mime.ExtensionsByType(contentType); len(extensions) > 0 {
		ext := strings.ToLower(extensions[0])
		if safeJobInputExt.MatchString(ext) {
			return ext
		}
	}
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if safeJobInputExt.MatchString(ext) {
		return ext
	}
	return ".bin"
}

func randomJobInputID() (string, error) {
	data := make([]byte, 12)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

type boundedHashReader struct {
	reader    io.Reader
	remaining int64
	size      int64
	hash      hash.Hash
}

func newBoundedHashReader(reader io.Reader, maxBytes int64) *boundedHashReader {
	return &boundedHashReader{reader: reader, remaining: maxBytes, hash: sha256.New()}
}

func (r *boundedHashReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		var extra [1]byte
		n, err := r.reader.Read(extra[:])
		if n > 0 {
			return 0, ErrJobInputTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.reader.Read(p)
	if n > 0 {
		_, _ = r.hash.Write(p[:n])
		r.size += int64(n)
		r.remaining -= int64(n)
	}
	return n, err
}

func (r *boundedHashReader) Size() int64 {
	return r.size
}

func (r *boundedHashReader) SHA256() string {
	return hex.EncodeToString(r.hash.Sum(nil))
}
