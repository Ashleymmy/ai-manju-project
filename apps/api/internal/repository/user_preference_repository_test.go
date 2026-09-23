package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func verifyPreferenceModify(t *testing.T, repo UserPreferenceRepository, user string) {
	t.Helper()
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			_, err := repo.Modify(user, func(current model.UserPreference) (model.UserPreference, error) {
				values := map[string]any{}
				if len(current.Canvas) > 0 {
					_ = json.Unmarshal(current.Canvas, &values)
				}
				values[fmt.Sprint(index)] = index
				current.Canvas, _ = json.Marshal(values)
				return current, nil
			})
			if err != nil {
				t.Error(err)
			}
		}(i)
	}
	workers.Wait()
	saved, err := repo.GetByUser(user)
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]any
	_ = json.Unmarshal(saved.Canvas, &values)
	if len(values) != 8 {
		t.Fatalf("lost concurrent saves: %s", saved.Canvas)
	}
	_, err = repo.Modify(user, func(current model.UserPreference) (model.UserPreference, error) {
		current.Canvas = model.JSONB(`{}`)
		return current, errors.New("rejected")
	})
	if err == nil {
		t.Fatal("expected rejection")
	}
	again, _ := repo.GetByUser(user)
	if string(again.Canvas) != string(saved.Canvas) {
		t.Fatal("rejected change was persisted")
	}
}

func TestMemoryPreferenceModify(t *testing.T) {
	verifyPreferenceModify(t, NewMemoryUserPreferenceRepository(), "user")
}

func TestGormPreferenceModify(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for PostgreSQL integration")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	user := fmt.Sprintf("preference-qa-%d", time.Now().UnixNano())
	t.Cleanup(func() { db.Where("user_id = ?", user).Delete(&model.UserPreference{}) })
	verifyPreferenceModify(t, NewGormUserPreferenceRepository(db), user)
}
