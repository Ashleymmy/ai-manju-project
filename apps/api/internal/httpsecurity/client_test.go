package httpsecurity

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (f resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return f(ctx, host)
}

func TestMediaIPBoundary(t *testing.T) {
	for _, row := range []struct {
		ip              string
		public, trusted bool
	}{
		{"8.8.8.8", true, true}, {"2606:4700:4700::1111", true, true},
		{"127.0.0.1", false, true}, {"10.0.0.1", false, true}, {"::1", false, true},
		{"::ffff:127.0.0.1", false, true}, {"192.168.1.1", false, true},
		{"100.64.0.1", false, true}, {"198.18.0.1", false, true},
		{"169.254.169.254", false, false}, {"100.100.100.200", false, false},
		{"fd00:ec2::254", false, false}, {"0.0.0.0", false, false},
		{"fe80::1", false, false}, {"224.0.0.1", false, false}, {"::", false, false},
	} {
		t.Run(row.ip, func(t *testing.T) {
			if got := mediaIPAllowed(net.ParseIP(row.ip), false); got != row.public {
				t.Fatalf("public=%v", got)
			}
			if got := mediaIPAllowed(net.ParseIP(row.ip), true); got != row.trusted {
				t.Fatalf("trusted=%v", got)
			}
		})
	}
}

func TestMediaDownloadPinsPublicDNSAndStripsCredentials(t *testing.T) {
	var gotHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		_, _ = w.Write([]byte("media"))
	}))
	defer server.Close()
	client := NewMediaClient(time.Second)
	transport := client.Transport.(*mediaTransport)
	lookups := 0
	transport.resolver = resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		lookups++
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}, {IP: net.ParseIP("8.8.8.8")}}, nil
	})
	transport.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "8.8.8.8:80" {
			return nil, fmt.Errorf("unexpected unpinned destination")
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	req, _ := http.NewRequest(http.MethodGet, "http://media.example/output", nil)
	req.Header.Set("Authorization", "dummy")
	req.Header.Set("X-Api-Key", "dummy")
	req.Header.Set("Cookie", "dummy")
	req.Header.Set("Referer", "https://provider.example/?key=dummy")
	req.Header.Set("Range", "bytes=0-10")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if string(data) != "media" || lookups != 1 {
		t.Fatalf("bad download or DNS pinning: %d", lookups)
	}
	for _, key := range []string{"Authorization", "X-Api-Key", "Cookie", "Referer"} {
		if gotHeaders.Get(key) != "" {
			t.Errorf("credential forwarded: %s", key)
		}
	}
	if gotHeaders.Get("Range") != "bytes=0-10" || req.Header.Get("Authorization") == "" {
		t.Fatal("range lost or original request mutated")
	}
}

func TestMediaRedirectCannotReachPrivateOrigin(t *testing.T) {
	hits := 0
	private := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; _, _ = w.Write([]byte("private")) }))
	defer private.Close()
	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, private.URL+"/?signature=dummy", http.StatusFound)
	}))
	defer start.Close()
	client := NewMediaClient(time.Second, start.URL)
	res, err := client.Get(start.URL)
	if res != nil {
		res.Body.Close()
	}
	if err == nil || hits != 0 {
		t.Fatal("redirect reached untrusted private origin")
	}
}

func TestMediaConfiguredPrivateAndMetadataBoundary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("NAS")) }))
	defer server.Close()
	res, err := NewMediaClient(time.Second, server.URL).Get(server.URL)
	if err != nil {
		t.Fatal("configured private origin must remain supported")
	}
	res.Body.Close()
	for _, raw := range []string{"http://100.100.100.200/", "http://169.254.169.254/", "file:///etc/passwd", "http://user:pass@example.com/", "http://[fe80::1%25eth0]/"} {
		client := NewMediaClient(time.Second, raw)
		client.Transport.(*mediaTransport).dial = func(context.Context, string, string) (net.Conn, error) {
			t.Error("blocked target dialed")
			return nil, ErrMediaTarget
		}
		res, err := client.Get(raw)
		if res != nil {
			res.Body.Close()
		}
		if err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestSameOriginRedirectProtectsCustomHeadersAndBody(t *testing.T) {
	hits := 0
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer foreign.Close()
	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, foreign.URL, http.StatusTemporaryRedirect)
	}))
	defer start.Close()
	client := &http.Client{CheckRedirect: SameOriginRedirect}
	req, _ := http.NewRequest(http.MethodPost, start.URL, strings.NewReader("paid-body"))
	req.Header.Set("X-Custom-Key", "dummy")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 307 || hits != 0 {
		t.Fatal("foreign origin received credentialed POST")
	}
	a, _ := url.Parse("https://EXAMPLE.com/v1")
	b, _ := url.Parse("https://example.com:443/v2")
	if !SameOrigin(a, b) {
		t.Fatal("default port must normalize")
	}
}
