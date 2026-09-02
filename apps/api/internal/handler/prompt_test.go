package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type promptListStub struct {
	query service.PromptListQuery
}

func (s *promptListStub) List(_ context.Context, query service.PromptListQuery) (service.PromptListPayload, error) {
	s.query = query
	return service.PromptListPayload{Items: []service.SystemPrompt{{ID: "prompt-1"}}, Tags: []string{"tag-a"}, Categories: []string{"category-a"}, Total: 1}, nil
}

func TestPromptHandlerReturnsFrozenStudioPayloadShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &promptListStub{}
	router := gin.New()
	router.GET("/api/prompts", NewPromptHandler(stub).List)
	request := httptest.NewRequest(http.MethodGet, "/api/prompts?keyword=night&tag=a&tag=b&category=photo&page=2&pageSize=50", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, wrapped := body["data"]; wrapped {
		t.Fatalf("prompt payload must remain unwrapped for frozen Studio: %s", recorder.Body.String())
	}
	if _, ok := body["items"]; !ok {
		t.Fatalf("items missing from payload: %s", recorder.Body.String())
	}
	if stub.query.Keyword != "night" || stub.query.Category != "photo" || stub.query.Page != 2 || stub.query.PageSize != 50 || len(stub.query.Tags) != 2 {
		t.Fatalf("unexpected query: %+v", stub.query)
	}
}
