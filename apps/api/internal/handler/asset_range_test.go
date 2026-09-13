package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAssetContentRangePreservesAuthorizationAndValidators(t *testing.T) {
	router := newAssetTestRouter(t, t.TempDir())
	owner := loginCookie(t, router, "owner", "secret")
	other := loginCookie(t, router, "other", "secret")
	body := []byte("\x89PNG\r\n\x1a\nasset-bytes")
	created := uploadAsset(t, router, owner, "image", "sample.png", "image/png", body)
	if created.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", created.Code, created.Body.String())
	}
	var envelope struct{ Data struct{ ID string } }
	if err := json.Unmarshal(created.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	path := "/api/assets/" + envelope.Data.ID + "/content"
	request := func(cookie *http.Cookie, span, ifRange string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.AddCookie(cookie)
		r.Header.Set("Range", span)
		r.Header.Set("If-Range", ifRange)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	partial := request(owner, "bytes=0-7", "")
	if partial.Code != 206 || partial.Body.String() != string(body[:8]) || partial.Header().Get("Content-Range") != "bytes 0-7/19" {
		t.Fatalf("partial: %d %v %q", partial.Code, partial.Header(), partial.Body.String())
	}
	if got := request(owner, "bytes=-5", partial.Header().Get("ETag")); got.Code != 206 || got.Body.String() != "bytes" {
		t.Fatalf("suffix: %d %q", got.Code, got.Body.String())
	}
	if got := request(owner, "bytes=0-7", `"stale"`); got.Code != 200 || got.Body.String() != string(body) {
		t.Fatalf("stale If-Range: %d %q", got.Code, got.Body.String())
	}
	if got := request(owner, "bytes=200-300", ""); got.Code != 416 || got.Header().Get("Content-Range") != "bytes */19" {
		t.Fatalf("unsatisfiable: %d %v", got.Code, got.Header())
	}
	if got := request(other, "bytes=0-7", ""); got.Code != 404 || got.Header().Get("Content-Range") != "" {
		t.Fatalf("owner isolation: %d %v", got.Code, got.Header())
	}
}
