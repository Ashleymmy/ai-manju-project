package service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/storage"
)

func TestJobInputServiceStagesReferenceAndCleansPayload(t *testing.T) {
	root := t.TempDir()
	svc := NewJobInputService(storage.NewLocalFSStorage(root), 1024)
	inputs, err := svc.Stage(context.Background(), "default:user_123", []JobInputUpload{{
		FieldName:   "image",
		FileName:    "input.png",
		ContentType: "image/png",
		Reader:      bytes.NewReader([]byte("small-image")),
	}})
	if err != nil {
		t.Fatalf("Stage() error = %v", err)
	}
	if len(inputs) != 1 || inputs[0].Size != int64(len("small-image")) || inputs[0].SHA256 == "" {
		t.Fatalf("staged inputs = %#v", inputs)
	}
	if !strings.HasPrefix(inputs[0].StorageKey, "jobs/inputs/personal/user_123/") {
		t.Fatalf("storage key = %q", inputs[0].StorageKey)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(inputs[0].StorageKey))); err != nil {
		t.Fatalf("staged file stat: %v", err)
	}

	payload := model.JSONB(`{"staged_input_keys":["` + inputs[0].StorageKey + `"]}`)
	if err := svc.CleanupPayload(context.Background(), "default:user_123", payload); err != nil {
		t.Fatalf("CleanupPayload() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(inputs[0].StorageKey))); !os.IsNotExist(err) {
		t.Fatalf("staged file still exists, stat error = %v", err)
	}
}

func TestJobInputServiceRejectsOversizeAndCrossWorkspaceCleanup(t *testing.T) {
	root := t.TempDir()
	svc := NewJobInputService(storage.NewLocalFSStorage(root), 4)
	_, err := svc.Stage(context.Background(), "default:user_123", []JobInputUpload{{
		FileName: "large.bin",
		Reader:   bytes.NewReader([]byte("12345")),
	}})
	if !errors.Is(err, ErrJobInputTooLarge) {
		t.Fatalf("Stage() error = %v, want ErrJobInputTooLarge", err)
	}
	var stagedFiles []string
	if walkErr := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !info.IsDir() {
			stagedFiles = append(stagedFiles, path)
		}
		return nil
	}); walkErr != nil {
		t.Fatal(walkErr)
	}
	if len(stagedFiles) != 0 {
		t.Fatalf("failed staging leaked files: %v", stagedFiles)
	}

	err = svc.Cleanup(context.Background(), "default:user_123", []string{"jobs/inputs/personal/user_999/batch/file.bin"})
	if err == nil || !strings.Contains(err.Error(), "refusing to delete") {
		t.Fatalf("cross-workspace Cleanup() error = %v", err)
	}
}

func TestJobInputWorkspacePrefix(t *testing.T) {
	tests := map[string]string{
		"default:user_123": "personal/user_123",
		"team:default":     "team/default",
	}
	for workspaceID, want := range tests {
		got, err := JobInputWorkspacePrefix(workspaceID)
		if err != nil || got != want {
			t.Fatalf("JobInputWorkspacePrefix(%q) = %q, %v; want %q", workspaceID, got, err, want)
		}
	}
	if _, err := JobInputWorkspacePrefix("unknown"); err == nil {
		t.Fatal("unsupported workspace must fail")
	}
}
