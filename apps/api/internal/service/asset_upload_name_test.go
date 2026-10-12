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
		{"a1", "OIP-C.webp", "f1", "OIP-C.webp"},
		{"a2", "OIP-C.webp", "f1", "OIP-C (2).webp"},
		{"a3", "oip-c.WEBP", "f1", "oip-c (3).WEBP"},
		{"a4", "OIP-C.webp", "f2", "OIP-C.webp"},
		{"a5", "OIP-C (2).webp", "f1", "OIP-C (2) (2).webp"},
		{"a6", "分镜草图", "f1", "分镜草图"},
		{"a7", "分镜草图", "f1", "分镜草图 (2)"},
		{"a8", "v1.2 final", "f1", "v1.2 final"},
		{"a9", "v1.2 final", "f1", "v1.2 final (2)"},
	}
	for _, tc := range cases {
		if got := uploadNamed(t, svc, tc.id, tc.name, tc.folder, model.AssetSourceManualUpload).Name; got != tc.want {
			t.Fatalf("%s: name = %q, want %q", tc.id, got, tc.want)
		}
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
	if got := uploadNamed(t, svc, "a2", "cat.png", "f1", model.AssetSourceManualUpload).Name; got != "cat.png" {
		t.Fatalf("name = %q, trashed assets must not reserve names", got)
	}
}

func TestNonManualUploadKeepsRequestedName(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	uploadNamed(t, svc, "a1", "镜头 1", "f1", model.AssetSourceCanvas)
	if got := uploadNamed(t, svc, "a2", "镜头 1", "f1", model.AssetSourceCanvas).Name; got != "镜头 1" {
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
	if retried.ID != first.ID || retried.Name != "cat.png" {
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
	want := []string{"cat (2).png", "cat (3).png", "cat (4).png", "cat (5).png", "cat (6).png", "cat (7).png", "cat (8).png", "cat.png"}
	if strings.Join(names, "|") != strings.Join(want, "|") {
		t.Fatalf("names = %v, want %v", names, want)
	}
}
