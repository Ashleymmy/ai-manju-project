package repository

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func forGenerationReceiptRepositories(t *testing.T, run func(*testing.T, GenerationReceiptRepository)) {
	t.Helper()
	t.Run("Memory", func(t *testing.T) { run(t, NewMemoryGenerationReceiptRepository()) })
	t.Run("Postgres", func(t *testing.T) {
		dsn := os.Getenv("GENERATION_RECEIPT_TEST_DATABASE_URL")
		if dsn == "" {
			dsn = os.Getenv("JOB_DISPATCH_TEST_DATABASE_URL")
		}
		if dsn == "" {
			t.Skip("isolated PostgreSQL test connection not configured")
		}
		root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("test PostgreSQL connection unavailable")
		}
		schema := fmt.Sprintf("receipt_test_%d", time.Now().UnixNano())
		if root.Exec("CREATE SCHEMA "+schema).Error != nil {
			t.Fatal("cannot create isolated receipt test schema")
		}
		t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); _ = db.Close() })
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal("invalid test PostgreSQL URL")
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("isolated test PostgreSQL connection unavailable")
		}
		t.Cleanup(func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() })
		if err := db.AutoMigrate(&model.GenerationReceipt{}); err != nil {
			t.Fatal("receipt schema migration failed")
		}
		run(t, NewGormGenerationReceiptRepository(db))
	})
}

func generationReceiptRepositoryFixture() model.GenerationReceipt {
	return model.GenerationReceipt{ID: "receipt", UserID: "user", WorkspaceID: "default:user", Kind: model.GenerationReceiptKindText, Key: "key", RequestHash: "hash", ExecutionToken: "token", State: model.GenerationReceiptStateRunning, Deadline: time.Now().Add(time.Hour), ExpiresAt: time.Now().Add(7 * 24 * time.Hour)}
}

func TestGenerationReceiptRepositoryAtomicBeginAndPermanentReservation(t *testing.T) {
	forGenerationReceiptRepositories(t, func(t *testing.T, repo GenerationReceiptRepository) {
		var claimed atomic.Int32
		var wait sync.WaitGroup
		for index := range 24 {
			wait.Add(1)
			go func(index int) {
				defer wait.Done()
				candidate := generationReceiptRepositoryFixture()
				candidate.ID, candidate.ExecutionToken = fmt.Sprintf("receipt_%d", index), fmt.Sprintf("token_%d", index)
				row, created, err := repo.Begin(context.Background(), candidate)
				if err != nil || row.Key != candidate.Key {
					t.Error("concurrent reservation failed")
				}
				if created {
					claimed.Add(1)
				}
			}(index)
		}
		wait.Wait()
		if claimed.Load() != 1 {
			t.Fatalf("claimed=%d want=1", claimed.Load())
		}
		row, err := repo.Find(context.Background(), "user", "default:user", model.GenerationReceiptKindText, "key")
		if err != nil {
			t.Fatal(err)
		}
		for _, state := range []string{model.GenerationReceiptStateUncertain, model.GenerationReceiptStateFailed, model.GenerationReceiptStateExpired} {
			updated, changed, err := repo.Transition(context.Background(), row, []string{row.State}, state, "public status", nil)
			if err != nil || !changed {
				t.Fatal("state transition failed")
			}
			row = updated
			candidate := generationReceiptRepositoryFixture()
			candidate.ID = "new-id"
			found, created, err := repo.Begin(context.Background(), candidate)
			if err != nil || created || found.ID != row.ID || found.ExecutionToken != row.ExecutionToken || found.State != state {
				t.Fatal("duplicate reclaimed terminal or uncertain receipt")
			}
		}
	})
}

func TestGenerationReceiptRepositoryOwnerScopeAndTokenCAS(t *testing.T) {
	forGenerationReceiptRepositories(t, func(t *testing.T, repo GenerationReceiptRepository) {
		binding, _, err := repo.Begin(context.Background(), generationReceiptRepositoryFixture())
		if err != nil {
			t.Fatal(err)
		}
		for _, alter := range []func(*model.GenerationReceipt){
			func(row *model.GenerationReceipt) { row.ExecutionToken = "wrong" },
			func(row *model.GenerationReceipt) { row.ID = "wrong" },
			func(row *model.GenerationReceipt) { row.RequestHash = "wrong" },
		} {
			wrong := binding
			alter(&wrong)
			_, changed, err := repo.Transition(context.Background(), wrong, []string{model.GenerationReceiptStateRunning}, model.GenerationReceiptStateSucceeded, "", nil)
			if changed || !errors.Is(err, ErrGenerationReceiptConflict) {
				t.Fatal("mismatched execution modified receipt")
			}
		}
		for _, scope := range [][4]string{{"other", binding.WorkspaceID, binding.Kind, binding.Key}, {binding.UserID, "other", binding.Kind, binding.Key}, {binding.UserID, binding.WorkspaceID, model.GenerationReceiptKindAudio, binding.Key}, {binding.UserID, binding.WorkspaceID, binding.Kind, "other"}} {
			if _, err := repo.Find(context.Background(), scope[0], scope[1], scope[2], scope[3]); !errors.Is(err, ErrGenerationReceiptNotFound) {
				t.Fatal("receipt lookup crossed owner/workspace/kind/key")
			}
		}
		expires := time.Now().UTC().Add(6 * time.Hour)
		row, changed, err := repo.Transition(context.Background(), binding, []string{model.GenerationReceiptStateRunning}, model.GenerationReceiptStateSucceeded, "", &expires)
		if err != nil || !changed || row.ExpiresAt.Sub(expires).Abs() > time.Microsecond {
			t.Fatal("valid finalization failed")
		}
		row, changed, err = repo.Transition(context.Background(), binding, []string{model.GenerationReceiptStateRunning}, model.GenerationReceiptStateFailed, "late failure", nil)
		if err != nil || changed || row.State != model.GenerationReceiptStateSucceeded {
			t.Fatal("late failure overwrote success")
		}
	})
}
