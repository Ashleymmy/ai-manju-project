package handler

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"os"
	"testing"
	"time"
)

func TestExistingPNGThumbnailIsCompactedWithoutRefetchOrLosingAlpha(t *testing.T) {
	for _, transparent := range []bool{false, true} {
		name := "opaque"
		if transparent {
			name = "transparent"
		}
		t.Run(name, func(t *testing.T) {
			source := image.NewNRGBA(image.Rect(0, 0, 320, 180))
			rng := rand.New(rand.NewSource(1))
			for y := 0; y < 180; y++ {
				for x := 0; x < 320; x++ {
					source.SetNRGBA(x, y, color.NRGBA{uint8(rng.Intn(256)), uint8(rng.Intn(256)), uint8(rng.Intn(256)), 255})
				}
			}
			if transparent {
				source.SetNRGBA(0, 0, color.NRGBA{255, 0, 0, 64})
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, source); err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			cache := newAssetThumbnailCache(root)
			cache.put("legacy", assetThumbnail{body: encoded.Bytes(), contentType: "image/png", etag: `"old"`})
			originalDisk, err := os.ReadFile(cache.diskPath("legacy"))
			if err != nil {
				t.Fatal(err)
			}
			for attempt := 0; attempt < 2; attempt++ {
				got, ok := newAssetThumbnailCache(root).get("legacy")
				if !ok {
					t.Fatal("cache miss after upgrade")
				}
				if transparent {
					if got.contentType != "image/png" || !bytes.Equal(got.body, encoded.Bytes()) || got.etag != `"old"` {
						t.Fatal("transparent preview changed")
					}
				} else {
					if got.contentType != "image/jpeg" || len(got.body) >= encoded.Len() || got.etag == `"old"` {
						t.Fatal("opaque PNG was not compacted with a new validator")
					}
				}
				decoded, _, err := image.Decode(bytes.NewReader(got.body))
				if err != nil || decoded.Bounds() != source.Bounds() {
					t.Fatal("invalid dimensions")
				}
			}
			after, _ := os.ReadFile(cache.diskPath("legacy"))
			if !bytes.Equal(originalDisk, after) {
				t.Fatal("existing disk file altered")
			}
		})
	}
}

func TestNewThumbnailKeepsTransparencyAndOriginal(t *testing.T) {
	for _, transparent := range []bool{false, true} {
		source := image.NewNRGBA(image.Rect(0, 0, 800, 400))
		rng := rand.New(rand.NewSource(1))
		for y := 0; y < 400; y++ {
			for x := 0; x < 800; x++ {
				source.SetNRGBA(x, y, color.NRGBA{uint8(rng.Intn(256)), uint8(rng.Intn(256)), uint8(rng.Intn(256)), 255})
			}
		}
		if transparent {
			source.SetNRGBA(0, 0, color.NRGBA{255, 0, 0, 64})
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, source); err != nil {
			t.Fatal(err)
		}
		original := append([]byte(nil), encoded.Bytes()...)
		body, contentType, ok := resizeAssetThumbnail(encoded.Bytes(), "image/png", 320)
		if !ok || !bytes.Equal(original, encoded.Bytes()) {
			t.Fatal("original was changed")
		}
		if transparent && contentType != "image/png" {
			t.Fatal("lost transparency")
		}
		if !transparent && contentType != "image/jpeg" {
			t.Fatal("opaque photo remained PNG")
		}
		decoded, _, err := image.Decode(bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if transparent {
			_, _, _, alpha := decoded.At(0, 0).RGBA()
			if alpha >= 0xffff {
				t.Fatal("transparent pixel lost")
			}
		}
	}
}

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
