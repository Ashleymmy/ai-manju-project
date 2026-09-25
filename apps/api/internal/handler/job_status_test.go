package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/queue"
)

func TestJobStatusViewKeepsFullReadCompatible(t *testing.T) {
	router := newJobTestRouter(&queue.MemoryProducer{})
	body := `{"type":"video.generate","payload":{"model":"test","content":[{"image_url":"data:image/png;base64,` + strings.Repeat("a", 1024*1024) + `"}],"asset_registration":{"source_node_id":"node","source_project_id":"canvas"}}}`
	created := performJobRequest(router, body, "status-view")
	if created.Code != http.StatusAccepted {
		t.Fatalf("create status=%d", created.Code)
	}
	id := extractJobID(t, created.Body.Bytes())
	for _, path := range []string{"/jobs/" + id + "?view=status", "/jobs?view=status&type=video.generate&limit=1"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK || recorder.Body.Len() > 4000 || !strings.Contains(recorder.Body.String(), `"source_node_id":"node"`) || strings.Contains(recorder.Body.String(), "base64") {
			t.Fatalf("invalid compact response: code=%d bytes=%d", recorder.Code, recorder.Body.Len())
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/jobs/"+id, nil))
	if recorder.Body.Len() < 1024*1024 {
		t.Fatal("default full payload contract changed")
	}
	var parsed map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["success"] != true {
		t.Fatal("response envelope changed")
	}
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/jobs/"+id+"/cancel?view=status", nil))
	if recorder.Code != http.StatusOK || recorder.Body.Len() > 4000 || !strings.Contains(recorder.Body.String(), `"status":"canceled"`) {
		t.Fatal("cancel status view failed")
	}
}
