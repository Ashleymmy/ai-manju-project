package repository

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
)

var ErrNotFound = errors.New("project not found")

type ProjectRepository interface {
	List() ([]model.Project, error)
	ListByOwner(ownerID string) ([]model.Project, error)
	ListByWorkspace(workspaceID string) ([]model.Project, error)
	Get(id string) (model.Project, error)
	GetByOwner(id string, ownerID string) (model.Project, error)
	GetByWorkspace(id string, workspaceID string) (model.Project, error)
	Create(project model.Project) (model.Project, error)
	Update(project model.Project) (model.Project, error)
	UpdateByOwner(project model.Project, ownerID string) (model.Project, error)
	UpdateByWorkspace(project model.Project, workspaceID string) (model.Project, error)
	Delete(id string) error
	DeleteByOwner(id string, ownerID string) error
	DeleteByWorkspace(id string, workspaceID string) error
	GetSnapshot(projectID string) (model.CanvasSnapshot, error)
	GetSnapshotByOwner(projectID string, ownerID string) (model.CanvasSnapshot, error)
	GetSnapshotByWorkspace(projectID string, workspaceID string) (model.CanvasSnapshot, error)
	UpsertSnapshot(snapshot model.CanvasSnapshot) (model.CanvasSnapshot, error)
	UpsertSnapshotByOwner(snapshot model.CanvasSnapshot, ownerID string) (model.CanvasSnapshot, error)
	UpsertSnapshotByWorkspace(snapshot model.CanvasSnapshot, workspaceID string) (model.CanvasSnapshot, error)
}

type MemoryProjectRepository struct {
	mu        sync.RWMutex
	projects  map[string]model.Project
	snapshots map[string]model.CanvasSnapshot
}

func NewMemoryProjectRepository() *MemoryProjectRepository {
	return &MemoryProjectRepository{
		projects:  make(map[string]model.Project),
		snapshots: make(map[string]model.CanvasSnapshot),
	}
}

func (r *MemoryProjectRepository) List() ([]model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	projects := make([]model.Project, 0, len(r.projects))
	for _, project := range r.projects {
		projects = append(projects, project)
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})

	return projects, nil
}

func (r *MemoryProjectRepository) ListByOwner(ownerID string) ([]model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	projects := make([]model.Project, 0)
	for _, project := range r.projects {
		if project.OwnerID == ownerID {
			projects = append(projects, project)
		}
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})

	return projects, nil
}

func (r *MemoryProjectRepository) ListByWorkspace(workspaceID string) ([]model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	projects := make([]model.Project, 0)
	for _, project := range r.projects {
		if project.WorkspaceID == workspaceID || (project.WorkspaceID == "" && workspaceID == "default:"+project.OwnerID) {
			projects = append(projects, project)
		}
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})

	return projects, nil
}

func (r *MemoryProjectRepository) Get(id string) (model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	project, ok := r.projects[id]
	if !ok {
		return model.Project{}, ErrNotFound
	}

	return project, nil
}

func (r *MemoryProjectRepository) GetByOwner(id string, ownerID string) (model.Project, error) {
	project, err := r.Get(id)
	if err != nil {
		return model.Project{}, err
	}
	if project.OwnerID != ownerID {
		return model.Project{}, ErrNotFound
	}

	return project, nil
}

func (r *MemoryProjectRepository) GetByWorkspace(id string, workspaceID string) (model.Project, error) {
	project, err := r.Get(id)
	if err != nil {
		return model.Project{}, err
	}
	if project.WorkspaceID != workspaceID && !(project.WorkspaceID == "" && workspaceID == "default:"+project.OwnerID) {
		return model.Project{}, ErrNotFound
	}

	return project, nil
}

func (r *MemoryProjectRepository) Create(project model.Project) (model.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	r.projects[project.ID] = project

	return project, nil
}

func (r *MemoryProjectRepository) Update(project model.Project) (model.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current, ok := r.projects[project.ID]
	if !ok {
		return model.Project{}, ErrNotFound
	}

	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	r.projects[project.ID] = project

	return project, nil
}

func (r *MemoryProjectRepository) UpdateByOwner(project model.Project, ownerID string) (model.Project, error) {
	if _, err := r.GetByOwner(project.ID, ownerID); err != nil {
		return model.Project{}, err
	}
	project.OwnerID = ownerID

	return r.Update(project)
}

func (r *MemoryProjectRepository) UpdateByWorkspace(project model.Project, workspaceID string) (model.Project, error) {
	current, err := r.GetByWorkspace(project.ID, workspaceID)
	if err != nil {
		return model.Project{}, err
	}
	project.OwnerID = current.OwnerID
	project.WorkspaceID = workspaceID

	return r.Update(project)
}

func (r *MemoryProjectRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.projects[id]; !ok {
		return ErrNotFound
	}

	delete(r.projects, id)
	delete(r.snapshots, id)

	return nil
}

func (r *MemoryProjectRepository) DeleteByOwner(id string, ownerID string) error {
	if _, err := r.GetByOwner(id, ownerID); err != nil {
		return err
	}

	return r.Delete(id)
}

func (r *MemoryProjectRepository) DeleteByWorkspace(id string, workspaceID string) error {
	if _, err := r.GetByWorkspace(id, workspaceID); err != nil {
		return err
	}

	return r.Delete(id)
}

func (r *MemoryProjectRepository) GetSnapshot(projectID string) (model.CanvasSnapshot, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.projects[projectID]; !ok {
		return model.CanvasSnapshot{}, ErrNotFound
	}

	snapshot, ok := r.snapshots[projectID]
	if !ok {
		return model.CanvasSnapshot{
			ProjectID: projectID,
			Version:   0,
			Data:      model.JSONB("{}"),
		}, nil
	}

	return snapshot, nil
}

func (r *MemoryProjectRepository) GetSnapshotByOwner(projectID string, ownerID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByOwner(projectID, ownerID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.GetSnapshot(projectID)
}

func (r *MemoryProjectRepository) GetSnapshotByWorkspace(projectID string, workspaceID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByWorkspace(projectID, workspaceID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.GetSnapshot(projectID)
}

func (r *MemoryProjectRepository) UpsertSnapshot(snapshot model.CanvasSnapshot) (model.CanvasSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.projects[snapshot.ProjectID]; !ok {
		return model.CanvasSnapshot{}, ErrNotFound
	}

	current, ok := r.snapshots[snapshot.ProjectID]
	now := time.Now().UTC()
	if ok {
		snapshot.CreatedAt = current.CreatedAt
		snapshot.Version = current.Version + 1
	} else {
		snapshot.CreatedAt = now
		snapshot.Version = 1
	}
	snapshot.UpdatedAt = now
	r.snapshots[snapshot.ProjectID] = snapshot

	project := r.projects[snapshot.ProjectID]
	project.Data = snapshot.Data
	project.UpdatedAt = now
	r.projects[snapshot.ProjectID] = project

	return snapshot, nil
}

func (r *MemoryProjectRepository) UpsertSnapshotByOwner(snapshot model.CanvasSnapshot, ownerID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByOwner(snapshot.ProjectID, ownerID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.UpsertSnapshot(snapshot)
}

func (r *MemoryProjectRepository) UpsertSnapshotByWorkspace(snapshot model.CanvasSnapshot, workspaceID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByWorkspace(snapshot.ProjectID, workspaceID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.UpsertSnapshot(snapshot)
}
