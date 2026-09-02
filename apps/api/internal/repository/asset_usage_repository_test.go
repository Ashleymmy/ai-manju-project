package repository

import (
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMemoryAssetUsageRepository(t *testing.T) {
	testAssetUsageRepository(t, NewMemoryAssetUsageRepository())
}

func TestGormAssetUsageRepository(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AssetUsageEvent{}, &model.AssetUsageAggregate{}, &model.AssetUserState{}); err != nil {
		t.Fatal(err)
	}
	testAssetUsageRepository(t, NewGormAssetUsageRepository(db))
}

func testAssetUsageRepository(t *testing.T, repo AssetUsageRepository) {
	t.Helper()
	event := model.AssetUsageEvent{ID: "usage_1", WorkspaceID: "default:user_a", AssetID: "asset_1", UserID: "user_a", EventType: model.AssetUsageGeneration, ContextType: "job", ContextID: "job_1", IdempotencyKey: "generation:job_1:asset_1", OccurredAt: time.Now().UTC()}
	created, err := repo.RecordEvent(event)
	if err != nil || !created {
		t.Fatalf("first event created=%v err=%v", created, err)
	}
	created, err = repo.RecordEvent(event)
	if err != nil || created {
		t.Fatalf("duplicate event created=%v err=%v", created, err)
	}
	state := model.AssetUserState{ID: "state_1", WorkspaceID: event.WorkspaceID, AssetID: event.AssetID, UserID: event.UserID, Reaction: model.AssetReactionFavorite, PrivateNote: "note"}
	if _, err := repo.PutUserState(state); err != nil {
		t.Fatal(err)
	}
	state.Reaction = model.AssetReactionDislike
	if _, err := repo.PutUserState(state); err != nil {
		t.Fatal(err)
	}
	if err := repo.Reconcile(event.WorkspaceID, []string{event.AssetID}); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetStructuralCounts(event.WorkspaceID, event.AssetID, 2, 3); err != nil {
		t.Fatal(err)
	}
	aggregate, err := repo.GetAggregate(event.WorkspaceID, event.AssetID)
	if err != nil {
		t.Fatal(err)
	}
	if aggregate.GenerationUseCount != 1 || aggregate.ActiveReferenceCount != 2 || aggregate.DerivedAssetCount != 3 || aggregate.FavoriteCount != 0 || aggregate.DislikeCount != 1 {
		t.Fatalf("aggregate = %+v", aggregate)
	}
	aggregates, err := repo.GetAggregates(event.WorkspaceID, []string{event.AssetID, "asset_empty"})
	if err != nil || len(aggregates) != 2 || aggregates["asset_empty"].AssetID != "asset_empty" {
		t.Fatalf("batch aggregates = %+v err=%v", aggregates, err)
	}
	states, err := repo.GetUserStates(event.WorkspaceID, []string{event.AssetID, "asset_empty"}, event.UserID)
	if err != nil || states[event.AssetID].Reaction != model.AssetReactionDislike || states["asset_empty"].Reaction != model.AssetReactionNone {
		t.Fatalf("batch states = %+v err=%v", states, err)
	}
	disliked, err := repo.ListAssetIDsByUsage(event.WorkspaceID, event.UserID, model.AssetReactionDislike, 0, false)
	if err != nil || len(disliked) != 1 || disliked[0] != event.AssetID {
		t.Fatalf("disliked ids = %v err=%v", disliked, err)
	}
	frequent, err := repo.ListAssetIDsByUsage(event.WorkspaceID, event.UserID, "", 1, false)
	if err != nil || len(frequent) != 1 || frequent[0] != event.AssetID {
		t.Fatalf("frequent ids = %v err=%v", frequent, err)
	}
}
