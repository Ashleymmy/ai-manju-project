package repository

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestMemoryComicBatchConcurrentCreationKeepsOneBatchAndItsItems(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project, asset := seedMemoryComicProject(t, repo, "concurrent_creation")
	const callers = 12
	ids := make(chan string, callers)
	var group sync.WaitGroup
	for i := 0; i < callers; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			batch := model.ComicAssetGenerationBatch{ID: fmt.Sprintf("batch_%d", i), ProjectID: project.ID, UserID: project.OwnerID,
				WorkspaceID: project.WorkspaceID, IdempotencyKey: "shared-request", RequestFingerprint: "same-request", Status: model.ComicBatchStatusQueued}
			item := model.ComicAssetGenerationItem{ID: fmt.Sprintf("item_%d", i), BatchID: batch.ID, ComicAssetID: asset.ID, Attempt: 1, Status: model.ComicBatchItemStatusPending}
			created, items, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{item})
			if err != nil || len(items) != 1 || items[0].BatchID != created.ID {
				t.Errorf("concurrent create=%+v items=%+v err=%v", created, items, err)
				return
			}
			ids <- created.ID
		}(i)
	}
	group.Wait()
	close(ids)
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatalf("same request created different batches: %q %q", first, id)
		}
	}
	if len(repo.batches) != 1 || len(repo.items) != 1 {
		t.Fatalf("partial/duplicate batch persisted: batches=%d items=%d", len(repo.batches), len(repo.items))
	}
	batch, items, err := repo.GetBatchInternal(first)
	if err != nil {
		t.Fatal(err)
	}
	verifyComicBatchReplayScope(t, repo, batch, items)
}

func verifyComicBatchReplayScope(t *testing.T, repo ComicAssetRepository, batch model.ComicAssetGenerationBatch, items []model.ComicAssetGenerationItem) {
	t.Helper()
	for _, dimension := range []string{"user", "workspace", "project", "fingerprint"} {
		changed := batch
		changed.ID += "_changed_" + dimension
		switch dimension {
		case "user":
			changed.UserID += "_other"
		case "workspace":
			changed.WorkspaceID += "_other"
		case "project":
			changed.ProjectID += "_other"
		case "fingerprint":
			changed.RequestFingerprint += "_other"
		}
		changedItems := append([]model.ComicAssetGenerationItem(nil), items...)
		for i := range changedItems {
			changedItems[i].ID += "_changed_" + dimension
			changedItems[i].BatchID = changed.ID
		}
		if _, _, err := repo.CreateBatch(changed, changedItems); !errors.Is(err, ErrComicAssetConflict) {
			t.Fatalf("same key replay crossed %s boundary: %v", dimension, err)
		}
	}
}
