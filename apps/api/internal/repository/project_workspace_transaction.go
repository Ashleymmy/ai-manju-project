package repository

import (
	"errors"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

func (r *MemoryProjectRepository) WithWorkspaceTransaction(_ string, folders AssetFolderRepository, fn func(ProjectRepository, AssetFolderRepository) error) error {
	// Always acquire projects before folders. Work on private copies so failures
	// cannot expose a half-created canvas or a partially renamed folder tree.
	r.mu.Lock()
	defer r.mu.Unlock()
	var folderStore *MemoryAssetFolderRepository
	var folderTx AssetFolderRepository
	if folders != nil {
		var ok bool
		folderStore, ok = folders.(*MemoryAssetFolderRepository)
		if !ok {
			return errors.New("memory project transaction requires memory asset folders")
		}
		folderStore.mu.Lock()
		defer folderStore.mu.Unlock()
		copy := NewMemoryAssetFolderRepository()
		for id, folder := range folderStore.folders {
			copy.folders[id] = cloneAssetFolder(folder)
		}
		folderTx = copy
	}
	projectTx := NewMemoryProjectRepository()
	for id, project := range r.projects {
		project.Data = append(model.JSONB(nil), project.Data...)
		projectTx.projects[id] = project
	}
	for id, snapshot := range r.snapshots {
		snapshot.Data = append(model.JSONB(nil), snapshot.Data...)
		projectTx.snapshots[id] = snapshot
	}
	if err := fn(projectTx, folderTx); err != nil {
		return err
	}
	r.projects, r.snapshots = projectTx.projects, projectTx.snapshots
	if folderStore != nil {
		folderStore.folders = folderTx.(*MemoryAssetFolderRepository).folders
	}
	return nil
}

func (r *GormProjectRepository) WithWorkspaceTransaction(workspaceID string, folders AssetFolderRepository, fn func(ProjectRepository, AssetFolderRepository) error) error {
	if folders != nil {
		if _, ok := folders.(*GormAssetFolderRepository); !ok {
			return errors.New("gorm project transaction requires gorm asset folders")
		}
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// A transaction-scoped workspace lock also coordinates separate API replicas.
		// The namespace keeps this lock separate from unrelated advisory locks.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "canvas-projects:"+workspaceID).Error; err != nil {
			return err
		}
		var folderTx AssetFolderRepository
		if folders != nil {
			folderTx = NewGormAssetFolderRepository(tx)
		}
		return fn(NewGormProjectRepository(tx), folderTx)
	})
}
