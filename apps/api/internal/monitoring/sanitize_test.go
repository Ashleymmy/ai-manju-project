package monitoring

import (
	"strings"
	"testing"
)

func TestSafeText(t *testing.T) {
	for _, input := range []string{`Authorization: Bearer abc123SECRET`, `{"api_key":"abc123SECRET"}`, `password='abc123SECRET'`, `https://name:abc123SECRET@host/path?token=abc123SECRET#abc123SECRET`, `sk-abc123SECRET`, `data:image/png;base64,abc123SECRET`} {
		if got := SafeText(input); strings.Contains(got, "abc123SECRET") {
			t.Errorf("credential retained: %s", got)
		}
	}
	if got := SafeText("模型超时 HTTP 504"); got != "模型超时 HTTP 504" {
		t.Fatal(got)
	}
	if len([]rune(SafeText(strings.Repeat("好", 10000)))) > MaxTextRunes+20 {
		t.Fatal("unbounded text")
	}
}
