package storage

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

const testSignedMediaPath = "/storage/v1/object/sign/studio-test-assets/personal/u/video.mp4?token=a.b.c"

func TestSignedMediaRangesClampToFileLength(t *testing.T) {
	const body = "0123456789"
	for _, tc := range []struct {
		requested, forwarded, contentRange, expected string
		status                                       int
	}{
		{"bytes=0-3", "bytes=0-3", "bytes 0-3/10", "0123", 206},
		{"bytes=7-65542", "bytes=7-9", "bytes 7-9/10", "789", 206},
		{"bytes=7-", "bytes=7-9", "bytes 7-9/10", "789", 206},
		{"bytes=0-999999", "bytes=0-9", "bytes 0-9/10", body, 206},
		{"bytes=10-100", "", "bytes */10", "", 416},
		{"bytes=11-", "", "bytes */10", "", 416},
	} {
		t.Run(tc.requested, func(t *testing.T) {
			gets := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					w.Header().Set("Content-Length", strconv.Itoa(len(body)))
					return
				}
				gets++
				if got := r.Header.Get("Range"); got != tc.forwarded || tc.forwarded == "" {
					t.Errorf("unexpected NAS range: %s", got)
				}
				w.Header().Set("Content-Length", strconv.Itoa(len(tc.expected)))
				w.Header().Set("Content-Range", tc.contentRange)
				w.WriteHeader(206)
				fmt.Fprint(w, tc.expected)
			}))
			defer upstream.Close()
			s := &SupabaseStorage{origin: upstream.URL, client: upstream.Client()}
			r := httptest.NewRequest(http.MethodGet, testSignedMediaPath, nil)
			r.Header.Set("Range", tc.requested)
			w := httptest.NewRecorder()
			s.ServeSignedSuffixRange(w, r)
			if w.Code != tc.status || w.Header().Get("Content-Range") != tc.contentRange {
				t.Fatalf("status=%d range=%s", w.Code, w.Header().Get("Content-Range"))
			}
			if tc.status == 206 && (w.Body.String() != tc.expected || gets != 1) {
				t.Fatal("incorrect range bytes")
			}
			if tc.status == 416 && gets != 0 {
				t.Fatal("out-of-file request reached NAS GET")
			}
		})
	}
}

func TestSignedMediaRangesRejectInvalidOffsets(t *testing.T) {
	s := &SupabaseStorage{origin: "http://unused.invalid", client: http.DefaultClient}
	for _, value := range []string{"bytes=-", "bytes=-0", "bytes=5-3", "bytes=0-3,5-8", "bytes=+1-2", "bytes=0-9223372036854775808", "bytes=0--1"} {
		r := httptest.NewRequest(http.MethodGet, testSignedMediaPath, nil)
		r.Header.Set("Range", value)
		w := httptest.NewRecorder()
		s.ServeSignedSuffixRange(w, r)
		if w.Code != 416 {
			t.Errorf("range %q returned %d", value, w.Code)
		}
	}
}

func TestSignedSuffixRangeUsesExactIntervalWithoutCredentials(t *testing.T) {
	body := strings.Repeat("media", 100000)
	for _, suffix := range []int{6, 400000, len(body) + 1} {
		t.Run(strconv.Itoa(suffix), func(t *testing.T) {
			var methods []string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				methods = append(methods, r.Method)
				if r.URL.RequestURI() != testSignedMediaPath {
					t.Error("signature URI changed")
				}
				for _, key := range []string{"Authorization", "Cookie", "apikey"} {
					if r.Header.Get(key) != "" {
						t.Errorf("credential leaked: %s", key)
					}
				}
				if r.Method == http.MethodHead {
					if r.Header.Get("Range") != "" {
						t.Error("HEAD must obtain full length")
					}
					w.Header().Set("Content-Length", strconv.Itoa(len(body)))
					return
				}
				start := max(0, len(body)-suffix)
				if got := r.Header.Get("Range"); got != fmt.Sprintf("bytes=%d-%d", start, len(body)-1) {
					t.Fatalf("invalid NAS range %s", got)
				}
				w.Header().Set("Content-Length", strconv.Itoa(len(body)-start))
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(body)-1, len(body)))
				w.Header().Set("Content-Type", "video/mp4")
				w.WriteHeader(http.StatusPartialContent)
				fmt.Fprint(w, body[start:])
			}))
			defer upstream.Close()
			s := &SupabaseStorage{origin: upstream.URL, client: upstream.Client()}
			r := httptest.NewRequest(http.MethodGet, testSignedMediaPath, nil)
			r.Header.Set("Range", fmt.Sprintf("bytes=-%d", suffix))
			r.Header.Set("Authorization", "Bearer private")
			r.Header.Set("Cookie", "session=private")
			w := httptest.NewRecorder()
			s.ServeSignedSuffixRange(w, r)
			if w.Code != 206 || w.Body.String() != body[max(0, len(body)-suffix):] || strings.Join(methods, ",") != "HEAD,GET" {
				t.Fatalf("range failed: status=%d bytes=%d methods=%v", w.Code, w.Body.Len(), methods)
			}
		})
	}
}

func TestSignedSuffixRangeRejectsUnsafeOrExpiredRequests(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(403)
		fmt.Fprint(w, "secret upstream diagnostic")
	}))
	defer upstream.Close()
	s := &SupabaseStorage{origin: upstream.URL, client: upstream.Client()}
	for _, path := range []string{
		"/storage/v1/object/sign/old-bucket/video.mp4?token=a.b.c",
		"/storage/v1/object/sign/studio-test-assets/../private?token=a.b.c",
		testSignedMediaPath + "&url=http://other.test",
	} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.Header.Set("Range", "bytes=-6")
		w := httptest.NewRecorder()
		s.ServeSignedSuffixRange(w, r)
		if w.Code != 404 || calls != 0 {
			t.Fatal("unsafe media request accepted")
		}
	}
	r := httptest.NewRequest(http.MethodGet, testSignedMediaPath, nil)
	r.Header.Set("Range", "bytes=-6")
	w := httptest.NewRecorder()
	s.ServeSignedSuffixRange(w, r)
	if w.Code != 403 || calls != 1 || strings.Contains(w.Body.String(), "secret") {
		t.Fatal("expired signature fetched media or exposed diagnostics")
	}
}

func TestSignedSuffixRangeRejectsIncorrectNASRange(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "10")
		if r.Method == http.MethodHead {
			return
		}
		w.Header().Set("Content-Range", "bytes 4-100/10")
		w.WriteHeader(206)
		fmt.Fprint(w, "0123456789")
	}))
	defer upstream.Close()
	s := &SupabaseStorage{origin: upstream.URL, client: upstream.Client()}
	r := httptest.NewRequest(http.MethodGet, testSignedMediaPath, nil)
	r.Header.Set("Range", "bytes=-6")
	w := httptest.NewRecorder()
	s.ServeSignedSuffixRange(w, r)
	if w.Code != 502 {
		t.Fatal("incorrect range accepted")
	}
}
