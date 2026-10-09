package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

type canvasVisibilityFixture struct {
	projects    *ProjectService
	assets      *repository.MemoryAssetRepository
	folders     *repository.MemoryAssetFolderRepository
	usage       *repository.MemoryAssetUsageRepository
	tags        *repository.MemoryTagRepository
	workspaceID string
}

func newCanvasVisibilityFixture(t *testing.T) canvasVisibilityFixture {
	t.Helper()
	assets := repository.NewMemoryAssetRepository()
	folders := repository.NewMemoryAssetFolderRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	usage := repository.NewMemoryAssetUsageRepository()
	tagRepo := repository.NewMemoryTagRepository(assets)
	projects := NewProjectService(repository.NewMemoryProjectRepository())
	projects.SetAssetReferenceRepository(references)
	projects.SetLibraryVisibility(NewCanvasLibraryVisibilityService(assets, folders, references, usage, tagRepo))
	return canvasVisibilityFixture{projects: projects, assets: assets, folders: folders, usage: usage, tags: tagRepo, workspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")}
}

func (f canvasVisibilityFixture) createProject(t *testing.T, title string) string {
	t.Helper()
	project, err := f.projects.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return project.ID
}

func (f canvasVisibilityFixture) createAsset(t *testing.T, asset model.Asset) {
	t.Helper()
	asset.UserID, asset.WorkspaceID, asset.URL, asset.Tags = "user_a", f.workspaceID, asset.ID+".bin", model.JSONB("[]")
	if asset.Type == "" {
		asset.Type = "image"
	}
	if _, err := f.assets.Create(asset); err != nil {
		t.Fatal(err)
	}
}

func (f canvasVisibilityFixture) generation(t *testing.T, id string, projectID string, kind string) {
	f.createAsset(t, model.Asset{ID: id, Type: kind, SourceType: model.AssetSourceCanvas, SourceProjectID: projectID, SourceJobID: "job_" + id})
}

type canvasVisibilityNode struct {
	id        string
	assetID   string
	revisions []string
}

func (f canvasVisibilityFixture) save(t *testing.T, projectID string, nodes ...canvasVisibilityNode) {
	t.Helper()
	items := make([]map[string]any, 0, len(nodes))
	for _, node := range nodes {
		revisions := make([]map[string]any, 0, len(node.revisions))
		for index, assetID := range node.revisions {
			revisions = append(revisions, map[string]any{"id": node.id + "_rev_" + string(rune('a'+index)), "kind": "image", "assetId": assetID})
		}
		items = append(items, map[string]any{"id": node.id, "kind": "image", "metadata": map[string]any{"assetId": node.assetID, "generationRevisions": revisions}})
	}
	raw, err := json.Marshal(map[string]any{"nodes": items, "edges": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	data := model.JSONB(raw)
	if _, err := f.projects.UpdateSnapshot(projectID, "user_a", WorkspaceScopePersonal, &data); err != nil {
		t.Fatal(err)
	}
}

func (f canvasVisibilityFixture) libraryIDs(t *testing.T) map[string]bool {
	t.Helper()
	items, _, err := f.assets.ListLibrary(repository.AssetLibraryFilter{WorkspaceID: f.workspaceID, Unpaged: true})
	if err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]bool, len(items))
	for _, item := range items {
		ids[item.ID] = true
	}
	return ids
}

func assertLibrary(t *testing.T, library map[string]bool, visible []string, hidden []string) {
	t.Helper()
	for _, id := range visible {
		if !library[id] {
			t.Errorf("%s should be in the library", id)
		}
	}
	for _, id := range hidden {
		if library[id] {
			t.Errorf("%s should be hidden from the library", id)
		}
	}
}

func TestCanvasOverwrittenGenerationsLeaveTheLibraryUntilShownAgain(t *testing.T) {
	f := newCanvasVisibilityFixture(t)
	projectID := f.createProject(t, "画布")
	for _, id := range []string{"asset_gen_old", "asset_gen_new"} {
		f.generation(t, id, projectID, "image")
	}
	f.generation(t, "asset_video_old", projectID, "video")
	f.generation(t, "asset_video_new", projectID, "video")
	f.createAsset(t, model.Asset{ID: "asset_upload_old", SourceType: model.AssetSourceManualUpload, SourceProjectID: projectID})

	f.save(t, projectID,
		canvasVisibilityNode{id: "image_node", assetID: "asset_gen_new", revisions: []string{"asset_gen_old", "asset_upload_old"}},
		canvasVisibilityNode{id: "video_node", assetID: "asset_video_new", revisions: []string{"asset_video_old"}},
	)
	assertLibrary(t, f.libraryIDs(t), []string{"asset_gen_new", "asset_video_new", "asset_upload_old"}, []string{"asset_gen_old", "asset_video_old"})

	video := canvasVisibilityNode{id: "video_node", assetID: "asset_video_new", revisions: []string{"asset_video_old"}}

	// Applying a history item adds a node that displays it again.
	f.save(t, projectID,
		canvasVisibilityNode{id: "image_node", assetID: "asset_gen_new", revisions: []string{"asset_gen_old"}},
		canvasVisibilityNode{id: "applied", assetID: "asset_gen_old"},
		video,
	)
	assertLibrary(t, f.libraryIDs(t), []string{"asset_gen_new", "asset_gen_old", "asset_upload_old"}, nil)

	// Undo puts the old generation back on the node and the newer one into history.
	f.save(t, projectID, canvasVisibilityNode{id: "image_node", assetID: "asset_gen_old", revisions: []string{"asset_gen_new"}}, video)
	assertLibrary(t, f.libraryIDs(t), []string{"asset_gen_old"}, []string{"asset_gen_new"})

	// A revision that falls off the bounded history moves to the trash.
	f.save(t, projectID, canvasVisibilityNode{id: "image_node", assetID: "asset_gen_old"}, video)
	assertLibrary(t, f.libraryIDs(t), nil, []string{"asset_gen_new"})
	assertCleanedUp(t, f.trashedBy(t), []string{"asset_gen_new"}, nil)

	// Deleting the canvas trashes everything it created; library assets are kept.
	if err := f.projects.Delete(projectID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	assertLibrary(t, f.libraryIDs(t), []string{"asset_upload_old"}, []string{"asset_gen_old", "asset_video_new", "asset_video_old"})
	assertCleanedUp(t, f.trashedBy(t), []string{"asset_gen_old", "asset_gen_new", "asset_video_new", "asset_video_old"}, []string{"asset_upload_old"})
}

func (f canvasVisibilityFixture) trashedBy(t *testing.T) map[string]string {
	t.Helper()
	items, err := f.assets.ListTrash(f.workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]string, len(items))
	for _, item := range items {
		result[item.ID] = item.TrashedBy
	}
	return result
}

func assertCleanedUp(t *testing.T, trash map[string]string, cleaned []string, notTrashed []string) {
	t.Helper()
	for _, id := range cleaned {
		if trash[id] != model.AssetTrashedByCanvasCleanup {
			t.Errorf("%s should be in the trash by canvas cleanup, got %q", id, trash[id])
		}
	}
	for _, id := range notTrashed {
		if _, ok := trash[id]; ok {
			t.Errorf("%s should not be in the trash", id)
		}
	}
}

func TestCanvasImportsRemovedFromTheCanvasMoveToTrashAndReturnWhenUsedAgain(t *testing.T) {
	f := newCanvasVisibilityFixture(t)
	projectID := f.createProject(t, "画布")
	for _, item := range []model.Asset{
		{ID: "asset_pasted", Type: "image"},
		{ID: "asset_clip", Type: "video"},
		{ID: "asset_voice", Type: "audio"},
		{ID: "asset_browser_generated", Type: "image", SourceMetadata: model.JSONB(`{"prompt":"雨夜"}`)},
		{ID: "asset_job_generated", Type: "image", SourceJobID: "job_1"},
		{ID: "asset_uploading", Type: "image"},
		{ID: "asset_user_trashed", Type: "image"},
	} {
		item.SourceType, item.SourceProjectID = model.AssetSourceCanvas, projectID
		f.createAsset(t, item)
	}
	f.createAsset(t, model.Asset{ID: "asset_from_library", SourceType: model.AssetSourceManualUpload})
	if _, err := f.assets.TrashByWorkspace([]string{"asset_user_trashed"}, f.workspaceID, "user_a", time.Now().UTC(), time.Now().UTC().Add(model.AssetTrashRetention)); err != nil {
		t.Fatal(err)
	}

	all := []canvasVisibilityNode{
		{id: "pasted", assetID: "asset_pasted"}, {id: "clip", assetID: "asset_clip"}, {id: "voice", assetID: "asset_voice"},
		{id: "browser", assetID: "asset_browser_generated"}, {id: "job", assetID: "asset_job_generated"},
		{id: "library", assetID: "asset_from_library"},
	}
	f.save(t, projectID, all...)

	// Every node is deleted; the upload still in flight was never on the canvas.
	f.save(t, projectID)
	assertLibrary(t, f.libraryIDs(t),
		[]string{"asset_browser_generated", "asset_job_generated", "asset_from_library", "asset_uploading"},
		[]string{"asset_pasted", "asset_clip", "asset_voice"})
	assertCleanedUp(t, f.trashedBy(t), []string{"asset_pasted", "asset_clip", "asset_voice"}, []string{"asset_browser_generated", "asset_job_generated", "asset_from_library", "asset_uploading"})

	// Undo brings the nodes back: cleaned-up assets return, a person's trash stays.
	f.save(t, projectID, append(all, canvasVisibilityNode{id: "user_trashed", assetID: "asset_user_trashed"})...)
	assertLibrary(t, f.libraryIDs(t), []string{"asset_pasted", "asset_clip", "asset_voice"}, []string{"asset_user_trashed"})
	if trash := f.trashedBy(t); trash["asset_user_trashed"] != "user_a" || len(trash) != 1 {
		t.Fatalf("trash after undo = %v", trash)
	}
}

func TestCanvasOverwrittenGenerationsStayVisibleWhenOrganisedOrUsedElsewhere(t *testing.T) {
	f := newCanvasVisibilityFixture(t)
	projectID := f.createProject(t, "画布")
	otherID := f.createProject(t, "另一个画布")
	for _, id := range []string{"asset_gen_current", "asset_gen_plain", "asset_gen_favorite", "asset_gen_tagged", "asset_gen_inherited", "asset_gen_shared"} {
		f.generation(t, id, projectID, "image")
	}
	folder, err := f.folders.Create(model.AssetFolder{ID: "folder_mine", WorkspaceID: f.workspaceID, CreatedBy: "user_a", Name: "精选", NormalizedName: "精选", Kind: model.AssetFolderKindUser})
	if err != nil {
		t.Fatal(err)
	}
	f.createAsset(t, model.Asset{ID: "asset_gen_filed", FolderID: folder.ID, SourceType: model.AssetSourceCanvas, SourceProjectID: projectID, SourceJobID: "job_filed"})
	if _, err := f.usage.PutUserState(model.AssetUserState{ID: "state_favorite", AssetID: "asset_gen_favorite", UserID: "user_b", WorkspaceID: f.workspaceID, Reaction: model.AssetReactionFavorite}); err != nil {
		t.Fatal(err)
	}
	tags := NewTagService(f.tags, f.assets)
	tag, err := tags.Create("user_a", WorkspaceScopePersonal, TagCreateInput{Name: "主角", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tags.BindAssets([]string{"asset_gen_tagged"}, []string{tag.ID}, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := f.tags.BindAssets(f.workspaceID, "user_a", []string{"asset_gen_inherited"}, []string{tag.ID}, model.AssetTagOriginInherited); err != nil {
		t.Fatal(err)
	}
	f.save(t, otherID, canvasVisibilityNode{id: "copy", assetID: "asset_gen_shared"})

	f.save(t, projectID, canvasVisibilityNode{id: "node", assetID: "asset_gen_current", revisions: []string{"asset_gen_plain", "asset_gen_favorite", "asset_gen_tagged", "asset_gen_inherited", "asset_gen_shared", "asset_gen_filed"}})
	assertLibrary(t, f.libraryIDs(t),
		[]string{"asset_gen_current", "asset_gen_favorite", "asset_gen_tagged", "asset_gen_shared", "asset_gen_filed"},
		[]string{"asset_gen_plain", "asset_gen_inherited"})

	if err := f.projects.Delete(projectID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	assertLibrary(t, f.libraryIDs(t),
		[]string{"asset_gen_favorite", "asset_gen_tagged", "asset_gen_shared", "asset_gen_filed"},
		[]string{"asset_gen_current", "asset_gen_plain", "asset_gen_inherited"})
	assertCleanedUp(t, f.trashedBy(t), []string{"asset_gen_current", "asset_gen_plain", "asset_gen_inherited"}, []string{"asset_gen_favorite", "asset_gen_tagged", "asset_gen_shared", "asset_gen_filed"})
}

func TestCanvasAssetIDsSeparateDisplayedFromHistoryOnly(t *testing.T) {
	data := model.JSONB(`{"nodes":[
		{"id":"a","imageSrc":"/api/assets/asset_url/content?scope=personal","metadata":{"assetId":"asset_shown","generationRevisions":[{"assetId":"asset_old"},{"assetId":"asset_shown"}]}},
		{"id":"b","metadata":{"assetId":"asset_old_elsewhere","generationRevisions":[{"imageSrc":"/api/assets/asset_old_url/content"}]}}
	]}`)
	ids := canvasAssetIDs(data)
	want := map[string][]string{
		"all":         {"asset_old", "asset_old_elsewhere", "asset_old_url", "asset_shown", "asset_url"},
		"displayed":   {"asset_old_elsewhere", "asset_shown", "asset_url"},
		"historyOnly": {"asset_old", "asset_old_url"},
	}
	for name, got := range map[string][]string{"all": ids.all, "displayed": ids.displayed, "historyOnly": ids.historyOnly} {
		if len(got) != len(want[name]) {
			t.Fatalf("%s = %v, want %v", name, got, want[name])
		}
		for index := range got {
			if got[index] != want[name][index] {
				t.Fatalf("%s = %v, want %v", name, got, want[name])
			}
		}
	}
}
