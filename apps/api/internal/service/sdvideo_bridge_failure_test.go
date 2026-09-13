package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/storage"
)

type interruptedVideoStorage struct {
	storage.Storage
	puts atomic.Int32
}

func (s *interruptedVideoStorage) Put(ctx context.Context, key string, reader io.Reader, meta storage.PutMeta) (storage.StorageObject, error) {
	if s.puts.Add(1) == 1 {
		return storage.StorageObject{}, errors.New("simulated object store outage")
	}
	return s.Storage.Put(ctx, key, reader, meta)
}

func TestSDVideoBridgeStorageCompensationAndCancellation(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		name := "two_bridges_recover_one_asset"
		if cancel {
			name = "cancel_blocks_late_import"
		}
		t.Run(name, func(t *testing.T) {
			_, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/cancel") {
					_, _ = io.WriteString(w, `{"success":true,"data":{"status":"canceled"}}`)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/result") {
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = io.WriteString(w, "test-video")
					return
				}
				_, _ = io.WriteString(w, `{"success":true,"data":{"task_id":"sdv_fault","status":"succeeded","progress":100,"result":{"file_name":"output.mp4"}}}`)
			}))
			defer server.Close()
			client := sdvideo.NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private)})
			users := repository.NewMemoryUserRepository()
			if _, err := users.CreateUser(model.User{ID: "owner", Username: "owner", Role: model.UserRoleMember}); err != nil {
				t.Fatal(err)
			}
			repo := repository.NewMemoryJobRepository()
			jobs := NewJobService(repo, nil, "", 1)
			created, err := jobs.CreateExternal(ExternalJobInput{UserID: "owner", Scope: "personal", Type: model.JobTypeVideoGenerate, ExternalProvider: "sd-video", ExternalTaskID: "sdv_fault", Payload: model.JSONB(`{}`), IdempotencyKey: "fault"})
			if err != nil {
				t.Fatal(err)
			}
			store := &interruptedVideoStorage{Storage: storage.NewLocalFSStorage(t.TempDir())}
			assets := NewAssetService(repository.NewMemoryAssetRepository(), store)
			bridge := NewSDVideoBridge(jobs, users, client, assets, 0, 5)
			if _, err := bridge.RunOnce(context.Background()); err != nil {
				t.Fatal(err)
			}
			pending, _ := jobs.GetForUser(created.Job.ID, "owner")
			if pending.Status == "failed" || pending.Status == "succeeded" || pending.BridgeAttempts != 1 {
				t.Fatalf("sync failure lost task: %+v", pending)
			}
			if cancel {
				if _, err := jobs.CancelForUser(created.Job.ID, "owner"); err != nil {
					t.Fatal(err)
				}
			}
			if err := repo.DelayBridge(created.Job.ID, time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			var workers sync.WaitGroup
			for i := 0; i < 2; i++ {
				workers.Add(1)
				go func() {
					defer workers.Done()
					if _, err := bridge.RunOnce(context.Background()); err != nil {
						t.Error(err)
					}
				}()
			}
			workers.Wait()
			result, _ := jobs.GetForUser(created.Job.ID, "owner")
			items, _ := assets.List("owner", "personal")
			if cancel {
				if result.Status != "canceled" || len(items) != 0 || store.puts.Load() != 1 {
					t.Fatalf("canceled task imported: %+v, assets=%d", result, len(items))
				}
			} else {
				if result.Status != "succeeded" || len(items) != 1 || store.puts.Load() != 2 {
					t.Fatalf("duplicate or missing import: %+v, assets=%d", result, len(items))
				}
				content, err := assets.OpenContent(context.Background(), items[0].ID, "owner", "personal")
				if err != nil {
					t.Fatal(err)
				}
				_ = content.Reader.Close()
			}
		})
	}
}
