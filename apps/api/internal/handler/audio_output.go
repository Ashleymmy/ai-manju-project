package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
)

// The speech endpoint returns binary media, never a successful HTML/login page
// or a JSON status envelope. Generic binary responses remain valid for raw PCM.
func validSpeechOutput(content []byte, contentType string) bool {
	if len(content) == 0 || json.Valid(content) {
		return false
	}
	typeName := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if typeName != "" && !strings.HasPrefix(typeName, "audio/") && typeName != "application/octet-stream" && typeName != "binary/octet-stream" && typeName != "application/ogg" {
		return false
	}
	sniffed := http.DetectContentType(bytes.TrimSpace(content))
	return !strings.HasPrefix(sniffed, "text/html") && !strings.Contains(sniffed, "xml")
}
