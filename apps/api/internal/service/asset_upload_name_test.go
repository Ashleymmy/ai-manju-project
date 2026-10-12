package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func uploadNamed(t *testing.T, svc *AssetService, id string, name string, folderID string, sourceType string) model.Asset {
	t.Helper()
	asset, err := svc.Upload(context.Background(), AssetUploadInput{
		ID: id, UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: name, Extension: ".png",
		ContentType: "image/png", Reader: strings.NewReader(id),
		Registration: AssetRegistrationContext{FolderID: folderID, SourceType: sourceType},
	})
	if err != nil {
		t.Fatal(err)
	}
	return asset
}

func TestManualUploadSuffixesDuplicateNamesWithinFolder(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	cases := []struct{ id, name, folder, want string }{
		{"a1", "OIP-C.webp", "f1", "OIP-C"},
		{"a2", "OIP-C.webp", "f1", "OIP-C (2)"},
		{"a3", "oip-c.PNG", "f1", "oip-c (3)"},
		{"a4", "OIP-C.webp", "f2", "OIP-C"},
		{"a5", "OIP-C (2).webp", "f1", "OIP-C (2) (2)"},
		{"a6", "分镜草图", "f1", "分镜草图"},
		{"a7", "分镜草图", "f1", "分镜草图 (2)"},
		{"a8", "v1.2 final", "f1", "v1.2 final"},
		{"a9", "v1.2 final", "f1", "v1.2 final (2)"},
		{"a10", "镜头1.2", "f1", "镜头1.2"},
		{"a11", "镜头1.2", "f1", "镜头1.2 (2)"},
		{"a12", "clip.MP4", "f1", "clip"},
		{"a13", ".png", "f1", ".png"},
	}
	for _, tc := range cases {
		if got := uploadNamed(t, svc, tc.id, tc.name, tc.folder, model.AssetSourceManualUpload).Name; got != tc.want {
			t.Fatalf("%s: name = %q, want %q", tc.id, got, tc.want)
		}
	}
}

func TestManualUploadTreatsLegacyExtensionNamesAsTaken(t *testing.T) {
	repo := repository.NewMemoryAssetRepository()
	svc := NewAssetService(repo, storage.NewLocalFSStorage(t.TempDir()))
	if _, err := repo.Create(model.Asset{ID: "legacy", WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, "user_a"), UserID: "user_a", Type: "image", Name: "download.webp", FolderID: "f1", SourceType: model.AssetSourceManualUpload}); err != nil {
		t.Fatal(err)
	}
	if got := uploadNamed(t, svc, "a1", "download.webp", "f1", model.AssetSourceManualUpload).Name; got != "download (2)" {
		t.Fatalf("name = %q, an older \"download.webp\" must reserve \"download\"", got)
	}
}

func TestManualUploadReusesNameFreedByTrash(t *testing.T) {
	repo := repository.NewMemoryAssetRepository()
	svc := NewAssetService(repo, storage.NewLocalFSStorage(t.TempDir()))
	first := uploadNamed(t, svc, "a1", "cat.png", "f1", model.AssetSourceManualUpload)
	now := time.Now().UTC()
	if _, err := repo.TrashByWorkspace([]string{first.ID}, first.WorkspaceID, "user_a", now, now.Add(model.AssetTrashRetention)); err != nil {
		t.Fatal(err)
	}
	if got := uploadNamed(t, svc, "a2", "cat.png", "f1", model.AssetSourceManualUpload).Name; got != "cat" {
		t.Fatalf("name = %q, trashed assets must not reserve names", got)
	}
}

func TestNonManualUploadKeepsRequestedName(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	uploadNamed(t, svc, "a1", "镜头 1.png", "f1", model.AssetSourceCanvas)
	if got := uploadNamed(t, svc, "a2", "镜头 1.png", "f1", model.AssetSourceCanvas).Name; got != "镜头 1.png" {
		t.Fatalf("canvas asset name = %q, canvas titles own their names", got)
	}
}

func TestIdempotentManualUploadKeepsOriginalName(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	input := AssetUploadInput{
		UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: "cat.png", Extension: ".png",
		ContentType: "image/png", Reader: strings.NewReader("cat"), IdempotencyKey: "asset-package:s1:cat",
		Registration: AssetRegistrationContext{FolderID: "f1", SourceType: model.AssetSourceManualUpload},
	}
	first, err := svc.Upload(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	input.Reader = strings.NewReader("cat")
	retried, err := svc.Upload(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Name != "cat" || retried.ID != first.ID || retried.Name != "cat" {
		t.Fatalf("retry = %+v, must return the original asset unchanged", retried)
	}
}

func TestConcurrentManualUploadsGetDistinctNames(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	const uploads = 8
	names := make([]string, uploads)
	errs := make([]error, uploads)
	var wg sync.WaitGroup
	for index := 0; index < uploads; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			id := fmt.Sprintf("a%d", index)
			asset, err := svc.Upload(context.Background(), AssetUploadInput{
				ID: id, UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: "cat.png", Extension: ".png",
				ContentType: "image/png", Reader: strings.NewReader(id),
				Registration: AssetRegistrationContext{FolderID: "f1", SourceType: model.AssetSourceManualUpload},
			})
			names[index], errs[index] = asset.Name, err
		}(index)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	sort.Strings(names)
	want := []string{"cat", "cat (2)", "cat (3)", "cat (4)", "cat (5)", "cat (6)", "cat (7)", "cat (8)"}
	if strings.Join(names, "|") != strings.Join(want, "|") {
		t.Fatalf("names = %v, want %v", names, want)
	}
}
