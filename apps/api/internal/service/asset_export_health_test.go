package service

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func TestExportHealthTracksDispatchAndActualTransfer(t *testing.T) {
	h := newAssetExportTestHarness(t)
	if h.exports.DispatcherReady(time.Now()) {
		t.Fatal("unstarted dispatcher is not ready")
	}
	if err := h.exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !h.exports.DispatcherReady(time.Now()) {
		t.Fatal("empty queue scan must count as progress")
	}
	h.exports.dispatchProgress.Store(time.Now().Add(-AssetExportProgressStaleAfter - time.Second).UnixNano())
	if h.exports.DispatcherReady(time.Now()) {
		t.Fatal("stale progress is not ready")
	}
	r := exportProgressReader{strings.NewReader("media"), h.exports.recordDispatchProgress}
	body, err := io.ReadAll(r)
	if err != nil || string(body) != "media" {
		t.Fatalf("transfer changed: %q %v", body, err)
	}
	if !h.exports.DispatcherReady(time.Now()) {
		t.Fatal("actual transfer must renew progress")
	}
}

func TestExportReaderDoesNotPretendEmptyReadsAreProgress(t *testing.T) {
	calls := 0
	r := exportProgressReader{strings.NewReader(""), func() { calls++ }}
	_, err := io.ReadAll(r)
	if err != nil || calls != 0 {
		t.Fatalf("empty read: calls=%d err=%v", calls, err)
	}
}
