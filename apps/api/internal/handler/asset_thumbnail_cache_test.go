package handler

import (
	"bytes"
	"fmt"
	"testing"
	"time"
)

func TestThumbnailDiskCacheSurvivesRestartAndKeysInvalidate(t *testing.T) {
	root := t.TempDir()
	cache := newAssetThumbnailCache(root)
	value := assetThumbnail{body: []byte("preview"), contentType: "image/jpeg", etag: "version1"}
	cache.put("asset/version1", value)
	restarted := newAssetThumbnailCache(root)
	got, ok := restarted.get("asset/version1")
	if !ok || !bytes.Equal(got.body, value.body) || got.etag != value.etag {
		t.Fatal("persistent preview not recovered")
	}
	if _, ok := restarted.get("asset/version2"); ok {
		t.Fatal("stale asset revision reused")
	}
	restarted.diskBytes = assetThumbnailDiskBytes
	restarted.put("over-budget", value)
	if _, ok := newAssetThumbnailCache(root).get("over-budget"); ok {
		t.Fatal("disk budget exceeded")
	}
}

func TestThumbnailCacheBoundsAndExpiry(t *testing.T) {
	cache := newAssetThumbnailCache()
	for i := 0; i <= assetThumbnailCacheEntries; i++ {
		cache.put(fmt.Sprint(i), assetThumbnail{body: []byte("preview")})
	}
	if cache.lru.Len() != assetThumbnailCacheEntries {
		t.Fatal("entry limit exceeded")
	}
	if _, ok := cache.get("0"); ok {
		t.Fatal("oldest thumbnail was not evicted")
	}
	cache.put("oversize", assetThumbnail{body: make([]byte, assetThumbnailEntryBytes+1)})
	if _, ok := cache.get("oversize"); ok {
		t.Fatal("oversized original cached")
	}
	element := cache.items["1"]
	entry := element.Value.(assetThumbnailEntry)
	entry.expires = time.Now().Add(-time.Second)
	element.Value = entry
	if _, ok := cache.get("1"); ok {
		t.Fatal("expired thumbnail served")
	}
	for i := 0; i < assetThumbnailCacheBytes/assetThumbnailEntryBytes+2; i++ {
		cache.put(fmt.Sprintf("large-%d", i), assetThumbnail{body: make([]byte, assetThumbnailEntryBytes)})
	}
	if cache.bytes > assetThumbnailCacheBytes {
		t.Fatal("byte limit exceeded")
	}
}
