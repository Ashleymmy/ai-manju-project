package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

const (
	// A timed-out execution remains reserved; expiry never authorizes another POST.
	SyncGenerationExecutionTimeout = time.Hour
	GenerationReceiptRetention     = 7 * 24 * time.Hour
	// Match the existing Provider JSON and binary response bounds.
	GenerationReceiptMaxTextBytes  = 64 * 1024 * 1024
	GenerationReceiptMaxAudioBytes = 512 * 1024 * 1024
	generationReceiptHeaderLimit   = 8 * 1024
	generationReceiptScopeLimit    = 256
	generationReceiptEnvelopeV1    = 1
	generationReceiptIDBytes       = 16
	generationReceiptTokenBytes    = 32
	// AES-GCM nonce (12 bytes) plus authentication tag (16 bytes).
	generationReceiptCipherOverhead      = 28
	GenerationReceiptFailureMessage      = "生成失败，请查看原任务状态"
	GenerationReceiptUncertainMessage    = "生成结果尚未确认，请查询原任务，不要重复生成"
	GenerationReceiptNotSubmittedMessage = "该生成请求尚未提交，可重新发起生成"
)

var (
	ErrGenerationReceiptNotFound    = repository.ErrGenerationReceiptNotFound
	ErrGenerationReceiptConflict    = repository.ErrGenerationReceiptConflict
	ErrGenerationReceiptInvalid     = errors.New("invalid generation receipt request")
	ErrGenerationReceiptUnavailable = errors.New("generation receipt temporarily unavailable")
	generationReceiptHashPattern    = regexp.MustCompile(`^[a-f0-9]{64}$`)
	generationReceiptIDPattern      = regexp.MustCompile(`^gr_[a-f0-9]{32}$`)
)

type GenerationReceiptScope struct {
	UserID, WorkspaceID, Kind, Key string
}

type GenerationReceiptResult struct {
	ContentType string
	Body        []byte
}

type GenerationReceiptService struct {
	repo    repository.GenerationReceiptRepository
	storage storage.Storage
	box     provider.SecretBox
	ready   bool
	clock   func() time.Time
}

func NewGenerationReceiptService(repo repository.GenerationReceiptRepository, store storage.Storage, box provider.SecretBox) *GenerationReceiptService {
	_, err := box.Encrypt("generation-receipt-availability")
	return &GenerationReceiptService{repo: repo, storage: store, box: box, ready: repo != nil && store != nil && err == nil, clock: func() time.Time { return time.Now().UTC() }}
}

// GenerationReceiptRequestHash hashes a canonical JSON representation: object
// keys are sorted at every depth, whitespace is discarded and numbers retain
// their full precision. It never stores the request or execution credentials.
func GenerationReceiptRequestHash(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", ErrGenerationReceiptInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var canonical any
	if decoder.Decode(&canonical) != nil {
		return "", ErrGenerationReceiptInvalid
	}
	canonical, err = normalizeGenerationReceiptNumbers(canonical)
	if err != nil {
		return "", ErrGenerationReceiptInvalid
	}
	raw, err = json.Marshal(canonical)
	if err != nil {
		return "", ErrGenerationReceiptInvalid
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// Normalize decimal numbers without float64 rounding: 1, 1.0 and 1e0 bind to
// the same request while distinct integers beyond 2^53 remain distinct.
func normalizeGenerationReceiptNumbers(value any) (any, error) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			normalized, err := normalizeGenerationReceiptNumbers(item)
			if err != nil {
				return nil, err
			}
			current[key] = normalized
		}
	case []any:
		for index, item := range current {
			normalized, err := normalizeGenerationReceiptNumbers(item)
			if err != nil {
				return nil, err
			}
			current[index] = normalized
		}
	case json.Number:
		text, exponent, negative := string(current), int64(0), false
		if strings.HasPrefix(text, "-") {
			negative, text = true, text[1:]
		}
		if index := strings.IndexAny(text, "eE"); index >= 0 {
			parsed, err := strconv.ParseInt(text[index+1:], 10, 32)
			if err != nil {
				return nil, err
			}
			exponent, text = parsed, text[:index]
		}
		if index := strings.IndexByte(text, '.'); index >= 0 {
			exponent -= int64(len(text) - index - 1)
			text = text[:index] + text[index+1:]
		}
		text = strings.TrimLeft(text, "0")
		if text == "" {
			return json.Number("0"), nil
		}
		trimmed := strings.TrimRight(text, "0")
		exponent += int64(len(text) - len(trimmed))
		if negative {
			trimmed = "-" + trimmed
		}
		return json.Number(trimmed + "e" + strconv.FormatInt(exponent, 10)), nil
	}
	return value, nil
}

func validGenerationReceiptScope(scope GenerationReceiptScope) bool {
	for _, value := range []string{scope.UserID, scope.WorkspaceID, scope.Key} {
		if value == "" || len(value) > generationReceiptScopeLimit || strings.TrimSpace(value) != value || !utf8.ValidString(value) || strings.ContainsAny(value, "\x00\r\n") {
			return false
		}
	}
	// AssetStorageKey places the encrypted object in the user's workspace. Keep
	// its single workspace segment safe even if called outside an HTTP handler.
	if strings.ContainsAny(scope.WorkspaceID, "/\\") || scope.WorkspaceID == "." || scope.WorkspaceID == ".." || strings.TrimPrefix(scope.WorkspaceID, "default:") == ".." {
		return false
	}
	return scope.Kind == model.GenerationReceiptKindText || scope.Kind == model.GenerationReceiptKindAudio
}

func generationReceiptScope(receipt model.GenerationReceipt) GenerationReceiptScope {
	return GenerationReceiptScope{receipt.UserID, receipt.WorkspaceID, receipt.Kind, receipt.Key}
}

func sameReceiptBinding(a, b model.GenerationReceipt) bool {
	return a.ID == b.ID && a.UserID == b.UserID && a.WorkspaceID == b.WorkspaceID && a.Kind == b.Kind && a.Key == b.Key && a.RequestHash == b.RequestHash && a.ExecutionToken == b.ExecutionToken
}

func generationReceiptRandom(size int) (string, error) {
	value := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return "", ErrGenerationReceiptUnavailable
	}
	return hex.EncodeToString(value), nil
}

func (s *GenerationReceiptService) Begin(ctx context.Context, scope GenerationReceiptScope, requestHash string) (model.GenerationReceipt, bool, error) {
	if !validGenerationReceiptScope(scope) || !generationReceiptHashPattern.MatchString(requestHash) {
		return model.GenerationReceipt{}, false, ErrGenerationReceiptInvalid
	}
	if s == nil || !s.ready {
		// A durable tombstone is authoritative even if the execution/result
		// subsystem is unavailable. Never insert a running claim in this path.
		if s != nil && s.repo != nil {
			if receipt, err := s.repo.Find(ctx, scope.UserID, scope.WorkspaceID, scope.Kind, scope.Key); err == nil && receipt.State == model.GenerationReceiptStateNotSubmitted {
				return receipt, false, nil
			}
		}
		return model.GenerationReceipt{}, false, ErrGenerationReceiptUnavailable
	}
	id, err := generationReceiptRandom(generationReceiptIDBytes)
	if err != nil {
		return model.GenerationReceipt{}, false, err
	}
	token, err := generationReceiptRandom(generationReceiptTokenBytes)
	if err != nil {
		return model.GenerationReceipt{}, false, err
	}
	now := s.clock()
	candidate := model.GenerationReceipt{ID: "gr_" + id, UserID: scope.UserID, WorkspaceID: scope.WorkspaceID, Kind: scope.Kind, Key: scope.Key, RequestHash: requestHash, ExecutionToken: token, State: model.GenerationReceiptStateRunning, Deadline: now.Add(SyncGenerationExecutionTimeout), ExpiresAt: now.Add(SyncGenerationExecutionTimeout + GenerationReceiptRetention)}
	receipt, claimed, err := s.repo.Begin(ctx, candidate)
	if err != nil {
		return model.GenerationReceipt{}, false, ErrGenerationReceiptUnavailable
	}
	// Reconciliation reserved this key without a request body. Report that
	// definitive outcome before hash comparison; it never grants execution.
	if receipt.State == model.GenerationReceiptStateNotSubmitted {
		return receipt, false, nil
	}
	if receipt.RequestHash != requestHash {
		return receipt, false, ErrGenerationReceiptConflict
	}
	return receipt, claimed, nil
}

// Reconcile atomically closes the gap between persisting a client descriptor
// and submitting its POST. Begin is the same unique-key claim used by the POST:
// whichever inserts first wins. Existing executions are returned untouched,
// without checking result storage, executing generation or acquiring ownership.
func (s *GenerationReceiptService) Reconcile(ctx context.Context, scope GenerationReceiptScope) (model.GenerationReceipt, error) {
	if !validGenerationReceiptScope(scope) {
		return model.GenerationReceipt{}, ErrGenerationReceiptInvalid
	}
	if s == nil || s.repo == nil {
		return model.GenerationReceipt{}, ErrGenerationReceiptUnavailable
	}
	id, err := generationReceiptRandom(generationReceiptIDBytes)
	if err != nil {
		return model.GenerationReceipt{}, err
	}
	now := s.clock()
	// Empty hash/token deliberately confer no execution binding. Dates satisfy
	// the existing schema but are not expiry deadlines for permanent tombstones.
	candidate := model.GenerationReceipt{ID: "gr_" + id, UserID: scope.UserID, WorkspaceID: scope.WorkspaceID, Kind: scope.Kind, Key: scope.Key, State: model.GenerationReceiptStateNotSubmitted, Error: GenerationReceiptNotSubmittedMessage, Deadline: now, ExpiresAt: now}
	receipt, _, err := s.repo.Begin(ctx, candidate)
	if err != nil {
		return model.GenerationReceipt{}, ErrGenerationReceiptUnavailable
	}
	return receipt, nil
}

func (s *GenerationReceiptService) Lookup(ctx context.Context, scope GenerationReceiptScope) (model.GenerationReceipt, *GenerationReceiptResult, error) {
	if !validGenerationReceiptScope(scope) {
		return model.GenerationReceipt{}, nil, ErrGenerationReceiptInvalid
	}
	if s == nil || s.repo == nil {
		return model.GenerationReceipt{}, nil, ErrGenerationReceiptUnavailable
	}
	receipt, err := s.repo.Find(ctx, scope.UserID, scope.WorkspaceID, scope.Kind, scope.Key)
	if errors.Is(err, repository.ErrGenerationReceiptNotFound) {
		return model.GenerationReceipt{}, nil, ErrGenerationReceiptNotFound
	}
	if err != nil {
		return model.GenerationReceipt{}, nil, ErrGenerationReceiptUnavailable
	}
	if receipt.State == model.GenerationReceiptStateNotSubmitted {
		return receipt, nil, nil
	}
	if !s.ready {
		return receipt, nil, ErrGenerationReceiptUnavailable
	}
	if receipt.State == model.GenerationReceiptStateExpired {
		return receipt, nil, nil
	}
	now := s.clock()
	if !receipt.ExpiresAt.After(now) {
		updated, _, err := s.repo.Transition(ctx, receipt, allUnexpiredReceiptStates(), model.GenerationReceiptStateExpired, "", nil)
		if err != nil {
			return receipt, nil, ErrGenerationReceiptUnavailable
		}
		return updated, nil, nil
	}
	if receipt.State == model.GenerationReceiptStateRunning && !receipt.Deadline.After(now) {
		updated, _, err := s.repo.Transition(ctx, receipt, []string{model.GenerationReceiptStateRunning}, model.GenerationReceiptStateUncertain, GenerationReceiptUncertainMessage, nil)
		if err != nil {
			return receipt, nil, ErrGenerationReceiptUnavailable
		}
		receipt = updated
	}
	result, envelope, err := s.readOutcome(ctx, receipt)
	if errors.Is(err, os.ErrNotExist) {
		if receipt.State == model.GenerationReceiptStateSucceeded {
			// Missing storage for a known result is an outage/loss, not permission
			// to re-submit the paid operation under this key.
			return receipt, nil, ErrGenerationReceiptUnavailable
		}
		return receipt, nil, nil
	}
	if err != nil {
		return receipt, nil, ErrGenerationReceiptUnavailable
	}
	if !envelope.ExpiresAt.After(now) {
		updated, _, err := s.repo.Transition(ctx, receipt, allUnexpiredReceiptStates(), model.GenerationReceiptStateExpired, "", &envelope.ExpiresAt)
		if err != nil {
			return receipt, nil, ErrGenerationReceiptUnavailable
		}
		return updated, nil, nil
	}
	updated, _, err := s.repo.Transition(ctx, receipt, []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateUncertain, model.GenerationReceiptStateFailed}, model.GenerationReceiptStateSucceeded, "", &envelope.ExpiresAt)
	if err != nil {
		// Durable encrypted output remains recoverable on the next lookup.
		return receipt, nil, ErrGenerationReceiptUnavailable
	}
	if updated.State == model.GenerationReceiptStateExpired {
		return updated, nil, nil
	}
	if updated.State != model.GenerationReceiptStateSucceeded {
		return updated, nil, ErrGenerationReceiptUnavailable
	}
	return updated, result, nil
}

func allUnexpiredReceiptStates() []string {
	return []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateUncertain, model.GenerationReceiptStateFailed, model.GenerationReceiptStateSucceeded}
}

type generationReceiptEnvelope struct {
	Version        int       `json:"version"`
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	WorkspaceID    string    `json:"workspace_id"`
	Kind           string    `json:"kind"`
	RequestHash    string    `json:"request_hash"`
	ExecutionToken string    `json:"execution_token"`
	ContentType    string    `json:"content_type"`
	BodySize       int       `json:"body_size"`
	ExpiresAt      time.Time `json:"expires_at"`
}

func generationReceiptBodyLimit(kind string) int {
	if kind == model.GenerationReceiptKindAudio {
		return GenerationReceiptMaxAudioBytes
	}
	return GenerationReceiptMaxTextBytes
}

func validGenerationReceiptResult(kind string, result GenerationReceiptResult) bool {
	if len(result.Body) == 0 || len(result.Body) > generationReceiptBodyLimit(kind) || len(result.ContentType) > 256 {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(result.ContentType)
	if err != nil {
		return false
	}
	if kind == model.GenerationReceiptKindText {
		return mediaType == "application/json" && json.Valid(result.Body)
	}
	return strings.HasPrefix(mediaType, "audio/") || mediaType == "application/octet-stream"
}

func (s *GenerationReceiptService) storageKey(receipt model.GenerationReceipt) (string, error) {
	if !validGenerationReceiptScope(generationReceiptScope(receipt)) || !generationReceiptIDPattern.MatchString(receipt.ID) || !generationReceiptHashPattern.MatchString(receipt.RequestHash) || !generationReceiptHashPattern.MatchString(receipt.ExecutionToken) {
		return "", ErrGenerationReceiptInvalid
	}
	return AssetStorageKey(receipt.WorkspaceID, "receipt_"+receipt.ID, ".enc"), nil
}

func (s *GenerationReceiptService) readOutcome(ctx context.Context, receipt model.GenerationReceipt) (*GenerationReceiptResult, generationReceiptEnvelope, error) {
	var envelope generationReceiptEnvelope
	key, err := s.storageKey(receipt)
	if err != nil {
		return nil, envelope, err
	}
	reader, meta, err := s.storage.Get(ctx, key)
	if err != nil {
		return nil, envelope, err
	}
	defer reader.Close()
	maxBytes := int64(base64.StdEncoding.EncodedLen(generationReceiptBodyLimit(receipt.Kind) + generationReceiptHeaderLimit + generationReceiptCipherOverhead))
	if meta.Size > maxBytes {
		return nil, envelope, ErrGenerationReceiptInvalid
	}
	encrypted, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil || int64(len(encrypted)) > maxBytes {
		return nil, envelope, ErrGenerationReceiptUnavailable
	}
	plain, err := s.box.Decrypt(string(encrypted))
	if err != nil {
		return nil, envelope, ErrGenerationReceiptUnavailable
	}
	separator := strings.IndexByte(plain, '\n')
	if separator < 1 || separator > generationReceiptHeaderLimit || json.Unmarshal([]byte(plain[:separator]), &envelope) != nil {
		return nil, envelope, ErrGenerationReceiptInvalid
	}
	if envelope.Version != generationReceiptEnvelopeV1 || envelope.ID != receipt.ID || envelope.RequestHash != receipt.RequestHash || envelope.ExecutionToken != receipt.ExecutionToken || envelope.UserID != receipt.UserID || envelope.WorkspaceID != receipt.WorkspaceID || envelope.Kind != receipt.Kind || envelope.ExpiresAt.IsZero() {
		return nil, envelope, ErrGenerationReceiptInvalid
	}
	result := &GenerationReceiptResult{ContentType: envelope.ContentType, Body: []byte(plain[separator+1:])}
	if envelope.BodySize != len(result.Body) || !validGenerationReceiptResult(receipt.Kind, *result) {
		return nil, envelope, ErrGenerationReceiptInvalid
	}
	return result, envelope, nil
}

func (s *GenerationReceiptService) Complete(ctx context.Context, binding model.GenerationReceipt, result GenerationReceiptResult) error {
	if s == nil || !s.ready {
		return ErrGenerationReceiptUnavailable
	}
	if !validGenerationReceiptResult(binding.Kind, result) {
		return ErrGenerationReceiptInvalid
	}
	receipt, err := s.repo.Find(ctx, binding.UserID, binding.WorkspaceID, binding.Kind, binding.Key)
	if err != nil {
		return ErrGenerationReceiptUnavailable
	}
	if !sameReceiptBinding(receipt, binding) || receipt.State == model.GenerationReceiptStateNotSubmitted || receipt.State == model.GenerationReceiptStateExpired || !receipt.ExpiresAt.After(s.clock()) {
		return ErrGenerationReceiptConflict
	}
	key, err := s.storageKey(receipt)
	if err != nil {
		return err
	}
	existing, envelope, err := s.readOutcome(ctx, receipt)
	if errors.Is(err, os.ErrNotExist) {
		if receipt.State != model.GenerationReceiptStateRunning && receipt.State != model.GenerationReceiptStateUncertain {
			return ErrGenerationReceiptConflict
		}
		envelope = generationReceiptEnvelope{Version: generationReceiptEnvelopeV1, ID: receipt.ID, UserID: receipt.UserID, WorkspaceID: receipt.WorkspaceID, Kind: receipt.Kind, RequestHash: receipt.RequestHash, ExecutionToken: receipt.ExecutionToken, ContentType: result.ContentType, BodySize: len(result.Body), ExpiresAt: s.clock().Add(GenerationReceiptRetention)}
		header, err := json.Marshal(envelope)
		if err != nil || len(header) > generationReceiptHeaderLimit {
			return ErrGenerationReceiptInvalid
		}
		encrypted, err := s.box.Encrypt(string(header) + "\n" + string(result.Body))
		if err != nil {
			return ErrGenerationReceiptUnavailable
		}
		_, putErr := s.storage.Put(ctx, key, strings.NewReader(encrypted), storage.PutMeta{ContentType: "application/octet-stream", Size: int64(len(encrypted))})
		if putErr != nil {
			// A lost storage response can follow a successful write. Read the same
			// immutable object; never overwrite it or fall back to generation.
			existing, envelope, err = s.readOutcome(ctx, receipt)
			if err != nil {
				return ErrGenerationReceiptUnavailable
			}
		} else {
			existing = &result
		}
	} else if err != nil {
		return ErrGenerationReceiptUnavailable
	}
	if existing == nil || existing.ContentType != result.ContentType || !bytes.Equal(existing.Body, result.Body) {
		return ErrGenerationReceiptConflict
	}
	updated, _, err := s.repo.Transition(ctx, receipt, []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateUncertain, model.GenerationReceiptStateFailed}, model.GenerationReceiptStateSucceeded, "", &envelope.ExpiresAt)
	if err != nil {
		return ErrGenerationReceiptUnavailable
	}
	if updated.State != model.GenerationReceiptStateSucceeded {
		return ErrGenerationReceiptConflict
	}
	return nil
}

func (s *GenerationReceiptService) Fail(ctx context.Context, receipt model.GenerationReceipt, publicMessage string, uncertain bool) error {
	if s == nil || !s.ready {
		return ErrGenerationReceiptUnavailable
	}
	// Upstream errors may embed arbitrary request bodies or credentials. Only a
	// fixed public status is retained, even if a caller accidentally passes one.
	_ = publicMessage
	state, message := model.GenerationReceiptStateFailed, GenerationReceiptFailureMessage
	if uncertain {
		state, message = model.GenerationReceiptStateUncertain, GenerationReceiptUncertainMessage
	}
	_, _, err := s.repo.Transition(ctx, receipt, []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateUncertain}, state, message, nil)
	if errors.Is(err, repository.ErrGenerationReceiptConflict) {
		return ErrGenerationReceiptConflict
	}
	if err != nil {
		return ErrGenerationReceiptUnavailable
	}
	return nil
}
