package providerhub

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDocumentValidation(t *testing.T) {
	valid := `{"schema_version":1,"adapter":"studio","config":{"name":"demo","base_url":"http://localhost:8000/v1","capabilities":["video"],"models_by_capability":{"video":["test-model"]},"endpoint_overrides":{"video_create":"/tasks","video_get":"/tasks/{id}"}}}`
	if _, err := Parse([]byte(valid), "studio"); err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string]string{
		"non-object":  `[]`,
		"version":     strings.Replace(valid, `"schema_version":1`, `"schema_version":2`, 1),
		"adapter":     strings.Replace(valid, `"adapter":"studio"`, `"adapter":"sdvideo"`, 1),
		"credential":  strings.Replace(valid, `"name":"demo"`, `"api_key":"private-test-value","name":"demo"`, 1),
		"header":      strings.Replace(valid, `"name":"demo"`, `"extra_headers":{"Authorization":"private-test-value"},"name":"demo"`, 1),
		"nested-type": strings.Replace(valid, `["test-model"]`, `[{"token":"private-test-value"}]`, 1),
		"unknown":     strings.Replace(valid, `"name":"demo"`, `"polling":{},"name":"demo"`, 1),
		"null":        strings.Replace(valid, `["test-model"]`, `null`, 1),
		"url-secret":  strings.Replace(valid, `localhost:8000/v1`, `localhost:8000/v1?api_key=private-test-value`, 1),
		"pollution":   strings.Replace(valid, `"name":"demo"`, `"__proto__":{},"name":"demo"`, 1),
		"oversize":    strings.Repeat(" ", MaxDocumentBytes) + valid,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Parse([]byte(raw), "studio")
			if err == nil {
				t.Fatal("invalid document accepted")
			}
			if strings.Contains(err.Error(), "private-test-value") {
				t.Fatal("error leaks a credential")
			}
		})
	}
}

func TestManagedDocumentKeepsModelIdentityAndVersion(t *testing.T) {
	raw := `{"schema_version":1,"adapter":"sdvideo","config":{"sdvideo_models":[{"key":"seedance-2.5","name":"company","model_id":"upstream","enabled":true,"version":4,"concurrency_limit":3}]}}`
	doc, err := Parse([]byte(raw), "sdvideo")
	if err != nil {
		t.Fatal(err)
	}
	var cfg managedConfig
	if err := json.Unmarshal(doc.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Models[0].Version != 4 || cfg.Models[0].Key != "seedance-2.5" {
		t.Fatal("identity lost")
	}
	for _, invalid := range []string{
		strings.Replace(raw, `"version":4`, `"version":0`, 1),
		strings.Replace(raw, `"enabled":true`, `"enabled":null`, 1),
		strings.Replace(raw, `"name":"company"`, `"upstream_provider":"tokenspace","name":"company"`, 1),
	} {
		if _, err := Parse([]byte(invalid), "sdvideo"); err == nil {
			t.Fatal("invalid managed config accepted")
		}
	}
}
