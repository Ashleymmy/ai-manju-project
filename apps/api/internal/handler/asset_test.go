package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestAssetUploadListContentAndUserScope(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.png", "image/png", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploadBody struct {
		Data struct {
			ID          string `json:"id"`
			Type        string `json:"type"`
			Name        string `json:"name"`
			URL         string `json:"url"`
			ContentType string `json:"content_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.ID == "" || uploadBody.Data.Type != "image" || uploadBody.Data.Name != "sample.png" || uploadBody.Data.ContentType != "image/png" {
		t.Fatalf("unexpected upload body: %+v", uploadBody.Data)
	}
	if wantURL := "/api/assets/" + uploadBody.Data.ID + "/content"; uploadBody.Data.URL != wantURL {
		t.Fatalf("asset URL = %q, want %q", uploadBody.Data.URL, wantURL)
	}

	ownerList := performJSON(router, http.MethodGet, "/api/assets", "", ownerCookie)
	if ownerList.Code != http.StatusOK {
		t.Fatalf("owner list status = %d, body = %s", ownerList.Code, ownerList.Body.String())
	}
	if !strings.Contains(ownerList.Body.String(), uploadBody.Data.ID) {
		t.Fatalf("owner list missing uploaded asset: %s", ownerList.Body.String())
	}
	if !strings.Contains(ownerList.Body.String(), `"content_type":"image/png"`) {
		t.Fatalf("owner list missing persisted content_type: %s", ownerList.Body.String())
	}
	ownerDetail := performJSON(router, http.MethodGet, "/api/assets/"+uploadBody.Data.ID, "", ownerCookie)
	if ownerDetail.Code != http.StatusOK || !strings.Contains(ownerDetail.Body.String(), uploadBody.Data.ID) || !strings.Contains(ownerDetail.Body.String(), `"scope":"personal"`) {
		t.Fatalf("owner detail status/body = %d %s", ownerDetail.Code, ownerDetail.Body.String())
	}

	otherList := performJSON(router, http.MethodGet, "/api/assets", "", otherCookie)
	if otherList.Code != http.StatusOK {
		t.Fatalf("other list status = %d, body = %s", otherList.Code, otherList.Body.String())
	}
	if strings.Contains(otherList.Body.String(), uploadBody.Data.ID) {
		t.Fatalf("other user can see owner asset: %s", otherList.Body.String())
	}
	otherDetail := performJSON(router, http.MethodGet, "/api/assets/"+uploadBody.Data.ID, "", otherCookie)
	if otherDetail.Code != http.StatusNotFound {
		t.Fatalf("other detail status = %d, want 404; body = %s", otherDetail.Code, otherDetail.Body.String())
	}

	content := httptest.NewRecorder()
	contentReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content", nil)
	contentReq.AddCookie(ownerCookie)
	router.ServeHTTP(content, contentReq)
	if content.Code != http.StatusOK {
		t.Fatalf("owner content status = %d, body = %s", content.Code, content.Body.String())
	}
	if !bytes.Contains(content.Body.Bytes(), []byte("asset-bytes")) {
		t.Fatalf("owner content body = %q", content.Body.String())
	}
	if content.Header().Get("Cache-Control") != "private, max-age=3600" || content.Header().Get("ETag") == "" || content.Header().Get("Last-Modified") == "" {
		t.Fatalf("content cache headers = %v", content.Header())
	}
	notModified := httptest.NewRecorder()
	notModifiedReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content", nil)
	notModifiedReq.AddCookie(ownerCookie)
	notModifiedReq.Header.Set("If-None-Match", content.Header().Get("ETag"))
	router.ServeHTTP(notModified, notModifiedReq)
	if notModified.Code != http.StatusNotModified || notModified.Body.Len() != 0 {
		t.Fatalf("conditional content status/body = %d %q", notModified.Code, notModified.Body.String())
	}

	otherContent := httptest.NewRecorder()
	otherContentReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content", nil)
	otherContentReq.AddCookie(otherCookie)
	router.ServeHTTP(otherContent, otherContentReq)
	if otherContent.Code != http.StatusNotFound {
		t.Fatalf("other content status = %d, want 404; body = %s", otherContent.Code, otherContent.Body.String())
	}
}

func TestAssetTeamScopeAllowsSharedAccess(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")

	upload := uploadAssetToPath(t, router, ownerCookie, "/api/assets?scope=team", "image", "team.png", "image/png", []byte("\x89PNG\r\n\x1a\nteam-bytes"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("team upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploadBody struct {
		Data struct {
			ID          string `json:"id"`
			Scope       string `json:"scope"`
			WorkspaceID string `json:"workspace_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.Scope != WorkspaceScopeTeam || uploadBody.Data.WorkspaceID != TeamWorkspaceID {
		t.Fatalf("unexpected team asset body: %+v", uploadBody.Data)
	}

	otherTeamList := performJSON(router, http.MethodGet, "/api/assets?scope=team", "", otherCookie)
	if otherTeamList.Code != http.StatusOK || !strings.Contains(otherTeamList.Body.String(), uploadBody.Data.ID) {
		t.Fatalf("other team list status/body = %d %s", otherTeamList.Code, otherTeamList.Body.String())
	}
	otherTeamDetail := performJSON(router, http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"?scope=team", "", otherCookie)
	if otherTeamDetail.Code != http.StatusOK || !strings.Contains(otherTeamDetail.Body.String(), `"scope":"team"`) {
		t.Fatalf("other team detail status/body = %d %s", otherTeamDetail.Code, otherTeamDetail.Body.String())
	}

	otherPersonalList := performJSON(router, http.MethodGet, "/api/assets", "", otherCookie)
	if otherPersonalList.Code != http.StatusOK {
		t.Fatalf("other personal list status = %d, body = %s", otherPersonalList.Code, otherPersonalList.Body.String())
	}
	if strings.Contains(otherPersonalList.Body.String(), uploadBody.Data.ID) {
		t.Fatalf("team asset leaked into personal list: %s", otherPersonalList.Body.String())
	}

	content := httptest.NewRecorder()
	contentReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content?scope=team", nil)
	contentReq.AddCookie(otherCookie)
	router.ServeHTTP(content, contentReq)
	if content.Code != http.StatusOK {
		t.Fatalf("other team content status = %d, body = %s", content.Code, content.Body.String())
	}
	if !bytes.Contains(content.Body.Bytes(), []byte("team-bytes")) {
		t.Fatalf("other team content body = %q", content.Body.String())
	}
}

func TestAssetTeamScopeAllowsSharedDelete(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")

	upload := uploadAssetToPath(t, router, ownerCookie, "/api/assets?scope=team", "image", "team-delete.png", "image/png", []byte("\x89PNG\r\n\x1a\nteam-delete"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("team upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploadBody struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}

	deleteRecorder := performJSON(router, http.MethodDelete, "/api/assets/"+uploadBody.Data.ID+"?scope=team", "", otherCookie)
	if deleteRecorder.Code != http.StatusOK {
		t.Fatalf("team delete status = %d, body = %s", deleteRecorder.Code, deleteRecorder.Body.String())
	}

	listRecorder := performJSON(router, http.MethodGet, "/api/assets?scope=team", "", ownerCookie)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("team list status = %d, body = %s", listRecorder.Code, listRecorder.Body.String())
	}
	if strings.Contains(listRecorder.Body.String(), uploadBody.Data.ID) {
		t.Fatalf("deleted team asset still listed: %s", listRecorder.Body.String())
	}
}

func TestAssetTrashRestorePermanentDeleteAndWorkspaceAtomicity(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouter(t, assetDir)
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")

	ownerUpload := uploadAsset(t, router, ownerCookie, "image", "owner.png", "image/png", []byte("\x89PNG\r\n\x1a\nowner"))
	otherUpload := uploadAsset(t, router, otherCookie, "image", "other.png", "image/png", []byte("\x89PNG\r\n\x1a\nother"))
	assetID := responseAssetID(t, ownerUpload)
	otherID := responseAssetID(t, otherUpload)

	crossWorkspace := performJSON(router, http.MethodPost, "/api/assets/bulk-trash", fmt.Sprintf(`{"asset_ids":[%q,%q]}`, assetID, otherID), ownerCookie)
	if crossWorkspace.Code != http.StatusNotFound {
		t.Fatalf("cross-workspace bulk trash = %d %s", crossWorkspace.Code, crossWorkspace.Body.String())
	}
	active := performJSON(router, http.MethodGet, "/api/assets", "", ownerCookie)
	if !strings.Contains(active.Body.String(), assetID) {
		t.Fatalf("atomicity failure removed valid asset: %s", active.Body.String())
	}

	preflight := performJSON(router, http.MethodPost, "/api/assets/trash-preflight", fmt.Sprintf(`{"asset_ids":[%q]}`, assetID), ownerCookie)
	if preflight.Code != http.StatusOK || !strings.Contains(preflight.Body.String(), `"count":1`) {
		t.Fatalf("trash preflight = %d %s", preflight.Code, preflight.Body.String())
	}
	trashed := performJSON(router, http.MethodPost, "/api/assets/bulk-trash", fmt.Sprintf(`{"asset_ids":[%q]}`, assetID), ownerCookie)
	if trashed.Code != http.StatusOK || !strings.Contains(trashed.Body.String(), `"trash_expires_at"`) {
		t.Fatalf("bulk trash = %d %s", trashed.Code, trashed.Body.String())
	}
	active = performJSON(router, http.MethodGet, "/api/assets", "", ownerCookie)
	if strings.Contains(active.Body.String(), assetID) {
		t.Fatalf("trashed asset remains in active list: %s", active.Body.String())
	}
	trash := performJSON(router, http.MethodGet, "/api/assets/trash", "", ownerCookie)
	if trash.Code != http.StatusOK || !strings.Contains(trash.Body.String(), assetID) {
		t.Fatalf("trash list = %d %s", trash.Code, trash.Body.String())
	}
	content := performJSON(router, http.MethodGet, "/api/assets/"+assetID+"/content", "", ownerCookie)
	if content.Code != http.StatusOK {
		t.Fatalf("trashed content should remain readable: %d %s", content.Code, content.Body.String())
	}
	detail := performJSON(router, http.MethodGet, "/api/assets/"+assetID, "", ownerCookie)
	if detail.Code != http.StatusNotFound {
		t.Fatalf("trashed detail should be hidden: %d %s", detail.Code, detail.Body.String())
	}

	restored := performJSON(router, http.MethodPost, "/api/assets/bulk-restore", fmt.Sprintf(`{"asset_ids":[%q]}`, assetID), ownerCookie)
	if restored.Code != http.StatusOK {
		t.Fatalf("restore = %d %s", restored.Code, restored.Body.String())
	}
	if detail = performJSON(router, http.MethodGet, "/api/assets/"+assetID, "", ownerCookie); detail.Code != http.StatusOK {
		t.Fatalf("restored detail = %d %s", detail.Code, detail.Body.String())
	}

	_ = performJSON(router, http.MethodDelete, "/api/assets/"+assetID, "", ownerCookie)
	permanent := performJSON(router, http.MethodDelete, "/api/assets/"+assetID+"/permanent", "", ownerCookie)
	if permanent.Code != http.StatusOK {
		t.Fatalf("permanent delete = %d %s", permanent.Code, permanent.Body.String())
	}
	if content = performJSON(router, http.MethodGet, "/api/assets/"+assetID+"/content", "", ownerCookie); content.Code != http.StatusNotFound {
		t.Fatalf("permanently deleted content = %d %s", content.Code, content.Body.String())
	}
}

func TestAssetExportHTTPFlowAndWorkspaceIsolation(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")
	assetID := responseAssetID(t, uploadAsset(t, router, ownerCookie, "image", "export.png", "image/png", []byte("\x89PNG\r\n\x1a\nexport-http-media")))

	invalid := performJSON(router, http.MethodPost, "/api/asset-exports", `{"selection_mode":"selected","asset_ids":[]}`, ownerCookie)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid export = %d %s", invalid.Code, invalid.Body.String())
	}
	created := performJSON(router, http.MethodPost, "/api/asset-exports", fmt.Sprintf(`{"selection_mode":"selected","asset_ids":[%q]}`, assetID), ownerCookie)
	if created.Code != http.StatusAccepted {
		t.Fatalf("create export = %d %s", created.Code, created.Body.String())
	}
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &envelope); err != nil || envelope.Data.ID == "" {
		t.Fatalf("create export body = %s err=%v", created.Body.String(), err)
	}
	exportID := envelope.Data.ID
	if crossWorkspace := performJSON(router, http.MethodGet, "/api/asset-exports/"+exportID, "", otherCookie); crossWorkspace.Code != http.StatusNotFound {
		t.Fatalf("cross-workspace export = %d %s", crossWorkspace.Code, crossWorkspace.Body.String())
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		state := performJSON(router, http.MethodGet, "/api/asset-exports/"+exportID, "", ownerCookie)
		if state.Code != http.StatusOK {
			t.Fatalf("get export = %d %s", state.Code, state.Body.String())
		}
		var stateEnvelope struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(state.Body.Bytes(), &stateEnvelope); err != nil {
			t.Fatal(err)
		}
		if stateEnvelope.Data.Status == model.AssetExportStatusSucceeded {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("export did not finish: %s", state.Body.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	download := performJSON(router, http.MethodGet, "/api/asset-exports/"+exportID+"/content", "", ownerCookie)
	if download.Code != http.StatusOK || download.Header().Get("Content-Type") != "application/zip" || !bytes.HasPrefix(download.Body.Bytes(), []byte("PK")) || !bytes.Contains(download.Body.Bytes(), []byte("manifest.json")) {
		t.Fatalf("download = %d type=%q bytes=%d", download.Code, download.Header().Get("Content-Type"), download.Body.Len())
	}
}

func TestAssetFolderLibraryMetadataAndSafeDeleteFlow(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	otherCookie := loginCookie(t, router, "other", "secret")

	folderList := performJSON(router, http.MethodGet, "/api/asset-folders", "", ownerCookie)
	if folderList.Code != http.StatusOK {
		t.Fatalf("folder list status = %d body=%s", folderList.Code, folderList.Body.String())
	}
	var folderEnvelope struct {
		Data []struct {
			ID        string `json:"id"`
			SystemKey string `json:"system_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(folderList.Body.Bytes(), &folderEnvelope); err != nil {
		t.Fatal(err)
	}
	unsortedID := ""
	for _, folder := range folderEnvelope.Data {
		if folder.SystemKey == model.AssetFolderSystemKeyUnsorted {
			unsortedID = folder.ID
		}
	}
	if unsortedID == "" {
		t.Fatalf("unsorted folder missing: %s", folderList.Body.String())
	}

	createdFolder := performJSON(router, http.MethodPost, "/api/asset-folders", `{"name":"客户交付"}`, ownerCookie)
	if createdFolder.Code != http.StatusCreated {
		t.Fatalf("create folder status = %d body=%s", createdFolder.Code, createdFolder.Body.String())
	}
	var createdEnvelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createdFolder.Body.Bytes(), &createdEnvelope); err != nil {
		t.Fatal(err)
	}
	folderID := createdEnvelope.Data.ID

	upload := uploadAsset(t, router, ownerCookie, "image", "folder-flow.png", "image/png", []byte("\x89PNG\r\n\x1a\nfolder-flow"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d body=%s", upload.Code, upload.Body.String())
	}
	var uploadEnvelope struct {
		Data struct {
			ID         string `json:"id"`
			FolderID   string `json:"folder_id"`
			SourceType string `json:"source_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadEnvelope); err != nil {
		t.Fatal(err)
	}
	if uploadEnvelope.Data.FolderID == "" || uploadEnvelope.Data.SourceType != model.AssetSourceManualUpload {
		t.Fatalf("default upload metadata = %+v", uploadEnvelope.Data)
	}
	assetID := uploadEnvelope.Data.ID

	metadata := performJSON(router, http.MethodPut, "/api/assets/"+assetID+"/metadata", fmt.Sprintf(`{"name":"角色交付图","folder_id":%q,"category":"character","tags":["主角","正面"],"note":"待审核"}`, folderID), ownerCookie)
	if metadata.Code != http.StatusOK || !strings.Contains(metadata.Body.String(), `"source_type":"manual_upload"`) {
		t.Fatalf("metadata status/body = %d %s", metadata.Code, metadata.Body.String())
	}
	library := performJSON(router, http.MethodGet, "/api/assets/library?folder_id="+folderID+"&category=character&source_type=manual_upload&page=1&page_size=20", "", ownerCookie)
	if library.Code != http.StatusOK || !strings.Contains(library.Body.String(), assetID) || !strings.Contains(library.Body.String(), `"total":1`) {
		t.Fatalf("library status/body = %d %s", library.Code, library.Body.String())
	}
	categorySearch := performJSON(router, http.MethodGet, "/api/assets/library?keyword=character", "", ownerCookie)
	if categorySearch.Code != http.StatusOK || !strings.Contains(categorySearch.Body.String(), assetID) {
		t.Fatalf("category keyword status/body = %d %s", categorySearch.Code, categorySearch.Body.String())
	}
	otherLibrary := performJSON(router, http.MethodGet, "/api/assets/library?folder_id="+folderID, "", otherCookie)
	if otherLibrary.Code != http.StatusNotFound {
		t.Fatalf("cross-workspace folder status = %d body=%s", otherLibrary.Code, otherLibrary.Body.String())
	}

	deletedFolder := performJSON(router, http.MethodDelete, "/api/asset-folders/"+folderID, "", ownerCookie)
	if deletedFolder.Code != http.StatusOK || !strings.Contains(deletedFolder.Body.String(), `"moved_assets":1`) {
		t.Fatalf("delete folder status/body = %d %s", deletedFolder.Code, deletedFolder.Body.String())
	}
	unsortedLibrary := performJSON(router, http.MethodGet, "/api/assets/library?folder_id="+unsortedID, "", ownerCookie)
	if unsortedLibrary.Code != http.StatusOK || !strings.Contains(unsortedLibrary.Body.String(), assetID) || !strings.Contains(unsortedLibrary.Body.String(), `"source_type":"manual_upload"`) {
		t.Fatalf("safe-delete result status/body = %d %s", unsortedLibrary.Code, unsortedLibrary.Body.String())
	}
}

func TestAssetTrashPaginationKeepsLegacyListCompatible(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	assetID := responseAssetID(t, uploadAsset(t, router, ownerCookie, "image", "trash-page.png", "image/png", []byte("\x89PNG\r\n\x1a\ntrash-page")))

	deleted := performJSON(router, http.MethodDelete, "/api/assets/"+assetID, "", ownerCookie)
	if deleted.Code != http.StatusOK {
		t.Fatalf("trash asset = %d %s", deleted.Code, deleted.Body.String())
	}
	paged := performJSON(router, http.MethodGet, "/api/assets/trash/library?page=1&page_size=1", "", ownerCookie)
	if paged.Code != http.StatusOK || !strings.Contains(paged.Body.String(), assetID) || !strings.Contains(paged.Body.String(), `"total":1`) {
		t.Fatalf("paged trash = %d %s", paged.Code, paged.Body.String())
	}
	legacy := performJSON(router, http.MethodGet, "/api/assets/trash", "", ownerCookie)
	if legacy.Code != http.StatusOK || !strings.Contains(legacy.Body.String(), assetID) || strings.Contains(legacy.Body.String(), `"items"`) {
		t.Fatalf("legacy trash = %d %s", legacy.Code, legacy.Body.String())
	}
}

func TestAssetUploadRejectsOversizedFile(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouterWithConfig(t, config.Config{AssetStorageDir: assetDir, MaxAssetUploadBytes: 8})
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.png", "image/png", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("upload status = %d, want 413; body = %s", upload.Code, upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func TestAssetUploadCleansFileWhenMetadataCreateFails(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouterWithAssetRepo(t, config.Config{AssetStorageDir: assetDir, MaxAssetUploadBytes: 1024 * 1024}, failingAssetRepository{AssetRepository: repository.NewMemoryAssetRepository()})
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.png", "image/png", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusInternalServerError {
		t.Fatalf("upload status = %d, want 500; body = %s", upload.Code, upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func TestAssetUploadNormalizesOctetStreamImageContentType(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.png", "application/octet-stream", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}

	var uploadBody struct {
		Data struct {
			ID          string `json:"id"`
			ContentType string `json:"content_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.ContentType != "image/png" {
		t.Fatalf("content_type = %q, want image/png", uploadBody.Data.ContentType)
	}

	content := httptest.NewRecorder()
	contentReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content", nil)
	contentReq.AddCookie(ownerCookie)
	router.ServeHTTP(content, contentReq)
	if content.Code != http.StatusOK {
		t.Fatalf("content status = %d, body = %s", content.Code, content.Body.String())
	}
	if got := content.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/png") {
		t.Fatalf("download Content-Type = %q, want image/png", got)
	}
}

func TestAssetContentThumbnailResizesAndValidatesVariant(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")
	source := image.NewRGBA(image.Rect(0, 0, 800, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 800; x++ {
			source.Set(x, y, color.RGBA{R: 120, G: 80, B: 220, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	upload := uploadAsset(t, router, ownerCookie, "image", "large.png", "image/png", encoded.Bytes())
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	assetID := responseAssetID(t, upload)
	thumbnail := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/"+assetID+"/content?thumbnail=320", nil)
	request.AddCookie(ownerCookie)
	router.ServeHTTP(thumbnail, request)
	if thumbnail.Code != http.StatusOK || !strings.Contains(thumbnail.Header().Get("Cache-Control"), "86400") {
		t.Fatalf("thumbnail status=%d cache=%q body=%s", thumbnail.Code, thumbnail.Header().Get("Cache-Control"), thumbnail.Body.String())
	}
	resized, _, err := image.Decode(bytes.NewReader(thumbnail.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if resized.Bounds().Dx() != 320 || resized.Bounds().Dy() != 160 {
		t.Fatalf("thumbnail bounds = %v", resized.Bounds())
	}
	invalid := httptest.NewRecorder()
	invalidRequest := httptest.NewRequest(http.MethodGet, "/api/assets/"+assetID+"/content?thumbnail=400", nil)
	invalidRequest.AddCookie(ownerCookie)
	router.ServeHTTP(invalid, invalidRequest)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid thumbnail status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestAssetUploadInfersTypeWhenTypeFieldMissing(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAssetWithOptionalType(t, router, ownerCookie, "", "sample.png", "application/octet-stream", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}
	var uploadBody struct {
		Data struct {
			Type        string `json:"type"`
			ContentType string `json:"content_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.Type != "image" || uploadBody.Data.ContentType != "image/png" {
		t.Fatalf("upload body = %+v, want inferred image/png", uploadBody.Data)
	}
}

func TestAssetUploadSniffsWebPWhenHeaderAndFilenameAreUnhelpful(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")

	webpBytes := append([]byte("RIFF\x18\x00\x00\x00WEBPVP8 "), make([]byte, 32)...)
	upload := uploadAsset(t, router, ownerCookie, "image", "upload.bin", "application/octet-stream", webpBytes)
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}

	var uploadBody struct {
		Data struct {
			ID          string `json:"id"`
			ContentType string `json:"content_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.ContentType != "image/webp" {
		t.Fatalf("content_type = %q, want image/webp", uploadBody.Data.ContentType)
	}

	content := httptest.NewRecorder()
	contentReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploadBody.Data.ID+"/content", nil)
	contentReq.AddCookie(ownerCookie)
	router.ServeHTTP(content, contentReq)
	if content.Code != http.StatusOK {
		t.Fatalf("content status = %d, body = %s", content.Code, content.Body.String())
	}
	if got := content.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/webp") {
		t.Fatalf("download Content-Type = %q, want image/webp", got)
	}
}

func TestAssetUploadPrefersSniffedImageOverMisleadingFilenameForOctetStream(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.jpg", "application/octet-stream", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", upload.Code, upload.Body.String())
	}

	var uploadBody struct {
		Data struct {
			ContentType string `json:"content_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("decode upload body failed: %v; body = %s", err, upload.Body.String())
	}
	if uploadBody.Data.ContentType != "image/png" {
		t.Fatalf("content_type = %q, want image/png", uploadBody.Data.ContentType)
	}
}

func TestAssetUploadRejectsDeclaredImageWhenFileIsNotImage(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouter(t, assetDir)
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "notes.bin", "application/octet-stream", []byte("plain text, not an image"))
	if upload.Code != http.StatusBadRequest {
		t.Fatalf("upload status = %d, want 400; body = %s", upload.Code, upload.Body.String())
	}
	if !strings.Contains(upload.Body.String(), "uploaded file does not match asset type") {
		t.Fatalf("upload body missing mismatch error: %s", upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func TestAssetUploadRejectsFakeImageHeaderWhenPayloadIsNotImage(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouter(t, assetDir)
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "notes.png", "image/png", []byte("plain text, not an image"))
	if upload.Code != http.StatusBadRequest {
		t.Fatalf("upload status = %d, want 400; body = %s", upload.Code, upload.Body.String())
	}
	if !strings.Contains(upload.Body.String(), "uploaded file does not match asset type") {
		t.Fatalf("upload body missing mismatch error: %s", upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func TestAssetUploadRejectsConflictingImageMimeAndPayload(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouter(t, assetDir)
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "image", "sample.jpg", "image/jpeg", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusBadRequest {
		t.Fatalf("upload status = %d, want 400; body = %s", upload.Code, upload.Body.String())
	}
	if !strings.Contains(upload.Body.String(), "uploaded file does not match asset type") {
		t.Fatalf("upload body missing mismatch error: %s", upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func TestAssetUploadRejectsDeclaredVideoWhenFileIsImage(t *testing.T) {
	assetDir := t.TempDir()
	router := newAssetTestRouter(t, assetDir)
	ownerCookie := loginCookie(t, router, "owner", "secret")

	upload := uploadAsset(t, router, ownerCookie, "video", "sample.png", "image/png", []byte("\x89PNG\r\n\x1a\nasset-bytes"))
	if upload.Code != http.StatusBadRequest {
		t.Fatalf("upload status = %d, want 400; body = %s", upload.Code, upload.Body.String())
	}
	if !strings.Contains(upload.Body.String(), "uploaded file does not match asset type") {
		t.Fatalf("upload body missing mismatch error: %s", upload.Body.String())
	}
	assertNoAssetFiles(t, assetDir)
}

func newAssetTestRouter(t *testing.T, assetDir string) *gin.Engine {
	t.Helper()
	return newAssetTestRouterWithConfig(t, config.Config{AssetStorageDir: assetDir, MaxAssetUploadBytes: 1024 * 1024})
}

func newAssetTestRouterWithConfig(t *testing.T, cfg config.Config) *gin.Engine {
	t.Helper()
	return newAssetTestRouterWithAssetRepo(t, cfg, repository.NewMemoryAssetRepository())
}

func newAssetTestRouterWithAssetRepo(t *testing.T, cfg config.Config, assetRepo repository.AssetRepository) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	if cfg.MaxAssetUploadBytes <= 0 {
		cfg.MaxAssetUploadBytes = 1024 * 1024
	}
	userRepo := repository.NewMemoryUserRepository()
	authService := auth.NewService(userRepo, cfg)
	createAssetTestUser(t, userRepo, "user_owner", "owner")
	createAssetTestUser(t, userRepo, "user_other", "other")

	authHandler := NewAuthHandler(authService, userRepo, cfg)
	assetFolderRepo := repository.NewMemoryAssetFolderRepository()
	assetStore := storage.NewLocalFSStorage(cfg.AssetStorageDir)
	assetService := service.NewAssetService(assetRepo, assetStore)
	assetService.SetReferenceRepository(repository.NewMemoryAssetReferenceRepository())
	assetFolderService := service.NewAssetFolderService(assetFolderRepo, assetRepo)
	assetService.SetFolderService(assetFolderService)
	assetHandler := NewAssetHandlerWithService(assetService, cfg)
	assetFolderHandler := NewAssetFolderHandler(assetFolderService)
	assetExportService := service.NewAssetExportService(repository.NewMemoryAssetExportRepository(), assetService, assetFolderService, assetStore)
	dispatchContext, stopDispatcher := context.WithCancel(context.Background())
	t.Cleanup(stopDispatcher)
	assetExportService.StartDispatcher(dispatchContext, 5*time.Millisecond)
	assetExportHandler := NewAssetExportHandler(assetExportService)
	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	assets := api.Group("/assets", middleware.RequireAuth(authService))
	assets.GET("", assetHandler.List)
	assets.POST("", assetHandler.Upload)
	assets.GET("/library", assetHandler.ListLibrary)
	assets.POST("/bulk-move", assetHandler.BulkMove)
	assets.POST("/trash-preflight", assetHandler.TrashPreflight)
	assets.POST("/bulk-trash", assetHandler.BulkTrash)
	assets.GET("/trash/library", assetHandler.ListTrashLibrary)
	assets.GET("/trash", assetHandler.ListTrash)
	assets.POST("/bulk-restore", assetHandler.BulkRestore)
	assets.DELETE("/trash", assetHandler.EmptyTrash)
	assets.GET("/:id", assetHandler.Get)
	assets.PUT("/:id/metadata", assetHandler.UpdateMetadata)
	assets.GET("/:id/content", assetHandler.Content)
	assets.DELETE("/:id/permanent", assetHandler.PermanentDelete)
	assets.DELETE("/:id", assetHandler.Delete)
	assetFolders := api.Group("/asset-folders", middleware.RequireAuth(authService))
	assetFolders.GET("", assetFolderHandler.List)
	assetFolders.POST("", assetFolderHandler.Create)
	assetFolders.PUT("/:folderId", assetFolderHandler.Update)
	assetFolders.DELETE("/:folderId", assetFolderHandler.Delete)
	assetExports := api.Group("/asset-exports", middleware.RequireAuth(authService))
	assetExports.POST("", assetExportHandler.Create)
	assetExports.GET("", assetExportHandler.List)
	assetExports.GET("/:exportId", assetExportHandler.Get)
	assetExports.POST("/:exportId/cancel", assetExportHandler.Cancel)
	assetExports.GET("/:exportId/content", assetExportHandler.Content)
	return router
}

type failingAssetRepository struct {
	repository.AssetRepository
}

func (r failingAssetRepository) Create(asset model.Asset) (model.Asset, error) {
	return model.Asset{}, errors.New("metadata write failed")
}

func createAssetTestUser(t *testing.T, userRepo repository.UserRepository, id string, username string) {
	t.Helper()
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := userRepo.CreateUser(model.User{
		ID:           id,
		Username:     username,
		PasswordHash: hash,
		DisplayName:  username,
		Role:         model.UserRoleMember,
		Status:       model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}
}

func uploadAsset(t *testing.T, router *gin.Engine, cookie *http.Cookie, assetType string, fileName string, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	return uploadAssetWithOptionalType(t, router, cookie, assetType, fileName, contentType, data)
}

func responseAssetID(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	if recorder.Code != http.StatusCreated {
		t.Fatalf("asset upload = %d %s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || envelope.Data.ID == "" {
		t.Fatalf("asset upload response = %s err=%v", recorder.Body.String(), err)
	}
	return envelope.Data.ID
}

func uploadAssetWithOptionalType(t *testing.T, router *gin.Engine, cookie *http.Cookie, assetType string, fileName string, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	return uploadAssetToPath(t, router, cookie, "/api/assets", assetType, fileName, contentType, data)
}

func uploadAssetToPath(t *testing.T, router *gin.Engine, cookie *http.Cookie, path string, assetType string, fileName string, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if assetType != "" {
		if err := writer.WriteField("type", assetType); err != nil {
			t.Fatal(err)
		}
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+fileName+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, path, body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.AddCookie(cookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func assertNoAssetFiles(t *testing.T, assetDir string) {
	t.Helper()
	var files []string
	if err := filepath.WalkDir(assetDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			files = append(files, path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(files) > 0 {
		t.Fatalf("oversized upload left asset files behind: %v", files)
	}
}
