package service

import (
	"context"
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestComicBatchSubmissionRecoveryDoesNotResolveOrDispatchAgain(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 1)
	input := CreateComicBatchInput{Concurrency: 1, IdempotencyKey: "response-lost"}
	created, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, input)
	if err != nil {
		t.Fatal(err)
	}
	// Recovery still works if the provider has since become unavailable.
	fx.service.resolver = nil
	for attempt := 0; attempt < 2; attempt++ {
		recovered, err := fx.service.GetBatchBySubmissionKey(project.ID, fx.userID, WorkspaceScopePersonal, input.IdempotencyKey)
		if err != nil || recovered.Batch.ID != created.Batch.ID || len(recovered.Items) != 1 || recovered.Items[0].ID != created.Items[0].ID {
			t.Fatalf("recovery=%+v err=%v", recovered, err)
		}
	}
	if len(fx.producer.Messages) != 0 {
		t.Fatal("submission lookup dispatched a generation")
	}
	batches, err := fx.comic.ListBatches(project.ID, WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID))
	if err != nil || len(batches) != 1 {
		t.Fatalf("lookup created an extra batch: count=%d err=%v", len(batches), err)
	}
}

func TestComicBatchSubmissionRecoveryIsStrictlyScoped(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 1)
	_, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{Concurrency: 1, IdempotencyKey: "owned-key"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ project, key, user, scope string }{
		{project.ID, "owned-key", "other-user", WorkspaceScopePersonal},
		{project.ID, "owned-key", fx.userID, WorkspaceScopeTeam},
		{"other-project", "owned-key", fx.userID, WorkspaceScopePersonal},
		{project.ID, "missing-key", fx.userID, WorkspaceScopePersonal},
		{project.ID, "", fx.userID, WorkspaceScopePersonal},
	} {
		if _, err := fx.service.GetBatchBySubmissionKey(test.project, test.user, test.scope, test.key); !errors.Is(err, repository.ErrComicAssetBatchNotFound) {
			t.Fatalf("unexpected recovery across scope %+v: %v", test, err)
		}
	}
	// Team projects may be shared, but a submission key belongs to its actor.
	team := model.ComicAssetProject{ID: "shared-project", OwnerID: fx.userID, WorkspaceID: WorkspaceIDForScope(WorkspaceScopeTeam, fx.userID), Title: "team"}
	if _, err := fx.comic.CreateProject(team); err != nil {
		t.Fatal(err)
	}
	batch := model.ComicAssetGenerationBatch{ID: "team-batch", ProjectID: team.ID, UserID: fx.userID, WorkspaceID: team.WorkspaceID,
		IdempotencyKey: comicBatchIdempotencyKey(fx.userID, team.WorkspaceID, "team-key"), Status: model.ComicBatchStatusQueued}
	if _, _, err := fx.comic.CreateBatch(batch, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.GetBatchBySubmissionKey(team.ID, fx.userID, WorkspaceScopeTeam, "team-key"); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.GetBatchBySubmissionKey(team.ID, "other-user", WorkspaceScopeTeam, "team-key"); !errors.Is(err, repository.ErrComicAssetBatchNotFound) {
		t.Fatalf("team submission leaked: %v", err)
	}
}

func TestComicRetryWhileAlreadyQueuedDoesNotAdvanceAttemptAgain(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 1)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{Concurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	detail, err = fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	item := detail.Items[0]
	if err := fx.comic.SyncItemFromJob(item.ID, item.JobID, model.JobStatusFailed, "", model.JSONB(`{"message":"synthetic failure"}`)); err != nil {
		t.Fatal(err)
	}
	retried, err := fx.service.RetryBatchItems(detail.Batch.ID, []string{item.ID}, fx.userID, WorkspaceScopePersonal)
	if err != nil || retried.Items[0].Attempt != 2 {
		t.Fatalf("retry=%+v err=%v", retried, err)
	}
	if _, err := fx.service.RetryBatchItems(detail.Batch.ID, []string{item.ID}, fx.userID, WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAssetInvalidState) {
		t.Fatalf("duplicate active retry error=%v", err)
	}
	loaded, err := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil || loaded.Items[0].Attempt != 2 {
		t.Fatalf("duplicate retry advanced attempt: %+v %v", loaded, err)
	}
}
