package assetmigration

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"gorm.io/gorm"
)

// Result is intentionally compact so dry-run output can be reviewed before
// production writes. Asset files and URLs are never part of this migration.
type Result struct {
	DryRun                 bool
	ScannedAssets          int
	Workspaces             int
	FoldersToCreate        int
	WorkspaceBackfills     int
	ComicAssetsToBackfill  int
	JobAssetsToBackfill    int
	LegacyAssetsToBackfill int
	AlreadyManaged         int
	UpdatedAssets          int
	CanvasAssetsToRefile   int
	CanvasAssetsRefiled    int
}

type comicAssociation struct {
	WorkspaceID  string
	UserID       string
	ProjectID    string
	ProjectTitle string
	BatchID      string
	ItemID       string
	JobID        string
	AssetCode    string
	Category     string
	VariantIndex int
	Version      int
}

type jobAssociation struct {
	WorkspaceID string
	UserID      string
	JobID       string
}

type canvasArchiveMove struct {
	AssetID          string
	WorkspaceID      string
	UserID           string
	ProjectID        string
	ProjectTitle     string
	OriginalFolderID string
	CreatedAt        time.Time
}

type migrationPlan struct {
	assets             []model.Asset
	workspaceOwners    map[string]string
	comicByAsset       map[string]comicAssociation
	jobByAsset         map[string]jobAssociation
	comicProjects      map[string]comicAssociation
	missingFolderKeys  map[string]bool
	canvasArchiveMoves []canvasArchiveMove
	archiveTimezone    string
	archiveZone        *time.Location
	result             Result
}

// Run plans and optionally applies the conservative asset-library backfill.
// Re-running it is safe: non-empty user-managed folder/source fields are never
// overwritten, and system folders are created through stable identities.
func Run(db *gorm.DB, dryRun bool) (Result, error) {
	return RunWithArchiveTimezone(db, dryRun, "Asia/Shanghai")
}

// RunWithArchiveTimezone keeps historical canvas folder backfills aligned
// with the same business-day boundary used by live ingestion.
func RunWithArchiveTimezone(db *gorm.DB, dryRun bool, timezone string) (Result, error) {
	zone, err := archiveLocation(timezone)
	if err != nil {
		return Result{}, err
	}
	plan, err := buildPlan(db, timezone, zone)
	if err != nil {
		return Result{}, err
	}
	plan.result.DryRun = dryRun
	if dryRun {
		return plan.result, nil
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return applyPlan(tx, plan)
	})
	return plan.result, err
}

func buildPlan(db *gorm.DB, archiveTimezone string, archiveZone *time.Location) (*migrationPlan, error) {
	plan := &migrationPlan{
		workspaceOwners:   make(map[string]string),
		comicByAsset:      make(map[string]comicAssociation),
		jobByAsset:        make(map[string]jobAssociation),
		comicProjects:     make(map[string]comicAssociation),
		missingFolderKeys: make(map[string]bool),
		archiveTimezone:   archiveTimezone,
		archiveZone:       archiveZone,
	}
	if err := db.Find(&plan.assets).Error; err != nil {
		return nil, err
	}
	plan.result.ScannedAssets = len(plan.assets)

	var users []model.User
	if err := db.Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		plan.workspaceOwners[service.WorkspaceIDForScope(service.WorkspaceScopePersonal, user.ID)] = user.ID
	}
	for _, asset := range plan.assets {
		workspaceID := effectiveWorkspaceID(asset.WorkspaceID, asset.UserID)
		rememberWorkspaceOwner(plan.workspaceOwners, workspaceID, asset.UserID)
		if strings.TrimSpace(asset.WorkspaceID) == "" {
			plan.result.WorkspaceBackfills++
		}
	}

	var projects []model.Project
	if err := db.Find(&projects).Error; err != nil {
		return nil, err
	}
	for _, project := range projects {
		rememberWorkspaceOwner(plan.workspaceOwners, effectiveWorkspaceID(project.WorkspaceID, project.OwnerID), project.OwnerID)
	}
	projectByID := make(map[string]model.Project, len(projects))
	for _, project := range projects {
		projectByID[project.ID] = project
	}

	var comicProjects []model.ComicAssetProject
	var comicAssets []model.ComicAsset
	var batches []model.ComicAssetGenerationBatch
	var items []model.ComicAssetGenerationItem
	if err := db.Find(&comicProjects).Error; err != nil {
		return nil, err
	}
	if err := db.Find(&comicAssets).Error; err != nil {
		return nil, err
	}
	if err := db.Find(&batches).Error; err != nil {
		return nil, err
	}
	if err := db.Find(&items).Error; err != nil {
		return nil, err
	}
	comicProjectByID := make(map[string]model.ComicAssetProject, len(comicProjects))
	for _, project := range comicProjects {
		comicProjectByID[project.ID] = project
		rememberWorkspaceOwner(plan.workspaceOwners, project.WorkspaceID, project.OwnerID)
	}
	assetByID := make(map[string]model.ComicAsset, len(comicAssets))
	for _, asset := range comicAssets {
		assetByID[asset.ID] = asset
	}
	batchByID := make(map[string]model.ComicAssetGenerationBatch, len(batches))
	for _, batch := range batches {
		batchByID[batch.ID] = batch
		rememberWorkspaceOwner(plan.workspaceOwners, batch.WorkspaceID, batch.UserID)
	}
	itemByID := make(map[string]model.ComicAssetGenerationItem, len(items))
	for _, item := range items {
		itemByID[item.ID] = item
		if strings.TrimSpace(item.OutputAssetID) == "" {
			continue
		}
		if association, ok := comicAssociationFor(item, batchByID, assetByID, comicProjectByID); ok {
			plan.comicByAsset[item.OutputAssetID] = association
			plan.comicProjects[association.WorkspaceID+"\x00"+association.ProjectID] = association
		}
	}
	for _, comicAsset := range comicAssets {
		var outputs []model.ComicAssetOutput
		_ = json.Unmarshal(comicAsset.Outputs, &outputs)
		for _, output := range outputs {
			if strings.TrimSpace(output.AssetID) == "" {
				continue
			}
			if _, exists := plan.comicByAsset[output.AssetID]; exists {
				continue
			}
			item := itemByID[output.BatchItemID]
			if item.ID == "" {
				item = model.ComicAssetGenerationItem{ID: output.BatchItemID, BatchID: output.BatchID, ComicAssetID: comicAsset.ID, OutputVersion: output.Version}
			}
			if association, ok := comicAssociationFor(item, batchByID, assetByID, comicProjectByID); ok {
				if association.Version == 0 {
					association.Version = output.Version
				}
				plan.comicByAsset[output.AssetID] = association
				plan.comicProjects[association.WorkspaceID+"\x00"+association.ProjectID] = association
			}
		}
	}

	var jobs []model.Job
	if err := db.Order("created_at ASC").Find(&jobs).Error; err != nil {
		return nil, err
	}
	for _, job := range jobs {
		workspaceID := effectiveWorkspaceID(job.WorkspaceID, job.UserID)
		rememberWorkspaceOwner(plan.workspaceOwners, workspaceID, job.UserID)
		for _, assetID := range collectJobResultAssetIDs(job.Result) {
			if _, exists := plan.jobByAsset[assetID]; !exists {
				plan.jobByAsset[assetID] = jobAssociation{WorkspaceID: workspaceID, UserID: job.UserID, JobID: job.ID}
			}
		}
	}

	var existingFolders []model.AssetFolder
	if err := db.Find(&existingFolders).Error; err != nil {
		return nil, err
	}
	folderByID := make(map[string]model.AssetFolder, len(existingFolders))
	for _, folder := range existingFolders {
		folderByID[folder.ID] = folder
	}

	for _, asset := range plan.assets {
		if asset.SourceType == model.AssetSourceCanvas {
			folder := folderByID[asset.FolderID]
			if folder.SystemKey == model.AssetFolderSystemKeyCanvasProject || folder.SystemKey == model.AssetFolderSystemKeyCanvasUnassigned || folder.SystemKey == model.AssetFolderSystemKeyCanvas {
				projectID := strings.TrimSpace(asset.SourceProjectID)
				if projectID == "" && folder.SystemKey == model.AssetFolderSystemKeyCanvasProject {
					projectID = strings.TrimSpace(folder.SourceRefID)
				}
				projectTitle := ""
				if project := projectByID[projectID]; project.ID != "" {
					projectTitle = project.Title
				}
				workspaceID := effectiveWorkspaceID(asset.WorkspaceID, asset.UserID)
				userID := asset.UserID
				if userID == "" {
					userID = plan.workspaceOwners[workspaceID]
				}
				plan.canvasArchiveMoves = append(plan.canvasArchiveMoves, canvasArchiveMove{AssetID: asset.ID, WorkspaceID: workspaceID, UserID: userID, ProjectID: projectID, ProjectTitle: projectTitle, OriginalFolderID: asset.FolderID, CreatedAt: asset.CreatedAt})
			}
		}
		managed := strings.TrimSpace(asset.WorkspaceID) != "" && strings.TrimSpace(asset.FolderID) != "" && strings.TrimSpace(asset.Category) != "" && strings.TrimSpace(asset.SourceType) != ""
		if managed {
			plan.result.AlreadyManaged++
			continue
		}
		if _, ok := plan.comicByAsset[asset.ID]; ok {
			plan.result.ComicAssetsToBackfill++
		} else if _, ok := plan.jobByAsset[asset.ID]; ok {
			plan.result.JobAssetsToBackfill++
		} else {
			plan.result.LegacyAssetsToBackfill++
		}
	}
	plan.result.CanvasAssetsToRefile = len(plan.canvasArchiveMoves)
	plan.result.Workspaces = len(plan.workspaceOwners)
	if err := planMissingFolders(db, plan); err != nil {
		return nil, err
	}
	plan.result.FoldersToCreate = len(plan.missingFolderKeys)
	return plan, nil
}

func applyPlan(tx *gorm.DB, plan *migrationPlan) error {
	folderRepo := repository.NewGormAssetFolderRepository(tx)
	assetRepo := repository.NewGormAssetRepository(tx)
	folders := service.NewAssetFolderService(folderRepo, assetRepo)
	if err := folders.SetArchiveTimezone(plan.archiveTimezone); err != nil {
		return err
	}
	defaultsByWorkspace := make(map[string]service.AssetDefaultFolders, len(plan.workspaceOwners))
	workspaceIDs := sortedKeys(plan.workspaceOwners)
	for _, workspaceID := range workspaceIDs {
		ownerID := plan.workspaceOwners[workspaceID]
		defaults, err := folders.EnsureDefaults(ownerID, service.WorkspaceScopeFromID(workspaceID))
		if err != nil {
			return fmt.Errorf("ensure defaults for %s: %w", workspaceID, err)
		}
		defaultsByWorkspace[workspaceID] = defaults
	}
	comicFolders := make(map[string]map[string]model.AssetFolder, len(plan.comicProjects))
	projectKeys := sortedKeys(plan.comicProjects)
	for _, key := range projectKeys {
		association := plan.comicProjects[key]
		resolved, err := folders.EnsureComicProjectFolders(association.UserID, service.WorkspaceScopeFromID(association.WorkspaceID), association.ProjectID, association.ProjectTitle)
		if err != nil {
			return fmt.Errorf("ensure comic folders for %s: %w", association.ProjectID, err)
		}
		comicFolders[key] = resolved
	}
	for _, asset := range plan.assets {
		workspaceID := effectiveWorkspaceID(asset.WorkspaceID, asset.UserID)
		updates := make(map[string]any)
		if strings.TrimSpace(asset.WorkspaceID) == "" {
			updates["workspace_id"] = workspaceID
		}
		comic, isComic := plan.comicByAsset[asset.ID]
		job, isJob := plan.jobByAsset[asset.ID]
		category := model.AssetCategoryOther
		if isComic {
			category = normalizedComicCategory(comic.Category)
		}
		if strings.TrimSpace(asset.Category) == "" {
			updates["category"] = category
		}
		if strings.TrimSpace(asset.FolderID) == "" {
			folderID := defaultsByWorkspace[workspaceID].Unsorted.ID
			if isComic {
				if projectFolders := comicFolders[comic.WorkspaceID+"\x00"+comic.ProjectID]; projectFolders != nil {
					if folder := projectFolders[category]; folder.ID != "" {
						folderID = folder.ID
					}
				}
			}
			updates["folder_id"] = folderID
		}
		if strings.TrimSpace(asset.SourceType) == "" {
			if isComic {
				updates["source_type"] = model.AssetSourceComicBatch
			} else {
				updates["source_type"] = model.AssetSourceLegacy
			}
		}
		if isComic {
			setIfBlank(updates, "source_project_id", asset.SourceProjectID, comic.ProjectID)
			setIfBlank(updates, "source_batch_id", asset.SourceBatchID, comic.BatchID)
			setIfBlank(updates, "source_item_id", asset.SourceItemID, comic.ItemID)
			setIfBlank(updates, "source_job_id", asset.SourceJobID, comic.JobID)
			if len(asset.SourceMetadata) == 0 || string(asset.SourceMetadata) == "{}" {
				updates["source_metadata"] = model.JSONB(mustJSON(map[string]any{
					"variant_index": comic.VariantIndex, "asset_code": comic.AssetCode, "version": comic.Version,
				}))
			}
		} else if isJob {
			setIfBlank(updates, "source_job_id", asset.SourceJobID, job.JobID)
		}
		if len(asset.Tags) == 0 {
			updates["tags"] = model.JSONB("[]")
		}
		if len(asset.SourceMetadata) == 0 && updates["source_metadata"] == nil {
			updates["source_metadata"] = model.JSONB("{}")
		}
		if len(updates) == 0 {
			continue
		}
		if err := tx.Model(&model.Asset{}).Where("id = ?", asset.ID).Updates(updates).Error; err != nil {
			return fmt.Errorf("backfill asset %s: %w", asset.ID, err)
		}
		plan.result.UpdatedAssets++
	}
	for _, move := range plan.canvasArchiveMoves {
		target, err := folders.EnsureCanvasArchiveFolderAt(move.UserID, service.WorkspaceScopeFromID(move.WorkspaceID), move.ProjectID, move.ProjectTitle, move.CreatedAt)
		if err != nil {
			return fmt.Errorf("ensure canvas archive folder for %s: %w", move.AssetID, err)
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND workspace_id = ? AND folder_id = ?", move.AssetID, move.WorkspaceID, move.OriginalFolderID).Update("folder_id", target.ID)
		if result.Error != nil {
			return fmt.Errorf("refile canvas asset %s: %w", move.AssetID, result.Error)
		}
		plan.result.CanvasAssetsRefiled += int(result.RowsAffected)
	}
	return nil
}

func comicAssociationFor(item model.ComicAssetGenerationItem, batches map[string]model.ComicAssetGenerationBatch, assets map[string]model.ComicAsset, projects map[string]model.ComicAssetProject) (comicAssociation, bool) {
	batch, ok := batches[item.BatchID]
	if !ok || strings.TrimSpace(batch.WorkspaceID) == "" {
		return comicAssociation{}, false
	}
	comicAsset, ok := assets[item.ComicAssetID]
	if !ok {
		return comicAssociation{}, false
	}
	project := projects[batch.ProjectID]
	projectTitle := project.Title
	if strings.TrimSpace(projectTitle) == "" {
		projectTitle = "已删除项目-" + batch.ProjectID
	}
	return comicAssociation{
		WorkspaceID: batch.WorkspaceID, UserID: batch.UserID, ProjectID: batch.ProjectID, ProjectTitle: projectTitle,
		BatchID: batch.ID, ItemID: item.ID, JobID: item.JobID, AssetCode: comicAsset.Code, Category: comicAsset.Class,
		VariantIndex: item.VariantIndex, Version: item.OutputVersion,
	}, true
}

func collectJobResultAssetIDs(raw model.JSONB) []string {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return nil
	}
	seen := make(map[string]bool)
	var visit func(any)
	visit = func(current any) {
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			for key, child := range typed {
				if key == "asset_id" || key == "id" {
					if id := strings.TrimSpace(fmt.Sprint(child)); strings.HasPrefix(id, "asset_") {
						seen[id] = true
					}
				}
				visit(child)
			}
		}
	}
	visit(value)
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func planMissingFolders(db *gorm.DB, plan *migrationPlan) error {
	existing := make(map[string]bool)
	var folders []model.AssetFolder
	if err := db.Find(&folders).Error; err != nil {
		return err
	}
	for _, folder := range folders {
		if folder.SystemIdentity != nil {
			existing[*folder.SystemIdentity] = true
		}
	}
	desired := make(map[string]bool)
	for workspaceID := range plan.workspaceOwners {
		for _, key := range []string{
			model.AssetFolderSystemKeyRoot, model.AssetFolderSystemKeyUnsorted, model.AssetFolderSystemKeyUpload,
			model.AssetFolderSystemKeyImageWorkbench, model.AssetFolderSystemKeyCanvas, model.AssetFolderSystemKeyComic,
		} {
			desired[folderIdentity(workspaceID, key, "")] = true
		}
	}
	for _, association := range plan.comicProjects {
		desired[folderIdentity(association.WorkspaceID, model.AssetFolderSystemKeyComicProject, association.ProjectID)] = true
		for _, category := range []string{
			model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryProp,
			model.AssetCategoryCostume, model.AssetCategoryUI, model.AssetCategoryOther,
		} {
			desired[folderIdentity(association.WorkspaceID, model.AssetFolderSystemKeyComicCategory, association.ProjectID+":"+category)] = true
		}
	}
	for _, move := range plan.canvasArchiveMoves {
		date := move.CreatedAt.In(plan.archiveZone).Format("2006-01-02")
		if move.ProjectID == "" {
			desired[folderIdentity(move.WorkspaceID, model.AssetFolderSystemKeyCanvasUnassigned, "")] = true
		} else {
			desired[folderIdentity(move.WorkspaceID, model.AssetFolderSystemKeyCanvasProject, move.ProjectID)] = true
		}
		desired[folderIdentity(move.WorkspaceID, model.AssetFolderSystemKeyCanvasProjectDate, move.ProjectID+":"+date)] = true
	}
	for identity := range desired {
		if !existing[identity] {
			plan.missingFolderKeys[identity] = true
		}
	}
	return nil
}

func archiveLocation(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "Asia/Shanghai" {
		return time.FixedZone("Asia/Shanghai", 8*60*60), nil
	}
	return time.LoadLocation(name)
}

func effectiveWorkspaceID(workspaceID string, userID string) string {
	if workspaceID = strings.TrimSpace(workspaceID); workspaceID != "" {
		return workspaceID
	}
	return service.WorkspaceIDForScope(service.WorkspaceScopePersonal, userID)
}

func rememberWorkspaceOwner(owners map[string]string, workspaceID string, userID string) {
	workspaceID = strings.TrimSpace(workspaceID)
	userID = strings.TrimSpace(userID)
	if workspaceID == "" {
		return
	}
	if userID == "" && strings.HasPrefix(workspaceID, "default:") {
		userID = strings.TrimPrefix(workspaceID, "default:")
	}
	if userID != "" && owners[workspaceID] == "" {
		owners[workspaceID] = userID
	}
}

func normalizedComicCategory(value string) string {
	category, err := service.NormalizeAssetCategory(value)
	if err != nil {
		return model.AssetCategoryOther
	}
	return category
}

func setIfBlank(updates map[string]any, key string, current string, value string) {
	if strings.TrimSpace(current) == "" && strings.TrimSpace(value) != "" {
		updates[key] = strings.TrimSpace(value)
	}
}

func mustJSON(value any) string {
	payload, _ := json.Marshal(value)
	return string(payload)
}

func folderIdentity(workspaceID string, systemKey string, sourceRefID string) string {
	return strings.Join([]string{workspaceID, systemKey, sourceRefID}, "|")
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
