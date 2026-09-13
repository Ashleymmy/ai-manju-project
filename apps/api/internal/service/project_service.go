package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

var ErrTitleRequired = errors.New("title is required")

// DefaultCanvasTitle is the creation placeholder; the server appends a free
// positive number within the canvas's workspace before persisting it.
const DefaultCanvasTitle = "未命名画布"

type ProjectService struct {
	repo       repository.ProjectRepository
	references repository.AssetReferenceRepository
	folders    *AssetFolderService
	assetUsage interface {
		RecordReference(workspaceID string, userID string, referenceType string, referenceID string, assetIDs []string) error
	}
}

func (s *ProjectService) SetAssetFolderService(folders *AssetFolderService) {
	s.folders = folders
}

func (s *ProjectService) withWorkspaceTransaction(workspaceID string, fn func(repository.ProjectRepository, *AssetFolderService) error) error {
	var folders repository.AssetFolderRepository
	if s.folders != nil {
		folders = s.folders.folders
	}
	return s.repo.WithWorkspaceTransaction(workspaceID, folders, func(projects repository.ProjectRepository, folderRepo repository.AssetFolderRepository) error {
		var folderService *AssetFolderService
		if s.folders != nil {
			copy := *s.folders
			copy.folders = folderRepo
			folderService = &copy
		}
		return fn(projects, folderService)
	})
}

func (s *ProjectService) SetAssetReferenceRepository(references repository.AssetReferenceRepository) {
	s.references = references
}

func (s *ProjectService) SetAssetUsageRecorder(recorder interface {
	RecordReference(workspaceID string, userID string, referenceType string, referenceID string, assetIDs []string) error
}) {
	s.assetUsage = recorder
}

func NewProjectService(repo repository.ProjectRepository) *ProjectService {
	return &ProjectService{repo: repo}
}

type CreateProjectInput struct {
	Title string
	Data  *model.JSONB
}

type UpdateProjectInput struct {
	Title *string
	Data  *model.JSONB
	// CoverAssetID 指针语义：nil 不动封面，指向空字符串表示清除封面恢复默认。
	CoverAssetID *string
}

func (s *ProjectService) List(userID string, scope string) ([]model.Project, error) {
	return s.repo.ListByWorkspace(WorkspaceIDForScope(scope, userID))
}

func (s *ProjectService) Get(id string, userID string, scope string) (model.Project, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if s.folders == nil {
		return s.repo.GetByWorkspace(id, workspaceID)
	}
	var project model.Project
	err := s.withWorkspaceTransaction(workspaceID, func(repo repository.ProjectRepository, folders *AssetFolderService) error {
		var err error
		project, err = repo.GetByWorkspace(id, workspaceID)
		if err != nil {
			return err
		}
		// Older canvases predate linked folders. Opening one provisions the same
		// stable tree as creation, without renaming the canvas or changing its data.
		folderProject := project
		folderProject.WorkspaceID = workspaceID
		return folders.ensureCanvasProjectFolders(folderProject)
	})
	return project, err
}

func (s *ProjectService) Create(userID string, scope string, input CreateProjectInput) (model.Project, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return model.Project{}, ErrTitleRequired
	}

	workspaceID := WorkspaceIDForScope(scope, userID)
	var project model.Project
	err := s.withWorkspaceTransaction(workspaceID, func(repo repository.ProjectRepository, folders *AssetFolderService) error {
		if title == DefaultCanvasTitle {
			var err error
			title, err = nextDefaultCanvasTitle(repo, folders, workspaceID)
			if err != nil {
				return err
			}
		}
		var err error
		project, err = repo.Create(model.Project{
			ID:          "proj_" + randomHex(8),
			Title:       title,
			OwnerID:     userID,
			WorkspaceID: workspaceID,
			Data:        NormalizeJSON(input.Data),
		})
		if err != nil {
			return err
		}

		// 创建请求携带画布数据时立即写入版本化快照，确保 Memory 与 GORM
		// 在后续 GET project/snapshot 时都能恢复同一份初始画布。
		if input.Data != nil {
			snapshot, snapshotErr := repo.UpsertSnapshotByWorkspace(model.CanvasSnapshot{
				ProjectID: project.ID,
				Data:      project.Data,
			}, project.WorkspaceID)
			if snapshotErr != nil {
				return snapshotErr
			}
			project.Data = snapshot.Data
		}
		if folders != nil {
			return folders.ensureCanvasProjectFolders(project)
		}
		return nil
	})
	if err != nil {
		return model.Project{}, err
	}

	if err := s.replaceCanvasAssetReferences(project.WorkspaceID, userID, project.ID, project.Data); err != nil {
		return project, err
	}
	return project, nil
}

func (s *ProjectService) Update(id string, userID string, scope string, input UpdateProjectInput) (model.Project, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	var updated model.Project
	err := s.withWorkspaceTransaction(workspaceID, func(repo repository.ProjectRepository, folders *AssetFolderService) error {
		current, err := repo.GetByWorkspace(id, workspaceID)
		if err != nil {
			return err
		}

		if input.Title != nil {
			title := strings.TrimSpace(*input.Title)
			if title == "" {
				return ErrTitleRequired
			}
			current.Title = title
		}
		if input.Data != nil {
			current.Data = NormalizeJSON(input.Data)
		}
		if input.CoverAssetID != nil {
			current.CoverAssetID = strings.TrimSpace(*input.CoverAssetID)
		}

		updated, err = repo.UpdateByWorkspace(current, workspaceID)
		if err != nil {
			return err
		}
		if folders != nil && input.Title != nil {
			return folders.ensureCanvasProjectFolders(updated)
		}
		return nil
	})
	if err != nil {
		return model.Project{}, err
	}
	if err == nil && input.Data != nil {
		err = s.replaceCanvasAssetReferences(workspaceID, userID, updated.ID, updated.Data)
	}
	return updated, err
}

func nextDefaultCanvasTitle(repo repository.ProjectRepository, folders *AssetFolderService, workspaceID string) (string, error) {
	projects, err := repo.ListByWorkspace(workspaceID)
	if err != nil {
		return "", err
	}
	used := make(map[string]bool, len(projects))
	for _, project := range projects {
		used[project.Title] = true
	}
	if folders != nil {
		items, err := folders.folders.ListByWorkspace(workspaceID)
		if err != nil {
			return "", err
		}
		for _, folder := range items {
			// Deleted canvases may still have archived assets. Reserve those names too.
			if folder.SystemKey == model.AssetFolderSystemKeyCanvasProject {
				used[folder.Name] = true
			}
		}
	}
	for number := 1; ; number++ {
		title := DefaultCanvasTitle + strconv.Itoa(number)
		if !used[title] {
			return title, nil
		}
	}
}

func (s *ProjectService) Delete(id string, userID string, scope string) error {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if err := s.repo.DeleteByWorkspace(id, workspaceID); err != nil {
		return err
	}
	if s.references != nil {
		return s.references.DeleteForSource(workspaceID, model.AssetReferenceTypeCanvasProject, id)
	}
	return nil
}

func (s *ProjectService) GetSnapshot(projectID string, userID string, scope string) (model.CanvasSnapshot, error) {
	return s.repo.GetSnapshotByWorkspace(projectID, WorkspaceIDForScope(scope, userID))
}

func (s *ProjectService) UpdateSnapshot(projectID string, userID string, scope string, data *model.JSONB) (model.CanvasSnapshot, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	snapshot, err := s.repo.UpsertSnapshotByWorkspace(model.CanvasSnapshot{
		ProjectID: projectID,
		Data:      NormalizeJSON(data),
	}, workspaceID)
	if err == nil {
		err = s.replaceCanvasAssetReferences(workspaceID, userID, projectID, snapshot.Data)
	}
	return snapshot, err
}

var (
	serverAssetStorageKeyPattern = regexp.MustCompile(`server:(?:(?:personal|team):)?(?:image|video|audio):([A-Za-z0-9_-]+)`)
	serverAssetContentURLPattern = regexp.MustCompile(`/api/assets/([A-Za-z0-9_-]+)/content(?:[?#]|$)`)
)

func (s *ProjectService) replaceCanvasAssetReferences(workspaceID string, userID string, projectID string, data model.JSONB) error {
	if s.references == nil {
		return nil
	}
	assetIDs := canvasAssetIDs(data)
	if err := s.references.ReplaceForSource(workspaceID, model.AssetReferenceTypeCanvasProject, projectID, assetIDs); err != nil {
		return err
	}
	if s.assetUsage != nil {
		return s.assetUsage.RecordReference(workspaceID, userID, model.AssetReferenceTypeCanvasProject, projectID, assetIDs)
	}
	return nil
}

func canvasAssetIDs(data model.JSONB) []string {
	var value any
	if len(data) == 0 || json.Unmarshal(data, &value) != nil {
		return nil
	}
	seen := make(map[string]bool)
	var walk func(any, string)
	walk = func(current any, key string) {
		switch typed := current.(type) {
		case map[string]any:
			for childKey, child := range typed {
				walk(child, childKey)
			}
		case []any:
			for _, child := range typed {
				walk(child, key)
			}
		case string:
			text := strings.TrimSpace(typed)
			for _, match := range serverAssetStorageKeyPattern.FindAllStringSubmatch(text, -1) {
				seen[match[1]] = true
			}
			for _, match := range serverAssetContentURLPattern.FindAllStringSubmatch(text, -1) {
				seen[match[1]] = true
			}
			normalizedKey := strings.ToLower(strings.ReplaceAll(key, "_", ""))
			if (normalizedKey == "assetid" || normalizedKey == "outputassetid") && strings.HasPrefix(text, "asset_") {
				seen[text] = true
			}
		}
	}
	walk(value, "")
	result := make([]string, 0, len(seen))
	for id := range seen {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func NormalizeJSON(data *model.JSONB) model.JSONB {
	if data == nil || len(*data) == 0 {
		return model.JSONB("{}")
	}
	return *data
}

func randomHex(bytesCount int) string {
	bytes := make([]byte, bytesCount)
	if _, err := rand.Read(bytes); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(bytes)
}
