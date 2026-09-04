package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

func TestProjectHandlerCreateRejectsBlankTitle(t *testing.T) {
	recorder := performProjectRequest(http.MethodPost, "/projects", `{"title":"   "}`, "blank-title-test")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	assertErrorRequestID(t, recorder.Body.Bytes(), "blank-title-test")
}

func TestProjectHandlerMissingProjectReturns404(t *testing.T) {
	recorder := performProjectRequest(http.MethodGet, "/projects/missing", "", "missing-project-test")

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusNotFound, recorder.Body.String())
	}
	assertErrorRequestID(t, recorder.Body.Bytes(), "missing-project-test")
}

func TestProjectHandlerSnapshotVersionIncrements(t *testing.T) {
	router := newProjectTestRouter()

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Version Test"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body = %s", createRecorder.Code, http.StatusCreated, createRecorder.Body.String())
	}

	projectID := extractString(t, createRecorder.Body.String(), "id")
	updateRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID+"/snapshot", strings.NewReader(`{"data":{"nodes":[],"connections":[]}}`))
	updateRequest.Header.Set("Content-Type", "application/json")
	updateRecorder := httptest.NewRecorder()
	router.ServeHTTP(updateRecorder, updateRequest)
	if updateRecorder.Code != http.StatusOK {
		t.Fatalf("snapshot update status = %d, want %d; body = %s", updateRecorder.Code, http.StatusOK, updateRecorder.Body.String())
	}
	if version := extractNumber(t, updateRecorder.Body.String(), "version"); version != 1 {
		t.Fatalf("snapshot version = %d, want 1", version)
	}
}

func TestProjectHandlerUpdateCoverAsset(t *testing.T) {
	router := newProjectTestRouter()

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Cover Test"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body = %s", createRecorder.Code, http.StatusCreated, createRecorder.Body.String())
	}
	projectID := extractString(t, createRecorder.Body.String(), "id")

	// 设置封面
	setRecorder := httptest.NewRecorder()
	setRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID, strings.NewReader(`{"cover_asset_id":"asset_cover_1"}`))
	setRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(setRecorder, setRequest)
	if setRecorder.Code != http.StatusOK {
		t.Fatalf("set cover status = %d, want %d; body = %s", setRecorder.Code, http.StatusOK, setRecorder.Body.String())
	}
	if cover := extractString(t, setRecorder.Body.String(), "cover_asset_id"); cover != "asset_cover_1" {
		t.Fatalf("cover_asset_id = %q, want %q", cover, "asset_cover_1")
	}

	// 清除封面（空字符串）后应回到默认
	clearRecorder := httptest.NewRecorder()
	clearRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID, strings.NewReader(`{"cover_asset_id":""}`))
	clearRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(clearRecorder, clearRequest)
	if clearRecorder.Code != http.StatusOK {
		t.Fatalf("clear cover status = %d, want %d; body = %s", clearRecorder.Code, http.StatusOK, clearRecorder.Body.String())
	}

	getRecorder := httptest.NewRecorder()
	getRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID, nil)
	router.ServeHTTP(getRecorder, getRequest)
	if cover := extractString(t, getRecorder.Body.String(), "cover_asset_id"); cover != "" {
		t.Fatalf("cover_asset_id after clear = %q, want empty", cover)
	}
}

func TestProjectHandlerEmptySnapshotVersion(t *testing.T) {
	router := newProjectTestRouter()

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Empty Snapshot Test"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body = %s", createRecorder.Code, http.StatusCreated, createRecorder.Body.String())
	}

	projectID := extractString(t, createRecorder.Body.String(), "id")
	snapshotRecorder := httptest.NewRecorder()
	snapshotRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/snapshot", nil)
	router.ServeHTTP(snapshotRecorder, snapshotRequest)
	if snapshotRecorder.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, want %d; body = %s", snapshotRecorder.Code, http.StatusOK, snapshotRecorder.Body.String())
	}
	if version := extractNumber(t, snapshotRecorder.Body.String(), "version"); version != 0 {
		t.Fatalf("empty snapshot version = %d, want 0", version)
	}
}

func TestProjectHandlerCreatePersistsInitialCanvasData(t *testing.T) {
	router := newProjectTestRouter()

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Chat Bootstrap","data":{"nodes":[{"id":"chat-text"}],"edges":[]}}`))
	createRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body = %s", createRecorder.Code, http.StatusCreated, createRecorder.Body.String())
	}

	projectID := extractString(t, createRecorder.Body.String(), "id")
	snapshotRecorder := httptest.NewRecorder()
	snapshotRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/snapshot", nil)
	router.ServeHTTP(snapshotRecorder, snapshotRequest)
	if snapshotRecorder.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, want %d; body = %s", snapshotRecorder.Code, http.StatusOK, snapshotRecorder.Body.String())
	}
	if version := extractNumber(t, snapshotRecorder.Body.String(), "version"); version != 1 {
		t.Fatalf("initial snapshot version = %d, want 1", version)
	}
	if !strings.Contains(snapshotRecorder.Body.String(), `"id":"chat-text"`) {
		t.Fatalf("initial snapshot data missing: %s", snapshotRecorder.Body.String())
	}
}

func TestProjectHandlerUsesCurrentUserAndHidesCrossUserProjects(t *testing.T) {
	repo := repository.NewMemoryProjectRepository()
	router := newProjectTestRouterWithRepoAndUser(repo, "user_a")

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Owned","owner_id":"attacker"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createRecorder.Code, createRecorder.Body.String())
	}
	projectID := extractString(t, createRecorder.Body.String(), "id")
	if ownerID := extractString(t, createRecorder.Body.String(), "owner_id"); ownerID != "user_a" {
		t.Fatalf("owner_id = %q, want user_a", ownerID)
	}

	otherRouter := newProjectTestRouterWithRepoAndUser(repo, "user_b")
	detailRecorder := httptest.NewRecorder()
	detailRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID, nil)
	otherRouter.ServeHTTP(detailRecorder, detailRequest)
	if detailRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-user detail status = %d, want 404; body = %s", detailRecorder.Code, detailRecorder.Body.String())
	}

	listRecorder := httptest.NewRecorder()
	listRequest := httptest.NewRequest(http.MethodGet, "/projects", nil)
	otherRouter.ServeHTTP(listRecorder, listRequest)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("cross-user list status = %d, body = %s", listRecorder.Code, listRecorder.Body.String())
	}
	if strings.Contains(listRecorder.Body.String(), projectID) {
		t.Fatalf("cross-user list leaked project %s: %s", projectID, listRecorder.Body.String())
	}

	snapshotRecorder := httptest.NewRecorder()
	snapshotRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/snapshot", nil)
	otherRouter.ServeHTTP(snapshotRecorder, snapshotRequest)
	if snapshotRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-user snapshot status = %d, want 404; body = %s", snapshotRecorder.Code, snapshotRecorder.Body.String())
	}
}

func TestProjectHandlerRejectsCrossUserMutation(t *testing.T) {
	repo := repository.NewMemoryProjectRepository()
	ownerRouter := newProjectTestRouterWithRepoAndUser(repo, "user_a")
	otherRouter := newProjectTestRouterWithRepoAndUser(repo, "user_b")

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"title":"Owned"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	ownerRouter.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createRecorder.Code, createRecorder.Body.String())
	}
	projectID := extractString(t, createRecorder.Body.String(), "id")

	updateRecorder := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID, strings.NewReader(`{"title":"Hijacked"}`))
	updateRequest.Header.Set("Content-Type", "application/json")
	otherRouter.ServeHTTP(updateRecorder, updateRequest)
	if updateRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-user update status = %d, want 404; body = %s", updateRecorder.Code, updateRecorder.Body.String())
	}

	snapshotRecorder := httptest.NewRecorder()
	snapshotRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID+"/snapshot", strings.NewReader(`{"data":{"nodes":[{"id":"evil"}]}}`))
	snapshotRequest.Header.Set("Content-Type", "application/json")
	otherRouter.ServeHTTP(snapshotRecorder, snapshotRequest)
	if snapshotRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-user snapshot update status = %d, want 404; body = %s", snapshotRecorder.Code, snapshotRecorder.Body.String())
	}

	deleteRecorder := httptest.NewRecorder()
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/projects/"+projectID, nil)
	otherRouter.ServeHTTP(deleteRecorder, deleteRequest)
	if deleteRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-user delete status = %d, want 404; body = %s", deleteRecorder.Code, deleteRecorder.Body.String())
	}

	detailRecorder := httptest.NewRecorder()
	detailRequest := httptest.NewRequest(http.MethodGet, "/projects/"+projectID, nil)
	ownerRouter.ServeHTTP(detailRecorder, detailRequest)
	if detailRecorder.Code != http.StatusOK {
		t.Fatalf("owner detail after cross-user mutation status = %d, body = %s", detailRecorder.Code, detailRecorder.Body.String())
	}
	if strings.Contains(detailRecorder.Body.String(), "Hijacked") || strings.Contains(detailRecorder.Body.String(), "evil") {
		t.Fatalf("cross-user mutation affected owner project: %s", detailRecorder.Body.String())
	}
}

func TestProjectHandlerTeamScopeAllowsSharedAccess(t *testing.T) {
	repo := repository.NewMemoryProjectRepository()
	ownerRouter := newProjectTestRouterWithRepoAndUser(repo, "user_a")
	otherRouter := newProjectTestRouterWithRepoAndUser(repo, "user_b")

	createRecorder := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/projects?scope=team", strings.NewReader(`{"title":"Team Project"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	ownerRouter.ServeHTTP(createRecorder, createRequest)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("team create status = %d, body = %s", createRecorder.Code, createRecorder.Body.String())
	}
	projectID := extractString(t, createRecorder.Body.String(), "id")
	if scope := extractString(t, createRecorder.Body.String(), "scope"); scope != WorkspaceScopeTeam {
		t.Fatalf("scope = %q, want team; body = %s", scope, createRecorder.Body.String())
	}
	if workspaceID := extractString(t, createRecorder.Body.String(), "workspace_id"); workspaceID != TeamWorkspaceID {
		t.Fatalf("workspace_id = %q, want %q", workspaceID, TeamWorkspaceID)
	}

	otherList := httptest.NewRecorder()
	otherRouter.ServeHTTP(otherList, httptest.NewRequest(http.MethodGet, "/projects?scope=team", nil))
	if otherList.Code != http.StatusOK || !strings.Contains(otherList.Body.String(), projectID) {
		t.Fatalf("other team list status/body = %d %s", otherList.Code, otherList.Body.String())
	}

	updateRecorder := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPut, "/projects/"+projectID+"?scope=team", strings.NewReader(`{"title":"Edited By Team"}`))
	updateRequest.Header.Set("Content-Type", "application/json")
	otherRouter.ServeHTTP(updateRecorder, updateRequest)
	if updateRecorder.Code != http.StatusOK || !strings.Contains(updateRecorder.Body.String(), "Edited By Team") {
		t.Fatalf("other team update status/body = %d %s", updateRecorder.Code, updateRecorder.Body.String())
	}

	personalList := httptest.NewRecorder()
	otherRouter.ServeHTTP(personalList, httptest.NewRequest(http.MethodGet, "/projects", nil))
	if personalList.Code != http.StatusOK {
		t.Fatalf("personal list status = %d, body = %s", personalList.Code, personalList.Body.String())
	}
	if strings.Contains(personalList.Body.String(), projectID) {
		t.Fatalf("team project leaked into personal list: %s", personalList.Body.String())
	}
}

func performProjectRequest(method string, path string, body string, requestID string) *httptest.ResponseRecorder {
	router := newProjectTestRouter()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if requestID != "" {
		request.Header.Set(middleware.RequestIDHeader, requestID)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func newProjectTestRouter() *gin.Engine {
	return newProjectTestRouterWithRepoAndUser(repository.NewMemoryProjectRepository(), "user_project_test")
}

func newProjectTestRouterWithRepoAndUser(repo repository.ProjectRepository, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{
			ID:          userID,
			Username:    "project-test",
			DisplayName: "Project Test",
			Role:        model.UserRoleMember,
			Status:      model.UserStatusActive,
		})
		c.Next()
	})
	handler := NewProjectHandler(repo)
	router.GET("/projects", handler.GetProjects)
	router.GET("/projects/:id", handler.GetProject)
	router.POST("/projects", handler.CreateProject)
	router.PUT("/projects/:id", handler.UpdateProject)
	router.DELETE("/projects/:id", handler.DeleteProject)
	router.GET("/projects/:id/snapshot", handler.GetCanvasSnapshot)
	router.PUT("/projects/:id/snapshot", handler.UpdateCanvasSnapshot)
	return router
}

func assertErrorRequestID(t *testing.T, body []byte, want string) {
	t.Helper()

	var parsed struct {
		Success   bool   `json:"success"`
		Error     string `json:"error"`
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("json.Unmarshal() error = %v; body = %s", err, string(body))
	}
	if parsed.Success {
		t.Fatalf("success = true, want false")
	}
	if parsed.Error == "" {
		t.Fatalf("error is empty")
	}
	if parsed.RequestID != want {
		t.Fatalf("request_id = %q, want %q", parsed.RequestID, want)
	}
}

func extractString(t *testing.T, body string, field string) string {
	t.Helper()

	marker := `"` + field + `":"`
	start := strings.Index(body, marker)
	if start == -1 {
		t.Fatalf("field %q not found in body: %s", field, body)
	}
	start += len(marker)
	end := strings.Index(body[start:], `"`)
	if end == -1 {
		t.Fatalf("field %q string not terminated in body: %s", field, body)
	}

	return body[start : start+end]
}

func extractNumber(t *testing.T, body string, field string) int {
	t.Helper()

	marker := `"` + field + `":`
	start := strings.Index(body, marker)
	if start == -1 {
		t.Fatalf("field %q not found in body: %s", field, body)
	}
	start += len(marker)

	var value int
	if _, err := fmt.Sscanf(body[start:], "%d", &value); err != nil {
		t.Fatalf("field %q number parse failed: %v; body = %s", field, err, body)
	}

	return value
}
