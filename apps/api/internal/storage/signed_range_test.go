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
