package service

import (
	"context"
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func TestSeedanceAssetProviderAndOwnerIsolation(t *testing.T) {
	svc, repo := newSeedanceAssetTestService(t, "https://unused.invalid", "test-key", nil)
	for _, a := range []model.SeedanceAsset{
		{ID: "own", ProviderID: "seedance", CreatedBy: "alice", VolcanoAssetID: "remote-own", Status: "Active"},
		{ID: "other-provider", ProviderID: "old", CreatedBy: "alice", VolcanoAssetID: "remote-old", Status: "Active"},
		{ID: "other-owner", ProviderID: "seedance", CreatedBy: "bob", VolcanoAssetID: "remote-bob", Status: "Active"},
	} {
		if _, err := repo.UpsertAsset(a); err != nil {
			t.Fatal(err)
		}
	}
	scoped := svc.ForProvider("seedance").ForOwner("alice")
	result, err := scoped.ListAssets(SeedanceAssetListInput{})
	if err != nil || result.Total != 1 || result.Items[0].ID != "own" {
		t.Fatalf("scope: %#v %v", result, err)
	}
	if err := scoped.EnsureAssetsActive(context.Background(), []string{"remote-own"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"remote-old", "remote-bob", "missing"} {
		if err := scoped.EnsureAssetsActive(context.Background(), []string{id}); !errors.Is(err, ErrSeedanceAssetNotActive) {
			t.Fatalf("accepted %s: %v", id, err)
		}
	}
	if _, err := scoped.RefreshAsset(context.Background(), "other-owner"); !errors.Is(err, repository.ErrSeedanceAssetNotFound) {
		t.Fatalf("cross-owner refresh: %v", err)
	}
	if svc.providerID != "" || svc.ownerID != "" {
		t.Fatal("mutated shared service")
	}
	if _, err := svc.ForProvider("missing").loadSeedanceAssetProvider(); !errors.Is(err, ErrSeedanceAssetProviderNotConfigured) {
		t.Fatalf("fell back to default: %v", err)
	}
}

type signedURLStorage struct {
	storage.Storage
	value string
}

func (s signedURLStorage) URL(context.Context, string) (string, error) { return s.value, nil }

func TestSeedanceAssetPublicSignedURLIsNotDoublePrefixed(t *testing.T) {
	const signed = "http://studio.example/storage/v1/object/sign/studio-test-assets/image.png?token=test-only"
	svc := NewSeedanceAssetService(nil, nil, provider.SecretBox{}, signedURLStorage{value: signed}, "http://studio.example")
	got, err := svc.publicURLForStorageObject(context.Background(), storage.StorageObject{Key: "image.png"})
	if err != nil || got != signed {
		t.Fatalf("invalid signed URL: %v", err)
	}
}
