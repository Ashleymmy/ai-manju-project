package storage

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Match the media proxy's dedicated bucket/path grammar. NAS validates the
// supplied object signature; this handler never attaches service credentials.
var signedMediaRequest = regexp.MustCompile(`^/storage/v1/object/sign/(?:studio-test-assets|studio-sdvideo-test-(?:inputs|results|thumbnails|volcano))/(?:[A-Za-z0-9_:.-]|%3[Aa]|/)+\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)

// ServeSignedSuffixRange compensates for NAS suffix-range and past-EOF bugs.
// Obtain the size through the same signed URL, then request a bounded absolute
// range. Only the requested tail crosses the API; no whole-file buffering.
func (s *SupabaseStorage) ServeSignedSuffixRange(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.RequestURI()
	if r.Method != http.MethodGet || !signedMediaRequest.MatchString(uri) {
		http.Error(w, "media request not found", http.StatusNotFound)
		return
	}
	for _, part := range strings.Split(r.URL.Path, "/") {
		if part == "." || part == ".." {
			http.Error(w, "media request not found", http.StatusNotFound)
			return
		}
	}
	rangeValue := r.Header.Get("Range")
	if !strings.HasPrefix(rangeValue, "bytes=-") {
		http.Error(w, "suffix range required", http.StatusBadRequest)
		return
	}
	n, err := strconv.ParseInt(strings.TrimPrefix(rangeValue, "bytes=-"), 10, 64)
	if err != nil || n <= 0 {
		http.Error(w, "invalid media range", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	target := s.origin + uri
	request := func(method, byteRange string) (*http.Response, error) {
		upstream, err := http.NewRequestWithContext(r.Context(), method, target, nil)
		if err != nil {
			return nil, err
		}
		upstream.Header.Set("Accept-Encoding", "identity")
		if byteRange != "" {
			upstream.Header.Set("Range", byteRange)
			if v := r.Header.Get("If-Range"); v != "" {
				upstream.Header.Set("If-Range", v)
			}
		}
		return s.client.Do(upstream)
	}
	head, err := request(http.MethodHead, "")
	if err != nil {
		http.Error(w, "media metadata unavailable", http.StatusBadGateway)
		return
	}
	head.Body.Close()
	if head.StatusCode != http.StatusOK {
		writeSignedMediaFailure(w, head.StatusCode)
		return
	}
	size := head.ContentLength
	if size <= 0 {
		http.Error(w, "invalid media length", http.StatusBadGateway)
		return
	}
	start := max(int64(0), size-n)
	upstream, err := request(http.MethodGet, fmt.Sprintf("bytes=%d-%d", start, size-1))
	if err != nil {
		http.Error(w, "media download unavailable", http.StatusBadGateway)
		return
	}
	defer upstream.Body.Close()
	if upstream.StatusCode != http.StatusPartialContent && upstream.StatusCode != http.StatusOK {
		writeSignedMediaFailure(w, upstream.StatusCode)
		return
	}
	if upstream.StatusCode == http.StatusPartialContent && (upstream.Header.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, size-1, size) || upstream.ContentLength != size-start) {
		http.Error(w, "invalid media range response", http.StatusBadGateway)
		return
	}
	for _, key := range []string{"Content-Type", "Content-Length", "Content-Range", "ETag", "Last-Modified", "Accept-Ranges"} {
		if value := upstream.Header.Get(key); value != "" {
			w.Header().Set(key, value)
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.WriteHeader(upstream.StatusCode)
	_, _ = io.Copy(w, upstream.Body)
}

func writeSignedMediaFailure(w http.ResponseWriter, status int) {
	if status != http.StatusForbidden && status != http.StatusUnauthorized && status != http.StatusNotFound && status != http.StatusRequestedRangeNotSatisfiable {
		status = http.StatusBadGateway
	}
	http.Error(w, "media unavailable", status)
}
