package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

// Shared across service instances to exercise process-restart recovery without
// returning any signed URL or registering generated content as a public asset.
type receiptMemoryStorage struct {
	mu             sync.Mutex
	objects        map[string][]byte
	getErr, putErr error
	putReplyLost   bool
	puts           int
}

func newReceiptMemoryStorage() *receiptMemoryStorage {
	return &receiptMemoryStorage{objects: make(map[string][]byte)}
}
func (s *receiptMemoryStorage) Put(_ context.Context, key string, reader io.Reader, meta storage.PutMeta) (storage.StorageObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.puts++
	if s.putErr != nil {
		return storage.StorageObject{}, s.putErr
	}
	if _, exists := s.objects[key]; exists {
		return storage.StorageObject{}, os.ErrExist
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		return storage.StorageObject{}, err
	}
	s.objects[key] = body
	if s.putReplyLost {
		return storage.StorageObject{}, errors.New("storage reply lost")
	}
	return storage.StorageObject{Key: key, Size: int64(len(body)), ContentType: meta.ContentType}, nil
}
func (s *receiptMemoryStorage) Get(_ context.Context, key string) (io.ReadCloser, storage.StorageObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getErr != nil {
		return nil, storage.StorageObject{}, s.getErr
	}
	body, exists := s.objects[key]
	if !exists {
		return nil, storage.StorageObject{}, os.ErrNotExist
	}
	copy := bytes.Clone(body)
	return io.NopCloser(bytes.NewReader(copy)), storage.StorageObject{Key: key, Size: int64(len(copy)), ContentType: "application/octet-stream"}, nil
}
func (s *receiptMemoryStorage) Delete(context.Context, string) error {
	panic("receipts must never delete storage")
}
func (s *receiptMemoryStorage) URL(context.Context, string) (string, error) {
	panic("receipts must never expose storage URLs")
}
func (s *receiptMemoryStorage) Stat(ctx context.Context, key string) (storage.StorageObject, error) {
	reader, meta, err := s.Get(ctx, key)
	if err == nil {
		_ = reader.Close()
	}
	return meta, err
}

func receiptScope(kind string) GenerationReceiptScope {
	return GenerationReceiptScope{UserID: "user", WorkspaceID: "default:user", Kind: kind, Key: "client-key"}
}

func receiptHash(t *testing.T) string {
	t.Helper()
	hash, err := GenerationReceiptRequestHash(map[string]any{"prompt": "private source prompt", "model": "original-model"})
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func receiptService(repo repository.GenerationReceiptRepository, store storage.Storage) *GenerationReceiptService {
	return NewGenerationReceiptService(repo, store, provider.NewSecretBox("isolated-receipt-test"))
}

func TestGenerationReceiptHashIsCanonicalAndExact(t *testing.T) {
	first, err := GenerationReceiptRequestHash(json.RawMessage(`{"b":[1.00,{"x":1000}],"a":"value"}`))
	second, err2 := GenerationReceiptRequestHash(json.RawMessage(`{ "a": "value", "b": [1e0, {"x": 1e3}] }`))
	if err != nil || err2 != nil || first != second || len(first) != 64 {
		t.Fatal("equivalent JSON did not produce a canonical fingerprint")
	}
	left, _ := GenerationReceiptRequestHash(json.RawMessage(`{"n":9007199254740992}`))
	right, _ := GenerationReceiptRequestHash(json.RawMessage(`{"n":9007199254740993}`))
	if left == right {
		t.Fatal("fingerprinting lost integer precision")
	}
	if _, err := GenerationReceiptRequestHash(make(chan int)); !errors.Is(err, ErrGenerationReceiptInvalid) {
		t.Fatal("non-JSON request accepted")
	}
}

func TestGenerationReceiptConcurrentBeginNeverReclaimsOriginalExecution(t *testing.T) {
	repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
	svc := receiptService(repo, store)
	scope, hash := receiptScope(model.GenerationReceiptKindText), receiptHash(t)
	var claims atomic.Int32
	var wait sync.WaitGroup
	for range 32 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			row, claimed, err := svc.Begin(context.Background(), scope, hash)
			if err != nil || row.State != model.GenerationReceiptStateRunning {
				t.Error("concurrent begin failed")
			}
			if claimed {
				claims.Add(1)
			}
		}()
	}
	wait.Wait()
	if claims.Load() != 1 {
		t.Fatalf("provider execution permits=%d want=1", claims.Load())
	}
	changed, _ := GenerationReceiptRequestHash(map[string]any{"prompt": "changed"})
	if _, claimed, err := svc.Begin(context.Background(), scope, changed); claimed || !errors.Is(err, ErrGenerationReceiptConflict) {
		t.Fatal("key reused for a changed request")
	}
	row, _, err := svc.Lookup(context.Background(), scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Fail(context.Background(), row, "private-key-should-not-escape https://private/?token=secret", true); err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{model.GenerationReceiptStateUncertain, model.GenerationReceiptStateFailed} {
		if state == model.GenerationReceiptStateFailed {
			_ = svc.Fail(context.Background(), row, "private", false)
		}
		found, claimed, err := svc.Begin(context.Background(), scope, hash)
		if err != nil || claimed || found.ID != row.ID || found.ExecutionToken != row.ExecutionToken || found.State != state {
			t.Fatal("existing outcome was reclaimed for a new Provider call")
		}
		if strings.Contains(found.Error, "private") || strings.Contains(found.Error, "secret") || found.Error == "" {
			t.Fatal("public error retained upstream private material")
		}
	}
}

func TestGenerationReceiptEncryptedResultsSurviveRestartAndDoNotExposeBindings(t *testing.T) {
	for _, kind := range []string{model.GenerationReceiptKindText, model.GenerationReceiptKindAudio} {
		t.Run(kind, func(t *testing.T) {
			repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
			svc := receiptService(repo, store)
			scope := receiptScope(kind)
			row, claimed, err := svc.Begin(context.Background(), scope, receiptHash(t))
			if err != nil || !claimed {
				t.Fatal("initial claim failed")
			}
			result := GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{"content":"private generated text"}`)}
			if kind == model.GenerationReceiptKindAudio {
				result = GenerationReceiptResult{ContentType: "audio/mpeg", Body: []byte{0, 1, 255, 34, 128, 10}}
			}
			if err := svc.Complete(context.Background(), row, result); err != nil {
				t.Fatal(err)
			}
			if err := svc.Complete(context.Background(), row, result); err != nil || store.puts != 1 {
				t.Fatal("duplicate completion overwrote original storage")
			}
			// No Provider configuration is needed to serve the existing receipt.
			restarted := receiptService(repo, store)
			stored, recovered, err := restarted.Lookup(context.Background(), scope)
			if err != nil || stored.State != model.GenerationReceiptStateSucceeded || recovered == nil || recovered.ContentType != result.ContentType || !bytes.Equal(recovered.Body, result.Body) {
				t.Fatal("restart did not recover exact original response")
			}
			encoded, _ := json.Marshal(stored)
			for _, secret := range []string{stored.ExecutionToken, stored.RequestHash, scope.Key, "private source prompt", "receipt_"} {
				if bytes.Contains(encoded, []byte(secret)) {
					t.Fatal("private receipt binding escaped public JSON")
				}
			}
			for key, encrypted := range store.objects {
				if strings.Contains(key, scope.Key) || bytes.Contains(encrypted, result.Body) || bytes.Contains(encrypted, []byte(row.ExecutionToken)) {
					t.Fatal("result/binding was stored in plaintext")
				}
			}
			for _, wrongScope := range []GenerationReceiptScope{{"other", scope.WorkspaceID, kind, scope.Key}, {scope.UserID, "default:other", kind, scope.Key}} {
				if _, _, err := restarted.Lookup(context.Background(), wrongScope); !errors.Is(err, ErrGenerationReceiptNotFound) {
					t.Fatal("lookup crossed owner/workspace boundary")
				}
			}
		})
	}
}

type receiptFinalizeFailureRepository struct {
	repository.GenerationReceiptRepository
	fail bool
}

func (r *receiptFinalizeFailureRepository) Transition(ctx context.Context, binding model.GenerationReceipt, from []string, state, message string, expires *time.Time) (model.GenerationReceipt, bool, error) {
	if r.fail && state == model.GenerationReceiptStateSucceeded {
		return model.GenerationReceipt{}, false, errors.New("database finalization unavailable")
	}
	return r.GenerationReceiptRepository.Transition(ctx, binding, from, state, message, expires)
}

func TestGenerationReceiptRecoversDurableObjectAfterDatabaseFinalizeFailure(t *testing.T) {
	repo := &receiptFinalizeFailureRepository{GenerationReceiptRepository: repository.NewMemoryGenerationReceiptRepository(), fail: true}
	store := newReceiptMemoryStorage()
	svc := receiptService(repo, store)
	scope := receiptScope(model.GenerationReceiptKindText)
	row, _, _ := svc.Begin(context.Background(), scope, receiptHash(t))
	result := GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{"content":"saved before database failure"}`)}
	if err := svc.Complete(context.Background(), row, result); !errors.Is(err, ErrGenerationReceiptUnavailable) || len(store.objects) != 1 {
		t.Fatal("test did not retain object before failed finalization")
	}
	_ = svc.Fail(context.Background(), row, "uncertain", true)
	if _, claimed, err := svc.Begin(context.Background(), scope, receiptHash(t)); err != nil || claimed {
		t.Fatal("database outage permitted resubmission")
	}
	repo.fail = false
	recovered, output, err := receiptService(repo, store).Lookup(context.Background(), scope)
	if err != nil || recovered.State != model.GenerationReceiptStateSucceeded || output == nil || !bytes.Equal(output.Body, result.Body) || store.puts != 1 {
		t.Fatal("restart did not finalize the original encrypted object")
	}
}

func TestGenerationReceiptStorageFailuresAreNotMissingOrResubmittable(t *testing.T) {
	for _, failure := range []string{"read_outage", "put_outage", "lost_put_reply", "missing_success", "wrong_secret", "corrupt_object"} {
		t.Run(failure, func(t *testing.T) {
			repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
			svc := receiptService(repo, store)
			scope, hash := receiptScope(model.GenerationReceiptKindText), receiptHash(t)
			row, _, _ := svc.Begin(context.Background(), scope, hash)
			result := GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{"content":"original result"}`)}
			if failure == "read_outage" {
				store.getErr = errors.New("temporary storage outage")
			} else if failure == "put_outage" {
				store.putErr = errors.New("temporary storage outage")
			} else if failure == "lost_put_reply" {
				store.putReplyLost = true
			}
			err := svc.Complete(context.Background(), row, result)
			if failure == "read_outage" || failure == "put_outage" {
				if !errors.Is(err, ErrGenerationReceiptUnavailable) {
					t.Fatal("storage outage was ignored")
				}
			} else if err != nil {
				t.Fatal("storage reply loss could not recover completed write")
			}
			if failure == "missing_success" {
				// Simulated loss only; receipt code never calls Delete.
				store.objects = make(map[string][]byte)
			} else if failure == "wrong_secret" {
				svc = NewGenerationReceiptService(repo, store, provider.NewSecretBox("different-secret"))
			} else if failure == "corrupt_object" {
				for key := range store.objects {
					store.objects[key] = []byte("corrupted")
				}
			}
			if failure != "put_outage" && failure != "lost_put_reply" {
				if _, _, err := svc.Lookup(context.Background(), scope); !errors.Is(err, ErrGenerationReceiptUnavailable) || errors.Is(err, ErrGenerationReceiptNotFound) {
					t.Fatal("existing receipt storage failure became missing")
				}
			}
			if _, claimed, err := svc.Begin(context.Background(), scope, hash); err != nil || claimed {
				t.Fatal("storage outage reclaimed execution permit")
			}
		})
	}
}

func TestGenerationReceiptDeadlineAndLogicalExpiryNeverReplayOrDelete(t *testing.T) {
	repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
	svc := receiptService(repo, store)
	scope, hash := receiptScope(model.GenerationReceiptKindText), receiptHash(t)
	row, _, _ := svc.Begin(context.Background(), scope, hash)
	svc.clock = func() time.Time { return row.Deadline.Add(time.Second) }
	uncertain, result, err := svc.Lookup(context.Background(), scope)
	if err != nil || uncertain.State != model.GenerationReceiptStateUncertain || result != nil {
		t.Fatal("past deadline did not become uncertain")
	}
	if _, claimed, _ := svc.Begin(context.Background(), scope, hash); claimed {
		t.Fatal("timed-out execution was reclaimed")
	}
	if err := svc.Complete(context.Background(), row, GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{"content":"late original result"}`)}); err != nil {
		t.Fatal("late original response could not finish using its execution token")
	}
	completed, _, _ := svc.Lookup(context.Background(), scope)
	svc.clock = func() time.Time { return completed.ExpiresAt.Add(time.Second) }
	expired, result, err := svc.Lookup(context.Background(), scope)
	if err != nil || expired.State != model.GenerationReceiptStateExpired || result != nil || len(store.objects) != 1 {
		t.Fatal("logical expiry exposed or deleted the original result")
	}
	duplicate, claimed, err := svc.Begin(context.Background(), scope, hash)
	if err != nil || claimed || duplicate.State != model.GenerationReceiptStateExpired || duplicate.ID != row.ID {
		t.Fatal("expired key allowed a new generation")
	}
	if err := svc.Complete(context.Background(), row, GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{}`)}); !errors.Is(err, ErrGenerationReceiptConflict) {
		t.Fatal("expired receipt was reopened")
	}
}

func TestGenerationReceiptRejectsWrongTokenAndSwappedEncryptedObjects(t *testing.T) {
	repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
	svc := receiptService(repo, store)
	scope := receiptScope(model.GenerationReceiptKindText)
	row, _, _ := svc.Begin(context.Background(), scope, receiptHash(t))
	result := GenerationReceiptResult{ContentType: "application/json", Body: []byte(`{"content":"bound"}`)}
	wrong := row
	wrong.ExecutionToken = strings.Repeat("a", 64)
	if err := svc.Complete(context.Background(), wrong, result); !errors.Is(err, ErrGenerationReceiptConflict) || len(store.objects) != 0 {
		t.Fatal("wrong execution token wrote output")
	}
	if err := svc.Fail(context.Background(), wrong, "failure", true); !errors.Is(err, ErrGenerationReceiptConflict) {
		t.Fatal("wrong execution token changed outcome")
	}
	if err := svc.Complete(context.Background(), row, result); err != nil {
		t.Fatal(err)
	}
	secondScope := scope
	secondScope.Key = "second-key"
	second, _, _ := svc.Begin(context.Background(), secondScope, receiptHash(t))
	firstKey, _ := svc.storageKey(row)
	secondKey, _ := svc.storageKey(second)
	store.objects[secondKey] = bytes.Clone(store.objects[firstKey])
	if _, _, err := svc.Lookup(context.Background(), secondScope); !errors.Is(err, ErrGenerationReceiptUnavailable) {
		t.Fatal("encrypted output was transferable to a different receipt")
	}
}

func TestGenerationReceiptInvalidInputAndUnavailableConfigurationDoNotClaim(t *testing.T) {
	repo, store := repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()
	svc := receiptService(repo, store)
	for index, scope := range []GenerationReceiptScope{{"", "default:user", "text", "key"}, {"user", "default:../other", "text", "key"}, {"user", "default:..", "text", "key"}, {"user", "workspace", "video", "key"}, {"user", "workspace", "text", strings.Repeat("x", 257)}} {
		if _, claimed, err := svc.Begin(context.Background(), scope, receiptHash(t)); claimed || !errors.Is(err, ErrGenerationReceiptInvalid) {
			t.Fatalf("invalid scope %d was claimed", index)
		}
	}
	for _, broken := range []*GenerationReceiptService{NewGenerationReceiptService(repo, nil, provider.NewSecretBox("secret")), NewGenerationReceiptService(repo, store, provider.NewSecretBox(""))} {
		if _, claimed, err := broken.Begin(context.Background(), receiptScope("text"), receiptHash(t)); claimed || !errors.Is(err, ErrGenerationReceiptUnavailable) {
			t.Fatal("unconfigured durable storage allowed execution")
		}
	}
	if GenerationReceiptMaxTextBytes != 64*1024*1024 || GenerationReceiptMaxAudioBytes != 512*1024*1024 {
		t.Fatal("receipt limits lowered existing Provider response limits")
	}
	for _, result := range []GenerationReceiptResult{{"text/html", []byte("html")}, {"application/json", []byte("invalid JSON")}, {"application/json", nil}} {
		if validGenerationReceiptResult(model.GenerationReceiptKindText, result) {
			t.Fatal(fmt.Sprintf("invalid text outcome accepted (%s)", result.ContentType))
		}
	}
}
