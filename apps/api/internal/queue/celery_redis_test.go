package queue

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestLargeCeleryMessageKeepsMediaAndProviderConfiguration(t *testing.T) {
	media := "data:video/mp4;base64," + strings.Repeat("eHl6", celeryCompressionThreshold)
	raw, _ := json.Marshal(map[string]any{"model": "video", "content": media})
	message, err := celeryMessagePayload(TaskMessage{TaskName: "worker.video_generate", Queue: "celery", JobID: "job_codec_probe",
		Payload: model.JSONB(raw), Kwargs: map[string]any{"provider_candidates": []map[string]any{{"model": "video", "api_key": "synthetic-key"}}, "generation_soft_timeout_seconds": 1200}})
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(message, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["headers"].(map[string]any)["compression"] != "application/x-gzip" {
		t.Fatal("missing Kombu codec header")
	}
	compressed, err := base64.StdEncoding.DecodeString(envelope["body"].(string))
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zlib.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	var tuple []json.RawMessage
	if err := json.Unmarshal(body, &tuple); err != nil {
		t.Fatal(err)
	}
	var kwargs struct {
		Payload struct {
			Content string `json:"content"`
		} `json:"payload"`
		Candidates []map[string]any `json:"provider_candidates"`
	}
	if err := json.Unmarshal(tuple[1], &kwargs); err != nil {
		t.Fatal(err)
	}
	if kwargs.Payload.Content != media || len(kwargs.Candidates) != 1 || kwargs.Candidates[0]["api_key"] != "synthetic-key" {
		t.Fatal("media or configuration changed")
	}
	if len(message) >= len(raw)/2 {
		t.Fatal("large redundant media was not compressed")
	}
	// Optional synthetic fixture for a real Kombu decoder check; never contains customer data.
	if path := os.Getenv("CELERY_CODEC_FIXTURE_PATH"); path != "" {
		if err := os.WriteFile(path, message, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

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
	if properties["correlation_id"] != "job_1" || properties["delivery_tag"] == "" || properties["delivery_tag"] == "job_1" {
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

func TestRepeatedCeleryPublishKeepsTaskIdentityWithDistinctDeliveryTags(t *testing.T) {
	message := TaskMessage{TaskName: "worker.video_generate", Queue: "celery", JobID: "job_delivery_probe", Payload: model.JSONB(`{"prompt":"synthetic delivery probe"}`)}
	seenTags := make(map[string]bool)
	var fixtures []json.RawMessage
	var firstBody string
	for i := 0; i < 32; i++ {
		raw, err := celeryMessagePayload(message)
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Body    string `json:"body"`
			Headers struct {
				ID     string `json:"id"`
				RootID string `json:"root_id"`
			} `json:"headers"`
			Properties struct {
				DeliveryTag   string `json:"delivery_tag"`
				CorrelationID string `json:"correlation_id"`
			} `json:"properties"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Headers.ID != message.JobID || envelope.Headers.RootID != message.JobID || envelope.Properties.CorrelationID != message.JobID {
			t.Fatal("redelivery changed the business task identity")
		}
		tag := envelope.Properties.DeliveryTag
		if tag == "" || tag == message.JobID || seenTags[tag] {
			t.Fatal("redelivery reused the Redis acknowledgement identity")
		}
		seenTags[tag] = true
		if i == 0 {
			firstBody = envelope.Body
		} else if envelope.Body != firstBody {
			t.Fatal("redelivery changed the task arguments")
		}
		if i < 2 {
			fixtures = append(fixtures, raw)
		}
	}
	// Optional synthetic fixture for the existing Worker's actual Kombu QoS.
	if path := os.Getenv("CELERY_DELIVERY_FIXTURE_PATH"); path != "" {
		raw, err := json.Marshal(fixtures)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGenerationDeliveryGetsExtendedTimeLimits(t *testing.T) {
	payload, err := celeryMessagePayload(TaskMessage{JobID: "job_time", Kwargs: map[string]any{"generation_soft_timeout_seconds": 1200}})
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	limits := envelope["headers"].(map[string]any)["timelimit"].([]any)
	if limits[0] != float64(1260) || limits[1] != float64(1200) {
		t.Fatalf("limits=%v", limits)
	}
}
