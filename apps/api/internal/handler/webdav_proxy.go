package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/gin-gonic/gin"
)

const (
	webDAVTargetHeader       = "x-webdav-target"
	webDAVMethodHeader       = "x-webdav-method"
	webDAVMaxRedirects       = 5
	webDAVDefaultHTTPPort    = "80"
	webDAVDefaultHTTPSPort   = "443"
	webDAVResponseBufferSize = 32 * 1024
	webDAVFallbackTimeout    = 120 * time.Second
	webDAVFallbackMaxBody    = 100 * 1024 * 1024
)

var webDAVAllowedMethods = map[string]bool{
	http.MethodGet:  true,
	http.MethodHead: true,
	http.MethodPut:  true,
	"MKCOL":         true,
	"PROPFIND":      true,
}

var webDAVForwardedHeaders = map[string]string{
	"x-webdav-authorization": "Authorization",
	"x-webdav-depth":         "Depth",
	"x-webdav-destination":   "Destination",
	"x-webdav-overwrite":     "Overwrite",
	"x-webdav-content-type":  "Content-Type",
}

var webDAVResponseHeaders = []string{"Content-Type", "ETag", "Last-Modified", "DAV"}

type webDAVResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type webDAVClientFactory func(*url.URL, net.IP, time.Duration) *http.Client

type WebDAVProxyHandler struct {
	allowedOrigins map[string]struct{}
	policy         *webDAVTargetPolicy
	timeout        time.Duration
	maxBodyBytes   int64
	clientFactory  webDAVClientFactory
}

func NewWebDAVProxyHandler(cfg config.Config) (*WebDAVProxyHandler, error) {
	policy, err := newWebDAVTargetPolicy(cfg.WebDAVAllowedHosts, net.DefaultResolver)
	if err != nil {
		return nil, err
	}
	timeout := time.Duration(cfg.WebDAVProxyTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = webDAVFallbackTimeout
	}
	maxBodyBytes := cfg.WebDAVMaxRequestBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = webDAVFallbackMaxBody
	}
	return &WebDAVProxyHandler{
		allowedOrigins: normalizeAllowedOrigins(cfg.FrontendURLs),
		policy:         policy,
		timeout:        timeout,
		maxBodyBytes:   maxBodyBytes,
		clientFactory:  newPinnedWebDAVClient,
	}, nil
}

func (h *WebDAVProxyHandler) Proxy(c *gin.Context) {
	if !h.originAllowed(c.GetHeader("Origin")) {
		c.Data(http.StatusForbidden, "text/plain; charset=utf-8", []byte("WebDAV proxy origin is not allowed"))
		return
	}
	method := strings.ToUpper(strings.TrimSpace(c.GetHeader(webDAVMethodHeader)))
	if method == "" {
		method = http.MethodGet
	}
	if !webDAVAllowedMethods[method] {
		c.Data(http.StatusMethodNotAllowed, "text/plain; charset=utf-8", []byte("WebDAV method is not allowed"))
		return
	}
	target, err := parseWebDAVTarget(c.GetHeader(webDAVTargetHeader))
	if err != nil {
		c.Data(http.StatusBadRequest, "text/plain; charset=utf-8", []byte(err.Error()))
		return
	}
	body, err := h.readBody(c, method)
	if err != nil {
		status := http.StatusBadRequest
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			status = http.StatusRequestEntityTooLarge
		}
		c.Data(status, "text/plain; charset=utf-8", []byte(http.StatusText(status)))
		return
	}
	headers := make(http.Header)
	for source, destination := range webDAVForwardedHeaders {
		if value := c.GetHeader(source); value != "" {
			headers.Set(destination, value)
		}
	}

	response, err := h.do(c.Request.Context(), target, method, headers, body)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.Data(http.StatusGatewayTimeout, "text/plain; charset=utf-8", []byte("WebDAV proxy timeout"))
			return
		}
		c.Data(http.StatusBadGateway, "text/plain; charset=utf-8", []byte("WebDAV proxy request failed"))
		return
	}
	defer response.Body.Close()
	for _, header := range webDAVResponseHeaders {
		if value := response.Header.Get(header); value != "" {
			c.Header(header, value)
		}
	}
	c.Status(response.StatusCode)
	if method == http.MethodHead {
		return
	}
	buffer := make([]byte, webDAVResponseBufferSize)
	_, _ = io.CopyBuffer(c.Writer, response.Body, buffer)
}

func (h *WebDAVProxyHandler) readBody(c *gin.Context, method string) ([]byte, error) {
	if method == http.MethodGet || method == http.MethodHead || c.Request.Body == nil {
		return nil, nil
	}
	if c.Request.ContentLength > h.maxBodyBytes {
		return nil, &http.MaxBytesError{Limit: h.maxBodyBytes}
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBodyBytes)
	return io.ReadAll(c.Request.Body)
}

func (h *WebDAVProxyHandler) do(ctx context.Context, target *url.URL, method string, headers http.Header, body []byte) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	completed := false
	defer func() {
		if !completed {
			cancel()
		}
	}()
	currentURL := cloneURL(target)
	currentMethod := method
	currentBody := body
	previousHost := strings.ToLower(currentURL.Hostname())

	for redirects := 0; ; redirects++ {
		pinnedIP, err := h.policy.resolve(ctx, currentURL)
		if err != nil {
			return nil, err
		}
		request, err := http.NewRequestWithContext(ctx, currentMethod, currentURL.String(), bytes.NewReader(currentBody))
		if err != nil {
			return nil, err
		}
		request.Header = headers.Clone()
		if strings.ToLower(currentURL.Hostname()) != previousHost {
			request.Header.Del("Authorization")
		}
		client := h.clientFactory(currentURL, pinnedIP, h.timeout)
		response, err := client.Do(request)
		client.CloseIdleConnections()
		if err != nil {
			return nil, err
		}
		if !isWebDAVRedirect(response.StatusCode) {
			response.Body = &cancelOnCloseReadCloser{ReadCloser: response.Body, cancel: cancel}
			completed = true
			return response, nil
		}
		if redirects >= webDAVMaxRedirects {
			response.Body.Close()
			return nil, errors.New("WebDAV redirect limit exceeded")
		}
		location, err := response.Location()
		response.Body.Close()
		if err != nil {
			return nil, errors.New("WebDAV redirect is missing a valid location")
		}
		previousHost = strings.ToLower(currentURL.Hostname())
		currentURL = location
		currentMethod, currentBody = redirectedWebDAVRequest(response.StatusCode, currentMethod, currentBody)
	}
}

func (h *WebDAVProxyHandler) originAllowed(origin string) bool {
	normalized, ok := normalizeOrigin(origin)
	if !ok {
		return false
	}
	_, ok = h.allowedOrigins[normalized]
	return ok
}

type webDAVTargetPolicy struct {
	hostnames map[string]struct{}
	exactIPs  map[string]struct{}
	networks  []*net.IPNet
	resolver  webDAVResolver
}

func newWebDAVTargetPolicy(entries []string, resolver webDAVResolver) (*webDAVTargetPolicy, error) {
	policy := &webDAVTargetPolicy{
		hostnames: make(map[string]struct{}),
		exactIPs:  make(map[string]struct{}),
		resolver:  resolver,
	}
	for _, raw := range entries {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, network, err := net.ParseCIDR(entry)
			if err != nil {
				return nil, fmt.Errorf("invalid WEBDAV_ALLOWED_HOSTS CIDR %q", entry)
			}
			policy.networks = append(policy.networks, network)
			continue
		}
		if ip := net.ParseIP(entry); ip != nil {
			policy.exactIPs[ip.String()] = struct{}{}
			continue
		}
		hostname := strings.ToLower(strings.TrimSuffix(entry, "."))
		if hostname == "" || strings.ContainsAny(hostname, ":@\\") {
			return nil, fmt.Errorf("invalid WEBDAV_ALLOWED_HOSTS hostname %q", entry)
		}
		policy.hostnames[hostname] = struct{}{}
	}
	return policy, nil
}

func (p *webDAVTargetPolicy) resolve(ctx context.Context, target *url.URL) (net.IP, error) {
	hostname := strings.ToLower(strings.TrimSuffix(target.Hostname(), "."))
	if hostname == "" {
		return nil, errors.New("WebDAV target host is missing")
	}
	if parsed := net.ParseIP(hostname); parsed != nil {
		if !p.ipExplicitlyAllowed(parsed) || isAlwaysForbiddenWebDAVIP(parsed) {
			return nil, errors.New("WebDAV target IP is not allowed")
		}
		return parsed, nil
	}
	if _, ok := p.hostnames[hostname]; !ok {
		return nil, errors.New("WebDAV target host is not allowed")
	}
	addresses, err := p.resolver.LookupIPAddr(ctx, hostname)
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("WebDAV target DNS resolution failed")
	}
	allowedAddresses := make([]net.IP, 0, len(addresses))
	for _, address := range addresses {
		if p.ipAllowed(address.IP) {
			allowedAddresses = append(allowedAddresses, address.IP)
		}
	}
	if len(allowedAddresses) == 0 {
		return nil, errors.New("WebDAV target resolved to a forbidden address")
	}
	// Prefer IPv4 when both families are available because some container DNS
	// servers advertise an unroutable ULA before their reachable host gateway.
	for _, address := range allowedAddresses {
		if address.To4() != nil {
			return address, nil
		}
	}
	return allowedAddresses[0], nil
}

func (p *webDAVTargetPolicy) ipAllowed(ip net.IP) bool {
	if isAlwaysForbiddenWebDAVIP(ip) {
		return false
	}
	explicit := p.ipExplicitlyAllowed(ip)
	if ip.IsPrivate() {
		return explicit
	}
	return explicit || !isIPAddressBlockedByDefault(ip)
}

func (p *webDAVTargetPolicy) ipExplicitlyAllowed(ip net.IP) bool {
	if _, ok := p.exactIPs[ip.String()]; ok {
		return true
	}
	for _, network := range p.networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func isIPAddressBlockedByDefault(ip net.IP) bool {
	return isAlwaysForbiddenWebDAVIP(ip)
}

func isAlwaysForbiddenWebDAVIP(ip net.IP) bool {
	return ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || isCloudMetadataIP(ip)
}

func isCloudMetadataIP(ip net.IP) bool {
	blocked := []string{"169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254"}
	for _, value := range blocked {
		if ip.Equal(net.ParseIP(value)) {
			return true
		}
	}
	return false
}

func parseWebDAVTarget(raw string) (*url.URL, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("Missing x-webdav-target")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host == "" {
		return nil, errors.New("Invalid x-webdav-target")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errors.New("Unsupported WebDAV target")
	}
	if target.User != nil {
		return nil, errors.New("WebDAV target userinfo is not allowed")
	}
	target.Fragment = ""
	return target, nil
}

func newPinnedWebDAVClient(target *url.URL, pinnedIP net.IP, timeout time.Duration) *http.Client {
	port := target.Port()
	if port == "" {
		port = webDAVDefaultHTTPPort
		if target.Scheme == "https" {
			port = webDAVDefaultHTTPSPort
		}
	}
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:               nil,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        2,
		IdleConnTimeout:     30 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		DialContext: func(ctx context.Context, network string, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, net.JoinHostPort(pinnedIP.String(), port))
		},
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func normalizeAllowedOrigins(origins []string) map[string]struct{} {
	result := make(map[string]struct{})
	for _, origin := range origins {
		if normalized, ok := normalizeOrigin(origin); ok {
			result[normalized] = struct{}{}
		}
	}
	return result
}

func normalizeOrigin(origin string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}

func isWebDAVRedirect(status int) bool {
	return status == http.StatusMovedPermanently || status == http.StatusFound || status == http.StatusSeeOther || status == http.StatusTemporaryRedirect || status == http.StatusPermanentRedirect
}

func redirectedWebDAVRequest(status int, method string, body []byte) (string, []byte) {
	if status == http.StatusTemporaryRedirect || status == http.StatusPermanentRedirect || method == http.MethodGet || method == http.MethodHead {
		return method, body
	}
	return http.MethodGet, nil
}

func cloneURL(source *url.URL) *url.URL {
	cloned := *source
	return &cloned
}

type cancelOnCloseReadCloser struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (r *cancelOnCloseReadCloser) Close() error {
	err := r.ReadCloser.Close()
	r.cancel()
	return err
}
