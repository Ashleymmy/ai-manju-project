package handler

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/gin-gonic/gin"
)

type staticWebDAVResolver struct {
	mu      sync.Mutex
	values  map[string][]net.IPAddr
	lookups map[string]int
}

func (r *staticWebDAVResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lookups[host]++
	return r.values[host], nil
}

type webDAVRoundTripFunc func(*http.Request) (*http.Response, error)

func (f webDAVRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestWebDAVTargetPolicyRequiresExplicitPrivateNetwork(t *testing.T) {
	resolver := &staticWebDAVResolver{values: map[string][]net.IPAddr{
		"nas.example":    {{IP: net.ParseIP("192.168.1.20")}},
		"public.example": {{IP: net.ParseIP("93.184.216.34")}},
	}, lookups: make(map[string]int)}

	withoutCIDR, err := newWebDAVTargetPolicy([]string{"nas.example"}, resolver)
	if err != nil {
		t.Fatal(err)
	}
	privateTarget, _ := parseWebDAVTarget("https://nas.example/dav")
	if _, err := withoutCIDR.resolve(context.Background(), privateTarget); err == nil {
		t.Fatal("private DNS target should require an explicit IP or CIDR")
	}

	withCIDR, err := newWebDAVTargetPolicy([]string{"nas.example", "192.168.1.0/24", "public.example", "93.184.216.34", "127.0.0.1"}, resolver)
	if err != nil {
		t.Fatal(err)
	}
	if ip, err := withCIDR.resolve(context.Background(), privateTarget); err != nil || !ip.Equal(net.ParseIP("192.168.1.20")) {
		t.Fatalf("private target resolve = %v, %v", ip, err)
	}
	publicTarget, _ := parseWebDAVTarget("https://public.example/dav")
	if _, err := withCIDR.resolve(context.Background(), publicTarget); err != nil {
		t.Fatalf("allowlisted public hostname rejected: %v", err)
	}
	directPublic, _ := parseWebDAVTarget("https://93.184.216.34/dav")
	if _, err := withCIDR.resolve(context.Background(), directPublic); err != nil {
		t.Fatalf("explicit public IP rejected: %v", err)
	}
	directLoopback, _ := parseWebDAVTarget("http://127.0.0.1/dav")
	if _, err := withCIDR.resolve(context.Background(), directLoopback); err == nil {
		t.Fatal("loopback must remain forbidden even when listed")
	}
}

func TestWebDAVTargetPolicyUsesAllowedIPv4FromDualStackDNS(t *testing.T) {
	resolver := &staticWebDAVResolver{values: map[string][]net.IPAddr{
		"host.example": {
			{IP: net.ParseIP("fdc4:f303:9324::254")},
			{IP: net.ParseIP("192.168.65.254")},
		},
	}, lookups: make(map[string]int)}
	policy, err := newWebDAVTargetPolicy([]string{"host.example", "192.168.65.0/24"}, resolver)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := parseWebDAVTarget("http://host.example/dav")
	resolved, err := policy.resolve(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.Equal(net.ParseIP("192.168.65.254")) {
		t.Fatalf("dual-stack target resolved to %v, want allowed IPv4", resolved)
	}
}

func TestWebDAVProxyRevalidatesAndPinsEveryRedirect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, err := NewWebDAVProxyHandler(config.Config{
		FrontendURLs:              []string{"http://localhost:3100"},
		WebDAVAllowedHosts:        []string{"dav.example"},
		WebDAVProxyTimeoutSeconds: 5,
		WebDAVMaxRequestBytes:     1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolver := &staticWebDAVResolver{values: map[string][]net.IPAddr{"dav.example": {{IP: net.ParseIP("93.184.216.34")}}}, lookups: make(map[string]int)}
	handler.policy.resolver = resolver
	var calls int
	handler.clientFactory = func(_ *url.URL, pinnedIP net.IP, _ time.Duration) *http.Client {
		if !pinnedIP.Equal(net.ParseIP("93.184.216.34")) {
			t.Fatalf("unexpected pinned IP: %v", pinnedIP)
		}
		return &http.Client{Transport: webDAVRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return &http.Response{StatusCode: http.StatusTemporaryRedirect, Header: http.Header{"Location": []string{"/final"}}, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
			}
			headers := make(http.Header)
			headers.Set("Content-Type", "application/xml")
			headers.Set("ETag", "etag-1")
			return &http.Response{StatusCode: 207, Header: headers, Body: io.NopCloser(strings.NewReader("<multistatus/>")), Request: request}, nil
		}), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}

	router := gin.New()
	router.POST("/webdav-proxy", handler.Proxy)
	request := httptest.NewRequest(http.MethodPost, "/webdav-proxy", nil)
	request.Header.Set("Origin", "http://localhost:3100")
	request.Header.Set(webDAVTargetHeader, "https://dav.example/start")
	request.Header.Set(webDAVMethodHeader, "PROPFIND")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != 207 || recorder.Body.String() != "<multistatus/>" || recorder.Header().Get("ETag") != "etag-1" {
		t.Fatalf("unexpected proxy response: status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	if calls != 2 || resolver.lookups["dav.example"] != 2 {
		t.Fatalf("calls/lookups = %d/%d, want 2/2", calls, resolver.lookups["dav.example"])
	}
}

func TestWebDAVProxyRejectsOriginMethodAndOversizedBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, err := NewWebDAVProxyHandler(config.Config{
		FrontendURLs:              []string{"http://localhost:3100"},
		WebDAVAllowedHosts:        []string{"dav.example"},
		WebDAVProxyTimeoutSeconds: 5,
		WebDAVMaxRequestBytes:     4,
	})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.POST("/webdav-proxy", handler.Proxy)

	tests := []struct {
		name   string
		origin string
		method string
		body   string
		status int
	}{
		{name: "missing origin", method: http.MethodGet, status: http.StatusForbidden},
		{name: "disallowed method", origin: "http://localhost:3100", method: http.MethodDelete, status: http.StatusMethodNotAllowed},
		{name: "oversized body", origin: "http://localhost:3100", method: http.MethodPut, body: "12345", status: http.StatusRequestEntityTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/webdav-proxy", strings.NewReader(test.body))
			request.Header.Set("Origin", test.origin)
			request.Header.Set(webDAVTargetHeader, "https://dav.example/file")
			request.Header.Set(webDAVMethodHeader, test.method)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.status, recorder.Body.String())
			}
		})
	}
}
