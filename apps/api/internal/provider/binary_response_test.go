package provider

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBinaryResponseRejectsTruncation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		body      string
		length    int64
		wantError bool
	}{
		{"exact boundary", "1234", 4, false},
		{"chunked boundary", "1234", -1, false},
		{"known overflow", "12345", 5, true},
		{"chunked overflow", "12345", -1, true},
		{"incorrect upstream length", "12345", 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := &http.Response{ContentLength: tc.length, Body: io.NopCloser(strings.NewReader(tc.body))}
			data, err := readProviderBinaryResponse(res, 4)
			if tc.wantError {
				if err == nil || data != nil {
					t.Fatalf("oversized response returned media: %q, %v", data, err)
				}
			} else if err != nil || string(data) != tc.body {
				t.Fatalf("valid response changed: %q, %v", data, err)
			}
		})
	}
}

type failedBinaryReader struct{}

func (failedBinaryReader) Read(p []byte) (int, error) { return copy(p, "12"), io.ErrUnexpectedEOF }

func TestBinaryResponseDiscardsPartialRead(t *testing.T) {
	res := &http.Response{ContentLength: -1, Body: io.NopCloser(failedBinaryReader{})}
	data, err := readProviderBinaryResponse(res, 4)
	if data != nil || !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("partial response returned media: %q, %v", data, err)
	}
}
