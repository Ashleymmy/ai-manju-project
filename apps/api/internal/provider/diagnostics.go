package provider

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/monitoring"
)

// Only sanitized error-envelope fields are kept in the request context. This
// also covers HTTP 200 responses rejected by a later normalizer. The handler
// persists them only if the operation actually fails; retry semantics stay intact.
func observeProviderExchange(req *http.Request, resp *http.Response, body []byte, err error) {
	raw := ""
	if resp != nil {
		if isProviderSSEResponse(body, resp.Header.Get("Content-Type")) {
			events, _ := parseProviderSSEEvents(body)
			for _, event := range events {
				var value any
				_ = json.Unmarshal(event.data, &value)
				if providerPayloadErrorMessage(value) != "" || strings.Contains(strings.ToLower(event.name), "error") || strings.Contains(strings.ToLower(topLevelString(value, "type")), "error") {
					raw = string(event.data)
					break
				}
			}
		} else if json.Valid(body) || strings.Contains(resp.Header.Get("Content-Type"), "json") || strings.HasPrefix(resp.Header.Get("Content-Type"), "text/") || (resp.StatusCode >= 400 && resp.Header.Get("Content-Type") == "") {
			raw = string(body)
		}
	}
	monitoring.ObserveFailure(req, resp, raw, err)
}
