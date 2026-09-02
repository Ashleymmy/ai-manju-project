package queue

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestCeleryMessagePayloadUsesV2Envelope(t *testing.T) {
	payload, err := celeryMessagePayload(TaskMessage{
		TaskName: "worker.image_generate",
		Queue:    "celery",
		JobID:    "job_1",
		Payload:  model.JSONB(`{"prompt":"hello"}`),
		Kwargs:   map[string]any{"provider": map[string]any{"api_key": "short-lived"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	headers := envelope["headers"].(map[string]any)
	if headers["task"] != "worker.image_generate" || headers["id"] != "job_1" {
		t.Fatalf("headers = %+v", headers)
	}
	properties := envelope["properties"].(map[string]any)
	if properties["delivery_tag"] != "job_1" {
		t.Fatalf("properties = %+v", properties)
	}
	body, err := base64.StdEncoding.DecodeString(envelope["body"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(body) {
		t.Fatalf("body is not json: %s", body)
	}
	var bodyTuple []any
	if err := json.Unmarshal(body, &bodyTuple); err != nil {
		t.Fatal(err)
	}
	kwargs := bodyTuple[1].(map[string]any)
	provider := kwargs["provider"].(map[string]any)
	if provider["api_key"] != "short-lived" {
		t.Fatalf("kwargs = %+v", kwargs)
	}
}
