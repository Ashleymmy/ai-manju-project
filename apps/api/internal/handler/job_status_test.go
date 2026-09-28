package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
)

func TestJobResponsesNeverExposeWorkerRecoveryState(t *testing.T) {
	raw := model.JSONB(`{"task_status":"processing","_worker_video_checkpoint":{"task_id":"private-task","result":{"outputs":[{"path":"private-path"}]}},"_worker_future_private":true}`)
	job := model.Job{ID: "job", BridgeMetadata: raw}
	response := jobResponse(job)
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private") || strings.Contains(string(encoded), "_worker_") || !strings.Contains(string(encoded), `"task_status":"processing"`) {
		t.Fatal("private recovery state leaked or public bridge fields removed")
	}
	if string(job.BridgeMetadata) != string(raw) {
		t.Fatal("filter changed stored checkpoint")
	}
}

func TestJobRecoveryParametersRequireBoundedNodeSetAndFilterCanvas(t *testing.T) {
	router := newJobTestRouter(&queue.MemoryProducer{})
	created := performJobRequest(router, `{"type":"video.generate","payload":{"project_id":"canvas","node_id":"video"}}`, "recovery-one")
	id := extractJobID(t, created.Body.Bytes())
	for _, tc := range []struct {
		path   string
		status int
		match  bool
	}{
		{"/jobs?view=status&latest_per_node=true", 400, false},
		{"/jobs?view=status&latest_per_node=true&source_node_ids=" + strings.TrimSuffix(strings.Repeat("node,", 31), ","), 200, false},
		{"/jobs?view=status&latest_per_node=true&source_node_ids=video&project_id=canvas", 200, true},
		{"/jobs?view=status&latest_per_node=true&source_node_ids=video&project_id=other", 200, false},
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.status || strings.Contains(rec.Body.String(), id) != tc.match {
			t.Fatalf("%s: code=%d body=%s", tc.path, rec.Code, rec.Body.String())
		}
	}
	ids := make([]string, 31)
	for i := range ids {
		ids[i] = fmt.Sprint("node-", i)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/jobs?view=status&latest_per_node=true&source_node_ids="+strings.Join(ids, ","), nil))
	if rec.Code != 400 {
		t.Fatalf("unbounded recovery accepted: %d", rec.Code)
	}
}

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
