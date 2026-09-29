package monitoring

import (
	"strings"
	"testing"
)

func TestDiagnosticsKeepObservedErrorsWithoutPayloads(t *testing.T) {
	raw := `{"error":{"code":"InvalidAudio","message":"audio duration exceeds limit","param":"audio","request_id":"vendor-42"},"prompt":"PRIVATE_PROMPT","data":"BASE64_MEDIA","output":{"url":"https://host/result","b64_json":"PRIVATE_MEDIA"},"api_key":"SECRET"}`
	d := ReadDiagnostics(Diagnostics{ProviderBody: raw, ProviderURL: "https://u:SECRET@host/api?token=SECRET", ResponseReceived: Bool(false)}.JSON())
	for _, secret := range []string{"PRIVATE", "SECRET", "BASE64", "result"} {
		if strings.Contains(string(d.JSON()), secret) {
			t.Fatal("retained payload", string(d.JSON()))
		}
	}
	if !strings.Contains(d.ProviderBody, "audio duration exceeds limit") || d.ResponseReceived == nil || *d.ResponseReceived {
		t.Fatal(d)
	}
	code, id := ErrorIdentifiers(raw)
	if code != "InvalidAudio" || id != "vendor-42" {
		t.Fatal(code, id)
	}
	if got := ErrorBody(`{"data":[{"b64_json":"PRIVATE"}],"output":"PRIVATE"}`); got != "" {
		t.Fatal(got)
	}
	if got := ErrorBody("upstream connect error"); got != "upstream connect error" {
		t.Fatal(got)
	}
	if got := ErrorBody(`{"prompt":"PRIVATE","error":`); got != "" {
		t.Fatal(got)
	}
}

func TestErrorBodyRemainsReadableAfterPersistenceSanitization(t *testing.T) {
	raw := `{"error":{"code":"invalid","message":"actual error token=SECRET"}}`
	once := ErrorBody(raw)
	twice := ErrorBody(once)
	if !strings.Contains(twice, "actual error") || strings.Contains(twice, "SECRET") {
		t.Fatal(once, twice)
	}
	long := ErrorBody(`{"error":{"message":"` + strings.Repeat("actual error ", 700) + `"}}`)
	if again := ErrorBody(long); !strings.Contains(again, "actual error") {
		t.Fatal("lost bounded excerpt", again)
	}
	for _, raw := range []string{`{"msg":"actual rejection"}`, `{"Response":{"Error":{"Code":"Denied","Message":"actual rejection"}}}`, `{"errorMessage":"actual rejection"}`} {
		if got := ErrorBody(raw); !strings.Contains(got, "actual rejection") {
			t.Fatal(got)
		}
	}
}

func TestValidationLocationsAndVendorIdentifiersRemainExact(t *testing.T) {
	raw := `{"Response":{"Error":{"Code":422,"Message":"invalid audio"},"RequestId":"real-id"},"detail":[{"loc":["body","audio",0],"type":"less_than_equal","ctx":{"le":30},"input":"PRIVATE"}],"success":false}`
	code, id := ErrorIdentifiers(raw)
	if code != "422" || id != "real-id" {
		t.Fatal(code, id)
	}
	body := ErrorBody(raw)
	for _, expected := range []string{`"loc":["body","audio",0]`, `"le":30`, `"success":false`} {
		if !strings.Contains(body, expected) {
			t.Fatal(body)
		}
	}
	if strings.Contains(body, "PRIVATE") {
		t.Fatal(body)
	}
}
