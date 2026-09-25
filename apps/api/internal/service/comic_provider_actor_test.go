package service

import (
	"context"
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestComicImageDispatchRetainsActorAndRechecksAccess(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		fx := newComicServiceFixture()
		var actors []string
		allowed := true
		fx.service.SetImageJobResolver(func(userID, requested, jobType string) (ComicImageJobResolution, error) {
			actors = append(actors, userID)
			if userID != fx.userID || !allowed {
				return ComicImageJobResolution{}, repository.ErrModelProviderAccessDenied
			}
			return ComicImageJobResolution{Selector: "private::image-v1", Model: "image-v1", TaskKwargs: map[string]any{"provider": map[string]any{"model": "image-v1"}}}, nil
		})
		project, _ := createApprovedComicAssets(t, fx, 1)
		batch, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{ModelSelector: "private::image-v1", Concurrency: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(actors) != 1 || actors[0] != fx.userID {
			t.Fatalf("creation actor lost: %v", actors)
		}
		allowed = !revoked
		if err := fx.service.DispatchOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(actors) != 2 || actors[1] != fx.userID {
			t.Fatalf("dispatch actor lost: %v", actors)
		}
		if revoked {
			if len(fx.producer.Messages) != 0 {
				t.Fatal("revoked actor enqueued a paid generation")
			}
			_, items, err := fx.comic.GetBatchInternal(batch.Batch.ID)
			if err != nil || len(items) != 1 || items[0].Status != model.ComicBatchItemStatusFailed {
				t.Fatalf("revoked batch did not fail safely: %v", err)
			}
			continue
		}
		if len(fx.producer.Messages) != 1 {
			t.Fatal("authorized actor did not enqueue one generation")
		}
		_, err = fx.service.CreateBatch(project.ID, "another-user", WorkspaceScopePersonal, CreateComicBatchInput{})
		if !errors.Is(err, repository.ErrComicAssetProjectNotFound) {
			t.Fatalf("cross-workspace protection changed: %v", err)
		}
	}
}
