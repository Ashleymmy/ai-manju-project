package monitoring

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// Structured diagnostics contain observed facts, never submitted prompts/files
// or authorization headers. Pointer booleans distinguish false from unrecorded.
type Diagnostics struct {
	Stage                    string `json:"stage,omitempty"`
	PagePath                 string `json:"page_path,omitempty"`
	ExceptionName            string `json:"exception_name,omitempty"`
	ExceptionMessage         string `json:"exception_message,omitempty"`
	Stack                    string `json:"stack,omitempty"`
	TimeoutMS                int64  `json:"timeout_ms,omitempty"`
	Online                   *bool  `json:"online,omitempty"`
	ResponseReceived         *bool  `json:"response_received,omitempty"`
	ResponseBody             string `json:"response_body,omitempty"`
	ProviderResponseReceived *bool  `json:"provider_response_received,omitempty"`
	ProviderURL              string `json:"provider_url,omitempty"`
	ProviderMethod           string `json:"provider_method,omitempty"`
	ProviderRequestID        string `json:"provider_request_id,omitempty"`
	ProviderBody             string `json:"provider_body,omitempty"`
	ProviderCode             string `json:"provider_code,omitempty"`
	ReportRequestID          string `json:"report_request_id,omitempty"`
}

const (
	DiagnosticsKey = "monitoring_diagnostics"
	// Bound nested provider error envelopes independently of HTTP payload sizes.
	maxErrorDepth = 6
	maxErrorItems = 20
)

func Bool(value bool) *bool { return &value }

func (d Diagnostics) JSON() model.JSONB {
	d.Stage, d.PagePath = SafeText(d.Stage), SafeText(strings.SplitN(strings.SplitN(d.PagePath, "?", 2)[0], "#", 2)[0])
	d.ExceptionName, d.ExceptionMessage, d.Stack = SafeText(d.ExceptionName), SafeText(d.ExceptionMessage), SafeText(d.Stack)
	d.ProviderURL, d.ProviderMethod = SafeText(d.ProviderURL), SafeText(d.ProviderMethod)
	d.ProviderRequestID, d.ProviderCode, d.ReportRequestID = SafeText(d.ProviderRequestID), SafeText(d.ProviderCode), SafeText(d.ReportRequestID)
	d.ProviderBody, d.ResponseBody = ErrorBody(d.ProviderBody), ErrorBody(d.ResponseBody)
	if d.TimeoutMS < 0 {
		d.TimeoutMS = 0
	}
	data, _ := json.Marshal(d)
	return model.JSONB(data)
}

func ReadDiagnostics(raw model.JSONB) Diagnostics {
	var d Diagnostics
	_ = json.Unmarshal(raw, &d)
	return d
}

// Only error fields from JSON responses are retained. Full success payloads,
// echoed requests, media and secret fields must not become diagnostic records.
func ErrorBody(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	var data any
	if json.Unmarshal([]byte(raw), &data) == nil {
		data = errorFields(data, 0)
		if data == nil {
			return ""
		}
		encoded, _ := json.Marshal(data)
		// Values were sanitized before serialization. Sanitizing serialized JSON
		// again can break its quotes around a redacted credential.
		runes := []rune(string(encoded))
		if len(runes) > MaxTextRunes {
			// A JSON string stores a bounded excerpt without inventing error fields.
			encoded, _ = json.Marshal(string(runes[:MaxTextRunes]) + " [truncated]")
		}
		return string(encoded)
	}
	// A truncated JSON payload cannot be filtered safely; it may contain media
	// or an echoed request before the actual error fields.
	if strings.HasPrefix(strings.TrimSpace(raw), "{") || strings.HasPrefix(strings.TrimSpace(raw), "[") {
		return ""
	}
	return SafeText(raw)
}

func errorFields(value any, depth int) any {
	if depth > maxErrorDepth {
		return nil
	}
	switch v := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, child := range v {
			if strings.EqualFold(key, "output") || strings.EqualFold(key, "data") || strings.EqualFold(key, "response") {
				// Containers may hold nested failures, never retain generated media.
				if _, ok := child.(map[string]any); !ok {
					continue
				}
			}
			switch strings.ToLower(key) {
			case "error", "errors", "error_message", "errormessage", "error_code", "errorcode", "error_name", "message", "msg", "description", "error_description", "detail", "details", "reason", "code", "type", "param", "status", "status_code", "statuscode", "success", "request_id", "requestid", "trace_id", "traceid", "suggestion", "retry_after", "title", "output", "data", "response", "loc", "field", "ctx", "limit_value", "min_length", "max_length", "ge", "gt", "le", "lt", "expected", "actual_length":
				if filtered := errorFields(child, depth+1); filtered != nil {
					out[key] = filtered
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	case []any:
		out := []any{}
		for _, child := range v[:min(len(v), maxErrorItems)] {
			if filtered := errorFields(child, depth+1); filtered != nil {
				out = append(out, filtered)
			}
		}
		if len(out) > 0 {
			return out
		}
	case string:
		return SafeText(v)
	case float64, bool:
		return v
	}
	return nil
}

// Extract only explicitly supplied identifiers; do not derive codes from prose.
func ErrorIdentifiers(raw string) (code, requestID string) {
	var data map[string]any
	if json.Unmarshal([]byte(raw), &data) != nil {
		return
	}
	var visit func(map[string]any, int)
	visit = func(values map[string]any, depth int) {
		if depth > maxErrorDepth {
			return
		}
		lower := make(map[string]any, len(values))
		for key, value := range values {
			lower[strings.ToLower(key)] = value
		}
		for _, key := range []string{"error", "response", "data", "output"} {
			if child, ok := lower[key].(map[string]any); ok {
				visit(child, depth+1)
			}
		}
		for _, key := range []string{"code", "error_code", "errorcode"} {
			if code == "" {
				switch value := lower[key].(type) {
				case string:
					code = SafeText(value)
				case float64:
					code = strconv.FormatFloat(value, 'f', -1, 64)
				}
			}
		}
		for _, key := range []string{"request_id", "requestid", "trace_id", "traceid"} {
			if value, ok := lower[key].(string); ok && requestID == "" {
				requestID = SafeText(value)
			}
		}
	}
	visit(data, 0)
	return
}

func UpstreamRequestID(headers http.Header) string {
	for _, key := range []string{"X-Request-Id", "Request-Id", "X-Trace-Id", "X-Tt-Logid", "X-Amzn-Requestid"} {
		if value := headers.Get(key); value != "" {
			return SafeText(value)
		}
	}
	return ""
}
