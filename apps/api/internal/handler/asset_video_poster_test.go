package handler

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestVideoPosterAuthorizesOwnerAndNeverReturnsOriginal(t *testing.T) {
	root := t.TempDir()
	router := newAssetTestRouter(t, root)
	owner := loginCookie(t, router, "owner", "secret")
	original := []byte("video-original")
	upload := uploadAsset(t, router, owner, "video", "sample.mp4", "video/mp4", original)
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status %d", upload.Code)
	}
	id := responseAssetID(t, upload)
	url := "/api/assets/" + id + "/content?poster=1"
	if missing := performJSON(router, http.MethodGet, url, "", owner); missing.Code != http.StatusNotFound {
		t.Fatal("missing poster downloaded original")
	}
	folder := filepath.Join(root, videoPosterDirectory)
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	poster := []byte("\xff\xd8preview\xff\xd9")
	name := videoPosterName(id, fmt.Sprintf("%x", sha256.Sum256(original)))
	if err := os.WriteFile(filepath.Join(folder, name), poster, 0644); err != nil {
		t.Fatal(err)
	}
	res := performJSON(router, http.MethodGet, url, "", owner)
	if res.Code != http.StatusOK || res.Body.String() != string(poster) || res.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("poster status %d", res.Code)
	}
	other := loginCookie(t, router, "other", "secret")
	if denied := performJSON(router, http.MethodGet, url, "", other); denied.Code != http.StatusNotFound {
		t.Fatal("poster bypassed ownership")
	}
}
