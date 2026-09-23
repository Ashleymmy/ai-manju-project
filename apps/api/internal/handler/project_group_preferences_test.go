package handler

import (
	"net/http"
	"testing"
)

func TestProjectGroupsPersistAndProtectOtherPreferences(t *testing.T) {
	router, _, user, other, _ := newUserPreferenceTestRouter(t)
	payload := `{"expectedProjectGroups":{},"canvas":{"projectGroups":{"personal":[{"id":"g1","title":"角色","projectIds":["p1","p2"]}],"team":[]}}}`
	saved := performJSON(router, http.MethodPut, "/api/user/preferences", payload, user)
	if saved.Code != http.StatusOK {
		t.Fatalf("save: %d %s", saved.Code, saved.Body.String())
	}
	read := performJSON(router, http.MethodGet, "/api/user/preferences", "", user)
	groups := decodeUserPreferences(t, read.Body.String()).Canvas["projectGroups"].(map[string]any)
	if len(groups["personal"].([]any)) != 1 {
		t.Fatal(groups)
	}
	stale := performJSON(router, http.MethodPut, "/api/user/preferences", payload, user)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale save: %d", stale.Code)
	}
	update := performJSON(router, http.MethodPut, "/api/user/preferences", `{"canvas":{"backgroundMode":"dots"}}`, user)
	if update.Code != http.StatusOK || decodeUserPreferences(t, update.Body.String()).Canvas["projectGroups"] == nil {
		t.Fatal("settings erased groups")
	}
	isolated := performJSON(router, http.MethodGet, "/api/user/preferences", "", other)
	if decodeUserPreferences(t, isolated.Body.String()).Canvas["projectGroups"] != nil {
		t.Fatal("groups leaked across accounts")
	}
	for _, invalid := range []string{`{"personal":"bad"}`, `{"personal":[{"id":"g","title":"","projectIds":[]}]}`, `{"personal":[{"id":"g","title":"x","projectIds":["p","p"]}]}`} {
		result := performJSON(router, http.MethodPut, "/api/user/preferences", `{"canvas":{"projectGroups":`+invalid+`}}`, user)
		if result.Code != http.StatusBadRequest {
			t.Fatalf("invalid accepted: %s", invalid)
		}
	}
	removed := performJSON(router, http.MethodPut, "/api/user/preferences", `{"canvas":{"projectGroups":{"personal":[],"team":[]}}}`, user)
	if removed.Code != http.StatusOK {
		t.Fatal(removed.Body.String())
	}
}
