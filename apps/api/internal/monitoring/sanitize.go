package monitoring

import (
	"net/url"
	"regexp"
	"strings"
)

// Bound untrusted diagnostic text and capture buffers without retaining bodies.
const MaxTextRunes = 4000
const MaxCaptureBytes = 32 * 1024
const AIRecordedKey = "monitoring_ai_recorded"
const PanicStackKey = "monitoring_panic_stack"

var secretPattern = regexp.MustCompile(`(?i)(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)`)
var bearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+`)
var keyPattern = regexp.MustCompile(`\b(?:sk-|sess-)[A-Za-z0-9_-]{8,}`)
var urlPattern = regexp.MustCompile(`https?://[^\s<>"']+`)
var dataPattern = regexp.MustCompile(`(?i)data:[^\s"']+`)

func SafeText(value string) string {
	value = dataPattern.ReplaceAllString(value, "[media redacted]")
	value = urlPattern.ReplaceAllStringFunc(value, func(raw string) string {
		u, err := url.Parse(raw)
		if err != nil {
			return "[url redacted]"
		}
		u.User, u.RawQuery, u.Fragment = nil, "", ""
		return u.String()
	})
	value = bearerPattern.ReplaceAllString(value, "Bearer [redacted]")
	value = secretPattern.ReplaceAllString(value, "${1}[redacted]")
	value = keyPattern.ReplaceAllString(value, "[redacted]")
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > MaxTextRunes {
		return string(runes[:MaxTextRunes]) + " [truncated]"
	}
	return string(runes)
}
