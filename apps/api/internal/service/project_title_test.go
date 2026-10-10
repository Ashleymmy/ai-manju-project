package service

import (
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/repository"
)

func TestLiveCanvasTitlesAreUniquePerWorkspace(t *testing.T) {
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	create := func(user string, scope string, title string, unique bool) (string, error) {
		project, err := svc.Create(user, scope, CreateProjectInput{Title: title, UniqueTitle: unique})
		return project.Title, err
	}
	if title, err := create("user", WorkspaceScopePersonal, "分镜", false); err != nil || title != "分镜" {
		t.Fatalf("first create = %q, %v", title, err)
	}
	if _, err := create("user", WorkspaceScopePersonal, " 分镜 ", false); !errors.Is(err, ErrProjectTitleExists) {
		t.Fatalf("duplicate create error = %v", err)
	}
	for _, want := range []string{"分镜 2", "分镜 3"} {
		if title, err := create("user", WorkspaceScopePersonal, "分镜", true); err != nil || title != want {
			t.Fatalf("numbered create = %q, %v; want %q", title, err, want)
		}
	}
	// Other workspaces keep their own namespace.
	if title, err := create("other", WorkspaceScopePersonal, "分镜", false); err != nil || title != "分镜" {
		t.Fatalf("other workspace create = %q, %v", title, err)
	}

	second, err := svc.Create("user", WorkspaceScopePersonal, CreateProjectInput{Title: "草稿"})
	if err != nil {
		t.Fatal(err)
	}
	taken := "分镜"
	if _, err := svc.Update(second.ID, "user", WorkspaceScopePersonal, UpdateProjectInput{Title: &taken}); !errors.Is(err, ErrProjectTitleExists) {
		t.Fatalf("duplicate rename error = %v", err)
	}
	same := "草稿"
	if _, err := svc.Update(second.ID, "user", WorkspaceScopePersonal, UpdateProjectInput{Title: &same}); err != nil {
		t.Fatalf("unchanged title rejected: %v", err)
	}
	free := "定稿"
	if updated, err := svc.Update(second.ID, "user", WorkspaceScopePersonal, UpdateProjectInput{Title: &free}); err != nil || updated.Title != free {
		t.Fatalf("rename = %+v, %v", updated, err)
	}
}
