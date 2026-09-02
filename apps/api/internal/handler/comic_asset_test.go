package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestComicAnalysisAndPromptCollaborationEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	comicService := service.NewComicAssetService(repository.NewMemoryComicAssetRepository(), service.NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3))
	comicService.SetSourceStorage(storage.NewLocalFSStorage(t.TempDir()))
	responses := []provider.TextResponse{
		{Text: `{"assets":[{"class":"character","name":"阿青","visual_description":"青衣","source_prompt":"青衣少年"}]}`, Model: "mock-v1"},
		{Text: `{"assets":[{"class":"character","code":"C001","name":"阿青","visual_description":"青衣执伞","source_prompt":"青衣少年执伞"}]}`, Model: "mock-v2"},
		{Text: "冷色雨夜全身人物设定", Model: "mock-v3"},
	}
	comicService.SetTextGenerator(func(_ context.Context, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		result := responses[0]
		responses = responses[1:]
		return result, nil
	})
	handler := NewComicAssetHandler(comicService)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "user_a", Username: "user_a"})
		c.Next()
	})
	router.POST("/api/comic-asset-analysis-sessions", handler.CreateAnalysisSession)
	router.GET("/api/comic-asset-analysis-sessions/:sessionId", handler.GetAnalysisSession)
	router.POST("/api/comic-asset-analysis-sessions/:sessionId/revisions", handler.CreateAnalysisRevision)
	router.PUT("/api/comic-asset-analysis-sessions/:sessionId/active-revision", handler.SetActiveAnalysisRevision)
	router.POST("/api/comic-asset-analysis-sessions/:sessionId/confirm", handler.ConfirmAnalysisSession)
	router.POST("/api/comic-asset-projects/:projectId/assets/:assetId/prompt-optimize", handler.OptimizePrompt)
	router.POST("/api/comic-asset-projects/:projectId/prompts/bulk-approve", handler.BulkApprovePrompts)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("payload", `{"title":"雨巷","style_preset":"国风动画","source_type":"script","source_text":"雨夜，阿青执伞。","model":"provider::mock-v1"}`); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("source_file", "雨巷.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("雨夜，阿青执伞。"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/comic-asset-analysis-sessions?scope=personal", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	created := httptest.NewRecorder()
	router.ServeHTTP(created, request)
	if created.Code != http.StatusCreated {
		t.Fatalf("create analysis status=%d body=%s", created.Code, created.Body.String())
	}
	var createdBody struct {
		Data service.ComicAnalysisDetail `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatal(err)
	}
	sessionID := createdBody.Data.Session.ID
	v1 := createdBody.Data.Session.ActiveRevisionID

	revised := performJSON(router, http.MethodPost, "/api/comic-asset-analysis-sessions/"+sessionID+"/revisions?scope=personal", `{"source":"ai","instruction":"强化雨夜细节","model":"provider::mock-v2","parent_revision_id":"`+v1+`","expected_active_revision_id":"`+v1+`"}`, nil)
	if revised.Code != http.StatusCreated {
		t.Fatalf("revision status=%d body=%s", revised.Code, revised.Body.String())
	}
	var revisedBody struct {
		Data service.ComicAnalysisDetail `json:"data"`
	}
	if err := json.Unmarshal(revised.Body.Bytes(), &revisedBody); err != nil {
		t.Fatal(err)
	}
	confirmed := performJSON(router, http.MethodPost, "/api/comic-asset-analysis-sessions/"+sessionID+"/confirm?scope=personal", `{"revision_id":"`+revisedBody.Data.Session.ActiveRevisionID+`"}`, nil)
	if confirmed.Code != http.StatusCreated {
		t.Fatalf("confirm status=%d body=%s", confirmed.Code, confirmed.Body.String())
	}
	var confirmedBody struct {
		Data service.ComicProjectDetail `json:"data"`
	}
	if err := json.Unmarshal(confirmed.Body.Bytes(), &confirmedBody); err != nil {
		t.Fatal(err)
	}
	asset := confirmedBody.Data.Assets[0]
	optimized := performJSON(router, http.MethodPost, "/api/comic-asset-projects/"+confirmedBody.Data.Project.ID+"/assets/"+asset.ID+"/prompt-optimize?scope=personal", `{"direction":"强化冷色雨夜光线","model":"provider::mock-v3"}`, nil)
	if optimized.Code != http.StatusOK {
		t.Fatalf("optimize status=%d body=%s", optimized.Code, optimized.Body.String())
	}
	var optimizedBody struct {
		Data service.OptimizeComicPromptResult `json:"data"`
	}
	if err := json.Unmarshal(optimized.Body.Bytes(), &optimizedBody); err != nil {
		t.Fatal(err)
	}
	approved := performJSON(router, http.MethodPost, "/api/comic-asset-projects/"+confirmedBody.Data.Project.ID+"/prompts/bulk-approve?scope=personal", fmt.Sprintf(`{"approvals":[{"asset_id":"%s","expected_prompt_version":%d}]}`, asset.ID, optimizedBody.Data.Asset.PromptVersion), nil)
	if approved.Code != http.StatusOK || !containsJSONText(approved.Body.String(), `"ok":true`) {
		t.Fatalf("bulk approve status=%d body=%s", approved.Code, approved.Body.String())
	}
	crossWorkspace := performJSON(router, http.MethodGet, "/api/comic-asset-analysis-sessions/"+sessionID+"?scope=team", "", nil)
	if crossWorkspace.Code != http.StatusNotFound {
		t.Fatalf("cross workspace status=%d body=%s", crossWorkspace.Code, crossWorkspace.Body.String())
	}
}

func TestComicAssetHandlerPromptAndBatchFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	comicRepo := repository.NewMemoryComicAssetRepository()
	jobService := service.NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3)
	comicService := service.NewComicAssetService(comicRepo, jobService)
	comicService.SetImageJobResolver(func(requested string, _ string) (service.ComicImageJobResolution, error) {
		return service.ComicImageJobResolution{Selector: "provider::image-v1", Model: "image-v1", TaskKwargs: map[string]any{"provider": map[string]any{"api_key": "transient"}}}, nil
	})
	handler := NewComicAssetHandler(comicService)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "user_a", Username: "user_a"})
		c.Next()
	})
	router.POST("/api/comic-asset-projects", handler.CreateProject)
	router.POST("/api/comic-asset-projects/:projectId/assets", handler.CreateAsset)
	router.POST("/api/comic-asset-projects/:projectId/assets/:assetId/prompt-preview", handler.PreviewPrompt)
	router.PUT("/api/comic-asset-projects/:projectId/assets/:assetId/prompt", handler.SavePrompt)
	router.POST("/api/comic-asset-projects/:projectId/generation-batches", handler.CreateBatch)
	router.GET("/api/comic-asset-generation-batches/:batchId", handler.GetBatch)

	createdProject := performJSON(router, http.MethodPost, "/api/comic-asset-projects?scope=personal", `{"title":"漫剧项目","style_preset":"水墨动画"}`, nil)
	if createdProject.Code != http.StatusCreated {
		t.Fatalf("create project status=%d body=%s", createdProject.Code, createdProject.Body.String())
	}
	var projectBody struct {
		Success bool `json:"success"`
		Data    struct {
			Project model.ComicAssetProject `json:"project"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createdProject.Body.Bytes(), &projectBody); err != nil {
		t.Fatal(err)
	}
	projectID := projectBody.Data.Project.ID

	createdAsset := performJSON(router, http.MethodPost, "/api/comic-asset-projects/"+projectID+"/assets?scope=personal", `{"class":"character","name":"阿青","visual_description":"青色长衫","source_prompt":"原始提示词"}`, nil)
	if createdAsset.Code != http.StatusCreated {
		t.Fatalf("create asset status=%d body=%s", createdAsset.Code, createdAsset.Body.String())
	}
	var assetBody struct {
		Data model.ComicAsset `json:"data"`
	}
	if err := json.Unmarshal(createdAsset.Body.Bytes(), &assetBody); err != nil {
		t.Fatal(err)
	}
	assetID := assetBody.Data.ID

	preview := performJSON(router, http.MethodPost, "/api/comic-asset-projects/"+projectID+"/assets/"+assetID+"/prompt-preview?scope=personal", `{}`, nil)
	if preview.Code != http.StatusOK || !containsJSONText(preview.Body.String(), "原始提示词") {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body.String())
	}
	approved := performJSON(router, http.MethodPut, "/api/comic-asset-projects/"+projectID+"/assets/"+assetID+"/prompt?scope=personal", `{"content":"批准后的完整提示词","source":"manual","action":"approve"}`, nil)
	if approved.Code != http.StatusOK || !containsJSONText(approved.Body.String(), model.ComicPromptStatusApproved) {
		t.Fatalf("approve status=%d body=%s", approved.Code, approved.Body.String())
	}

	createdBatch := performJSON(router, http.MethodPost, "/api/comic-asset-projects/"+projectID+"/generation-batches?scope=personal", `{"asset_ids":["`+assetID+`"],"model_selector":"provider::image-v1","size":"1:1","quality":"high","variants_per_asset":2,"output_format":"png","system_prompt":"统一风格","asset_configs":[{"asset_id":"`+assetID+`","model_selector":"provider::image-v1","size":"1024x1536","quality":"medium","variants":2,"output_format":"png","system_prompt":"统一风格","reference_asset_ids":[]}],"concurrency":2}`, nil)
	if createdBatch.Code != http.StatusAccepted {
		t.Fatalf("create batch status=%d body=%s", createdBatch.Code, createdBatch.Body.String())
	}
	var batchBody struct {
		Data service.ComicBatchDetail `json:"data"`
	}
	if err := json.Unmarshal(createdBatch.Body.Bytes(), &batchBody); err != nil {
		t.Fatal(err)
	}
	if batchBody.Data.Batch.Total != 2 || batchBody.Data.Items[0].PromptSnapshot != "批准后的完整提示词" || batchBody.Data.Items[1].VariantIndex != 2 {
		t.Fatalf("batch=%+v items=%+v", batchBody.Data.Batch, batchBody.Data.Items)
	}
	var snapshot service.ComicGenerationConfigSnapshot
	if err := json.Unmarshal(batchBody.Data.Items[0].ConfigSnapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Size != "1024x1536" || snapshot.Quality != "medium" || snapshot.SystemPrompt != "统一风格" {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	loadedBatch := performJSON(router, http.MethodGet, "/api/comic-asset-generation-batches/"+batchBody.Data.Batch.ID+"?scope=personal", "", nil)
	if loadedBatch.Code != http.StatusOK {
		t.Fatalf("get batch status=%d body=%s", loadedBatch.Code, loadedBatch.Body.String())
	}
}

func TestComicAssetHandlerImportsProjectAndServesSource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	comicService := service.NewComicAssetService(repository.NewMemoryComicAssetRepository(), service.NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3))
	comicService.SetSourceStorage(storage.NewLocalFSStorage(t.TempDir()))
	handler := NewComicAssetHandler(comicService)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "user_a", Username: "user_a"})
		c.Next()
	})
	router.POST("/api/comic-asset-projects/import", handler.ImportProject)
	router.GET("/api/comic-asset-projects/:projectId/source", handler.ProjectSource)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	payload := `{"style_preset":"3D动漫PBR","source_type":"script","assets":[{"code":"C001","class":"character","name":"赵瑾","visual_description":"灰色风衣"}]}`
	if err := writer.WriteField("payload", payload); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("source_file", "剧本.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("雨夜，赵瑾走进巷子。"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/comic-asset-projects/import?scope=personal", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("import status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var imported struct {
		Data service.ComicProjectDetail `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if imported.Data.Project.Title != "剧本" || imported.Data.Project.SourceFileName != "剧本.txt" || len(imported.Data.Assets) != 1 {
		t.Fatalf("imported=%+v", imported.Data)
	}
	source := httptest.NewRecorder()
	router.ServeHTTP(source, httptest.NewRequest(http.MethodGet, "/api/comic-asset-projects/"+imported.Data.Project.ID+"/source?scope=personal", nil))
	if source.Code != http.StatusOK || source.Body.String() != "雨夜，赵瑾走进巷子。" {
		t.Fatalf("source status=%d body=%q", source.Code, source.Body.String())
	}
}

func TestComicProjectImportTitlePrefersExplicitTitle(t *testing.T) {
	if got := comicProjectImportTitle("  自定义项目名  ", `C:\fakepath\来源剧本.docx`); got != "自定义项目名" {
		t.Fatalf("explicit title=%q", got)
	}
	if got := comicProjectImportTitle("", `C:\fakepath\来源剧本.docx`); got != "来源剧本" {
		t.Fatalf("fallback title=%q", got)
	}
}

func containsJSONText(body string, value string) bool {
	return len(value) > 0 && len(body) >= len(value) && json.Valid([]byte(body)) && stringContains(body, value)
}

func stringContains(value string, part string) bool {
	for index := 0; index+len(part) <= len(value); index++ {
		if value[index:index+len(part)] == part {
			return true
		}
	}
	return false
}
