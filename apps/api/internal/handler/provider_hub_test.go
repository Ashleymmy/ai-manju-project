package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestProviderHubDocumentUsesLiveConfigurationAndPreservesKey(t *testing.T) {
	var usedModel, usedAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/custom/chat/completions" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		usedModel, _ = body["model"].(string)
		usedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer upstream.Close()
	router, repo := newProviderTestRouter(t, "test-secret")
	admin := loginCookie(t, router, "admin", "secret")
	initial := `{"base_url":"` + upstream.URL + `/v1","auth_type":"bearer","api_key":"test-private-key","text_model":"old","enabled":true}`
	if res := performJSON(router, http.MethodPut, "/api/admin/model-provider", initial, admin); res.Code != 200 {
		t.Fatalf("initial: %s", res.Body.String())
	}
	document := `{"config_document":{"schema_version":1,"adapter":"studio","config":{"name":"hub demo","base_url":"` + upstream.URL + `/v1","capabilities":["text"],"text_model":"new","models_by_capability":{"text":["new"]},"endpoint_overrides":{"text_generation":"/custom/chat/completions"}}}}`
	res := performJSON(router, http.MethodPut, "/api/admin/model-providers/default", document, admin)
	if res.Code != 200 {
		t.Fatalf("save: %s", res.Body.String())
	}
	if strings.Contains(res.Body.String(), "test-private-key") {
		t.Fatal("key leaked")
	}
	stored, _ := repo.GetModelProvider(model.ModelProviderIDDefault)
	if stored.TextModel != "new" || stored.APIKeyEncrypted == "" {
		t.Fatal("document failed to update the live configuration or lost key")
	}
	res = performJSON(router, http.MethodPost, "/api/ai/text", `{"model":"new","messages":[{"role":"user","content":"local mock"}]}`, admin)
	if res.Code != 200 {
		t.Fatalf("generation: %s", res.Body.String())
	}
	if usedModel != "new" || usedAuth != "Bearer test-private-key" {
		t.Fatal("runtime did not use the saved document and existing credentials")
	}
	member := loginCookie(t, router, "member", "secret")
	for _, cookie := range []*http.Cookie{nil, member} {
		denied := performJSON(router, http.MethodPut, "/api/admin/model-providers/default", document, cookie)
		if denied.Code != 401 && denied.Code != 403 {
			t.Fatalf("non-admin status=%d", denied.Code)
		}
	}
	invalid := strings.Replace(document, `"name":"hub demo"`, `"name":"hub demo","api_key":"must-not-leak"`, 1)
	res = performJSON(router, http.MethodPut, "/api/admin/model-providers/default", invalid, admin)
	if res.Code != 400 || strings.Contains(res.Body.String(), "must-not-leak") {
		t.Fatal("unsafe document rejection failed")
	}
	after, _ := repo.GetModelProvider(model.ModelProviderIDDefault)
	if after.UpdatedAt != stored.UpdatedAt {
		t.Fatal("rejected document mutated stored configuration")
	}
}
