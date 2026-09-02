package repository

import (
	"errors"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GormProjectRepository struct {
	db *gorm.DB
}

func NewGormProjectRepository(db *gorm.DB) *GormProjectRepository {
	return &GormProjectRepository{db: db}
}

func (r *GormProjectRepository) List() ([]model.Project, error) {
	var projects []model.Project
	if err := r.db.Order("updated_at DESC").Find(&projects).Error; err != nil {
		return nil, err
	}

	return r.attachProjectData(projects)
}

func (r *GormProjectRepository) ListByOwner(ownerID string) ([]model.Project, error) {
	var projects []model.Project
	if err := r.db.Where("owner_id = ?", ownerID).Order("updated_at DESC").Find(&projects).Error; err != nil {
		return nil, err
	}

	return r.attachProjectData(projects)
}

func (r *GormProjectRepository) ListByWorkspace(workspaceID string) ([]model.Project, error) {
	var projects []model.Project
	query := r.db.Where("workspace_id = ?", workspaceID)
	if ownerID, ok := legacyPersonalOwnerID(workspaceID); ok {
		query = r.db.Where("workspace_id = ? OR ((workspace_id = '' OR workspace_id IS NULL) AND owner_id = ?)", workspaceID, ownerID)
	}
	if err := query.Order("updated_at DESC").Find(&projects).Error; err != nil {
		return nil, err
	}

	return r.attachProjectData(projects)
}

func (r *GormProjectRepository) Get(id string) (model.Project, error) {
	var project model.Project
	if err := r.db.First(&project, "id = ?", id).Error; err != nil {
		return model.Project{}, mapGormError(err)
	}

	return r.attachSingleProjectData(project)
}

func (r *GormProjectRepository) GetByOwner(id string, ownerID string) (model.Project, error) {
	var project model.Project
	if err := r.db.First(&project, "id = ? AND owner_id = ?", id, ownerID).Error; err != nil {
		return model.Project{}, mapGormError(err)
	}

	return r.attachSingleProjectData(project)
}

func (r *GormProjectRepository) GetByWorkspace(id string, workspaceID string) (model.Project, error) {
	var project model.Project
	query := r.db.Where("id = ? AND workspace_id = ?", id, workspaceID)
	if ownerID, ok := legacyPersonalOwnerID(workspaceID); ok {
		query = r.db.Where("id = ? AND (workspace_id = ? OR ((workspace_id = '' OR workspace_id IS NULL) AND owner_id = ?))", id, workspaceID, ownerID)
	}
	if err := query.First(&project).Error; err != nil {
		return model.Project{}, mapGormError(err)
	}

	return r.attachSingleProjectData(project)
}

func (r *GormProjectRepository) Create(project model.Project) (model.Project, error) {
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	data := project.Data
	if err := r.db.Create(&project).Error; err != nil {
		return model.Project{}, err
	}
	project.Data = data

	return project, nil
}

func (r *GormProjectRepository) Update(project model.Project) (model.Project, error) {
	current, err := r.Get(project.ID)
	if err != nil {
		return model.Project{}, err
	}

	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&project).Error; err != nil {
		return model.Project{}, err
	}

	return project, nil
}

func (r *GormProjectRepository) UpdateByOwner(project model.Project, ownerID string) (model.Project, error) {
	current, err := r.GetByOwner(project.ID, ownerID)
	if err != nil {
		return model.Project{}, err
	}

	project.OwnerID = ownerID
	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&project).Error; err != nil {
		return model.Project{}, err
	}

	return project, nil
}

func (r *GormProjectRepository) UpdateByWorkspace(project model.Project, workspaceID string) (model.Project, error) {
	current, err := r.GetByWorkspace(project.ID, workspaceID)
	if err != nil {
		return model.Project{}, err
	}

	project.OwnerID = current.OwnerID
	project.WorkspaceID = workspaceID
	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&project).Error; err != nil {
		return model.Project{}, err
	}

	return project, nil
}

func (r *GormProjectRepository) Delete(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.CanvasSnapshot{}, "project_id = ?", id).Error; err != nil {
			return err
		}

		result := tx.Delete(&model.Project{}, "id = ?", id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}

		return nil
	})
}

func (r *GormProjectRepository) DeleteByOwner(id string, ownerID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var project model.Project
		if err := tx.First(&project, "id = ? AND owner_id = ?", id, ownerID).Error; err != nil {
			return mapGormError(err)
		}

		if err := tx.Delete(&model.CanvasSnapshot{}, "project_id = ?", id).Error; err != nil {
			return err
		}

		result := tx.Delete(&model.Project{}, "id = ? AND owner_id = ?", id, ownerID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}

		return nil
	})
}

func (r *GormProjectRepository) DeleteByWorkspace(id string, workspaceID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var project model.Project
		if err := tx.First(&project, "id = ? AND workspace_id = ?", id, workspaceID).Error; err != nil {
			return mapGormError(err)
		}

		if err := tx.Delete(&model.CanvasSnapshot{}, "project_id = ?", id).Error; err != nil {
			return err
		}

		result := tx.Delete(&model.Project{}, "id = ? AND workspace_id = ?", id, workspaceID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}

		return nil
	})
}

func (r *GormProjectRepository) GetSnapshot(projectID string) (model.CanvasSnapshot, error) {
	if _, err := r.Get(projectID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	var snapshot model.CanvasSnapshot
	if err := r.db.First(&snapshot, "project_id = ?", projectID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CanvasSnapshot{
				ProjectID: projectID,
				Version:   0,
				Data:      model.JSONB("{}"),
			}, nil
		}

		return model.CanvasSnapshot{}, err
	}

	return snapshot, nil
}

func (r *GormProjectRepository) GetSnapshotByOwner(projectID string, ownerID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByOwner(projectID, ownerID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.getSnapshotForExistingProject(projectID)
}

func (r *GormProjectRepository) GetSnapshotByWorkspace(projectID string, workspaceID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByWorkspace(projectID, workspaceID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.getSnapshotForExistingProject(projectID)
}

func (r *GormProjectRepository) getSnapshotForExistingProject(projectID string) (model.CanvasSnapshot, error) {
	var snapshot model.CanvasSnapshot
	if err := r.db.First(&snapshot, "project_id = ?", projectID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CanvasSnapshot{
				ProjectID: projectID,
				Version:   0,
				Data:      model.JSONB("{}"),
			}, nil
		}

		return model.CanvasSnapshot{}, err
	}

	return snapshot, nil
}

func (r *GormProjectRepository) UpsertSnapshot(snapshot model.CanvasSnapshot) (model.CanvasSnapshot, error) {
	if _, err := r.Get(snapshot.ProjectID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		var current model.CanvasSnapshot
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "project_id = ?", snapshot.ProjectID).Error
		if err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}

			snapshot.Version = 1
			snapshot.CreatedAt = now
			snapshot.UpdatedAt = now
			if err := tx.Create(&snapshot).Error; err != nil {
				return err
			}
		} else {
			snapshot.Version = current.Version + 1
			snapshot.CreatedAt = current.CreatedAt
			snapshot.UpdatedAt = now
			if err := tx.Save(&snapshot).Error; err != nil {
				return err
			}
		}

		return tx.Model(&model.Project{}).
			Where("id = ?", snapshot.ProjectID).
			Updates(map[string]any{
				"updated_at": now,
			}).Error
	})
	if err != nil {
		return model.CanvasSnapshot{}, err
	}

	return snapshot, nil
}

func (r *GormProjectRepository) UpsertSnapshotByOwner(snapshot model.CanvasSnapshot, ownerID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByOwner(snapshot.ProjectID, ownerID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.UpsertSnapshot(snapshot)
}

func (r *GormProjectRepository) UpsertSnapshotByWorkspace(snapshot model.CanvasSnapshot, workspaceID string) (model.CanvasSnapshot, error) {
	if _, err := r.GetByWorkspace(snapshot.ProjectID, workspaceID); err != nil {
		return model.CanvasSnapshot{}, err
	}

	return r.UpsertSnapshot(snapshot)
}

func (r *GormProjectRepository) attachSingleProjectData(project model.Project) (model.Project, error) {
	snapshot, err := r.getSnapshotForExistingProject(project.ID)
	if err != nil {
		return model.Project{}, err
	}
	project.Data = snapshot.Data
	return project, nil
}

func (r *GormProjectRepository) attachProjectData(projects []model.Project) ([]model.Project, error) {
	if len(projects) == 0 {
		return projects, nil
	}

	ids := make([]string, 0, len(projects))
	indexByID := make(map[string]int, len(projects))
	for index, project := range projects {
		ids = append(ids, project.ID)
		indexByID[project.ID] = index
		projects[index].Data = model.JSONB("{}")
	}

	var snapshots []model.CanvasSnapshot
	if err := r.db.Where("project_id IN ?", ids).Find(&snapshots).Error; err != nil {
		return nil, err
	}
	for _, snapshot := range snapshots {
		if index, ok := indexByID[snapshot.ProjectID]; ok {
			projects[index].Data = snapshot.Data
		}
	}

	return projects, nil
}

func mapGormError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}

	return err
}

func legacyPersonalOwnerID(workspaceID string) (string, bool) {
	if len(workspaceID) <= len("default:") || workspaceID[:len("default:")] != "default:" {
		return "", false
	}
	return workspaceID[len("default:"):], true
}
