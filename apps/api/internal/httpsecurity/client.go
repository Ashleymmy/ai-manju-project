// Package httpsecurity separates credentialed provider requests from untrusted
// result downloads. Redirects must never move API keys to another origin.
package httpsecurity

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	maxRedirects          = 5
	connectTimeout        = 10 * time.Second
	responseHeaderTimeout = 30 * time.Second
)

var ErrMediaTarget = errors.New("media download target is not allowed")

// SameOrigin compares normalized schemes, hosts, and ports, rejecting userinfo.
func SameOrigin(a, b *url.URL) bool {
	return origin(a) != "" && origin(a) == origin(b)
}

func origin(u *url.URL) string {
	if u == nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return u.Scheme + "://" + net.JoinHostPort(strings.ToLower(strings.TrimSuffix(u.Hostname(), ".")), port)
}

// SameOriginRedirect stops before transmitting custom headers or a POST body
// to a different scheme, host, or port. Returning the 3xx response avoids URL
// errors that can contain a query-string API key.
func SameOriginRedirect(req *http.Request, via []*http.Request) error {
	if len(via) == 0 {
		return nil
	}
	if len(via) > maxRedirects || origin(req.URL) == "" || origin(req.URL) != origin(via[0].URL) {
		return http.ErrUseLastResponse
	}
	req.Header.Del("Referer")
	return nil
}

type ipResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type mediaTransport struct {
	resolver ipResolver
	trusted  map[string]bool
	dial     func(context.Context, string, string) (net.Conn, error)
}

// NewMediaClient uses a separately pinned connection for every redirect. Only
// origins explicitly configured by an administrator may address private hosts;
// cloud metadata/link-local endpoints are never allowed. Proxy environment
// variables cannot bypass the resolved-address policy.
func NewMediaClient(timeout time.Duration, trustedOrigins ...string) *http.Client {
	trusted := map[string]bool{}
	// Existing operator storage configuration is trusted, never request payloads.
	for _, key := range []string{"STUDIO_SUPABASE_URL", "STUDIO_SUPABASE_PUBLIC_URL", "STUDIO_OSS_ENDPOINT"} {
		trustedOrigins = append(trustedOrigins, os.Getenv(key))
	}
	for _, raw := range trustedOrigins {
		if u, err := url.Parse(raw); err == nil && origin(u) != "" {
			trusted[origin(u)] = true
		}
	}
	dialer := &net.Dialer{Timeout: connectTimeout, KeepAlive: 30 * time.Second}
	return &http.Client{Timeout: timeout, Transport: &mediaTransport{resolver: net.DefaultResolver, trusted: trusted, dial: dialer.DialContext}, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > maxRedirects || origin(req.URL) == "" {
			return http.ErrUseLastResponse
		}
		req.Header.Del("Referer")
		return nil
	}}
}

func (t *mediaTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if origin(req.URL) == "" || (req.Method != http.MethodGet && req.Method != http.MethodHead) || strings.Contains(req.URL.Hostname(), "%") {
		return nil, ErrMediaTarget
	}
	// Downloads carry no authentication, including nonstandard provider headers.
	// Clone so the caller's request is not mutated and allow only media headers.
	req = req.Clone(req.Context())
	headers := make(http.Header)
	for _, key := range []string{"Accept", "Range", "If-Range", "If-None-Match", "If-Modified-Since"} {
		if values := req.Header.Values(key); len(values) != 0 {
			headers[key] = append([]string(nil), values...)
		}
	}
	req.Header = headers
	host := strings.TrimSuffix(req.URL.Hostname(), ".")
	addresses := []net.IPAddr{}
	if ip := net.ParseIP(host); ip != nil {
		addresses = append(addresses, net.IPAddr{IP: ip})
	} else {
		var err error
		addresses, err = t.resolver.LookupIPAddr(req.Context(), host)
		if err != nil || len(addresses) == 0 {
			return nil, ErrMediaTarget
		}
	}
	allowed := []net.IP{}
	for _, address := range addresses {
		if mediaIPAllowed(address.IP, t.trusted[origin(req.URL)]) {
			allowed = append(allowed, address.IP)
		}
	}
	if len(allowed) == 0 {
		return nil, ErrMediaTarget
	}
	port := req.URL.Port()
	if port == "" {
		if req.URL.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSHandshakeTimeout: connectTimeout, ResponseHeaderTimeout: responseHeaderTimeout,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			for _, ip := range allowed {
				connection, err := t.dial(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return connection, nil
				}
			}
			return nil, ErrMediaTarget
		},
	}
	response, err := transport.RoundTrip(req)
	if err != nil {
		transport.CloseIdleConnections()
		return nil, ErrMediaTarget
	}
	return response, nil
}

func mediaIPAllowed(ip net.IP, trusted bool) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	for _, blocked := range []string{"169.254.169.254", "169.254.170.2", "100.100.100.200", "168.63.129.16", "fd00:ec2::254"} {
		if ip.Equal(net.ParseIP(blocked)) {
			return false
		}
	}
	if ip.IsLoopback() || ip.IsPrivate() {
		return trusted
	}
	// Carrier-grade NAT and benchmark ranges are not public media destinations.
	for _, block := range []string{"100.64.0.0/10", "198.18.0.0/15"} {
		_, network, _ := net.ParseCIDR(block)
		if network.Contains(ip) {
			return trusted
		}
	}
	return ip.IsGlobalUnicast()
}
