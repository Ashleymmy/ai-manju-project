package repository

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestMemoryClonedVoiceRepositoryUpsertAndList(t *testing.T) {
	repo := NewMemoryClonedVoiceRepository()

	meta, err := repo.Upsert(model.ClonedVoiceMeta{
		VoiceID:     "cosyvoice-v3.5-plus-role01-abc123def456",
		Alias:       "旁白小哥",
		OwnerID:     "user-1",
		OwnerName:   "用户一",
		TargetModel: "cosyvoice-v3.5-plus",
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if meta.Alias != "旁白小哥" {
		t.Fatalf("alias = %q", meta.Alias)
	}

	// 二次 Upsert 更新别名但保留创建时间。
	updated, err := repo.Upsert(model.ClonedVoiceMeta{VoiceID: meta.VoiceID, Alias: "新名字"})
	if err != nil {
		t.Fatalf("Upsert again: %v", err)
	}
	if updated.Alias != "新名字" || !updated.CreatedAt.Equal(meta.CreatedAt) {
		t.Fatalf("updated = %+v, want alias updated and CreatedAt preserved", updated)
	}

	found, err := repo.ListByVoiceIDs([]string{meta.VoiceID, "missing"})
	if err != nil {
		t.Fatalf("ListByVoiceIDs: %v", err)
	}
	if len(found) != 1 || found[meta.VoiceID].Alias != "新名字" {
		t.Fatalf("found = %+v", found)
	}
}

func TestMemoryClonedVoiceRepositoryDelete(t *testing.T) {
	repo := NewMemoryClonedVoiceRepository()
	if _, err := repo.Upsert(model.ClonedVoiceMeta{VoiceID: "v1", Alias: "小满"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := repo.DeleteByVoiceID("v1"); err != nil {
		t.Fatalf("DeleteByVoiceID: %v", err)
	}
	found, err := repo.ListByVoiceIDs([]string{"v1"})
	if err != nil || len(found) != 0 {
		t.Fatalf("found = %+v, err = %v", found, err)
	}
	// Deleting a missing id is a no-op.
	if err := repo.DeleteByVoiceID("missing"); err != nil {
		t.Fatalf("DeleteByVoiceID missing: %v", err)
	}
}

func TestMemoryClonedVoiceRepositoryListVisible(t *testing.T) {
	repo := NewMemoryClonedVoiceRepository()
	_, _ = repo.Upsert(model.ClonedVoiceMeta{VoiceID: "v-user1", OwnerID: "user-1", Alias: "甲"})
	_, _ = repo.Upsert(model.ClonedVoiceMeta{VoiceID: "v-user2", OwnerID: "user-2", Alias: "乙"})

	mine, err := repo.ListVisible("user-1", false)
	if err != nil || len(mine) != 1 || mine[0].VoiceID != "v-user1" {
		t.Fatalf("user-1 visible = %+v, err = %v", mine, err)
	}
	all, err := repo.ListVisible("user-1", true)
	if err != nil || len(all) != 2 {
		t.Fatalf("admin visible = %+v, err = %v", all, err)
	}
	none, err := repo.ListVisible("user-3", false)
	if err != nil || len(none) != 0 {
		t.Fatalf("user-3 visible = %+v, err = %v", none, err)
	}
}

func TestMemoryClonedVoiceRepositoryGetAndListByAsset(t *testing.T) {
	repo := NewMemoryClonedVoiceRepository()
	if _, err := repo.Upsert(model.ClonedVoiceMeta{VoiceID: "cvoice-abc", Alias: "小满", OwnerID: "u1", ReferenceAssetID: "asset-1"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	meta, err := repo.Get("cvoice-abc")
	if err != nil || meta.Alias != "小满" || meta.ReferenceAssetID != "asset-1" {
		t.Fatalf("Get = %+v, err = %v", meta, err)
	}
	if _, err := repo.Get("missing"); err == nil {
		t.Fatal("expected Get(missing) to fail")
	}
	byAsset, err := repo.ListByReferenceAssetIDs([]string{"asset-1", "asset-none"})
	if err != nil || len(byAsset) != 1 || byAsset[0].VoiceID != "cvoice-abc" {
		t.Fatalf("ListByReferenceAssetIDs = %+v, err = %v", byAsset, err)
	}
}
