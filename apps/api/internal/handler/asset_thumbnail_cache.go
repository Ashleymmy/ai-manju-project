package handler

import (
	"bytes"
	"container/list"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
)

const (
	// Preview compression never alters the original media used for generation.
	assetThumbnailJPEGQuality = 82
	// Keep derived previews bounded independently of original media sizes.
	assetThumbnailCacheBytes   = 64 * 1024 * 1024
	assetThumbnailCacheEntries = 512
	assetThumbnailEntryBytes   = 2 * 1024 * 1024
	// Legacy assets may not have content hashes; periodically recheck storage.
	assetThumbnailCacheTTL = 10 * time.Minute
	// Stop adding derived files at this limit; original assets are never evicted.
	assetThumbnailDiskBytes = 512 * 1024 * 1024
)

type assetThumbnail struct {
	body                            []byte
	contentType, etag, lastModified string
}

type assetThumbnailEntry struct {
	key     string
	value   assetThumbnail
	expires time.Time
}

type thumbnailDiskEntry struct {
	Body                            []byte
	ContentType, ETag, LastModified string
}

type thumbnailFlight struct {
	mu    sync.Mutex
	users int
}

// Only accessed after a fresh workspace authorization. No signed URLs or
// credentials are cached. Derived files survive restart in the existing volume.
type assetThumbnailCache struct {
	mu        sync.Mutex
	lru       *list.List
	items     map[string]*list.Element
	bytes     int
	directory string
	diskBytes int64
	flights   map[string]*thumbnailFlight
}

func newAssetThumbnailCache(roots ...string) *assetThumbnailCache {
	c := &assetThumbnailCache{lru: list.New(), items: make(map[string]*list.Element), flights: make(map[string]*thumbnailFlight)}
	if len(roots) > 0 && roots[0] != "" {
		c.directory = filepath.Join(roots[0], ".thumbnail-cache")
		entries, _ := os.ReadDir(c.directory)
		for _, entry := range entries {
			if info, err := entry.Info(); err == nil && info.Mode().IsRegular() {
				c.diskBytes += info.Size()
			}
		}
	}
	return c
}

// Coalesce simultaneous requests for the same original while allowing other
// thumbnails to load independently. Authorization happens before taking a lock.
func (c *assetThumbnailCache) lock(key string) func() {
	c.mu.Lock()
	f := c.flights[key]
	if f == nil {
		f = &thumbnailFlight{}
		c.flights[key] = f
	}
	f.users++
	c.mu.Unlock()
	f.mu.Lock()
	return func() {
		f.mu.Unlock()
		c.mu.Lock()
		f.users--
		if f.users == 0 {
			delete(c.flights, key)
		}
		c.mu.Unlock()
	}
}

func assetThumbnailKey(asset model.Asset, width int) string {
	return fmt.Sprintf("%s/%s/%s/%d/%d/%d", asset.WorkspaceID, asset.ID, asset.ContentSHA256, asset.Size, asset.UpdatedAt.UnixNano(), width)
}

func (c *assetThumbnailCache) remove(element *list.Element) {
	entry := element.Value.(assetThumbnailEntry)
	c.bytes -= len(entry.value.body)
	delete(c.items, entry.key)
	c.lru.Remove(element)
}

func (c *assetThumbnailCache) get(key string) (assetThumbnail, bool) {
	c.mu.Lock()
	if element := c.items[key]; element != nil {
		entry := element.Value.(assetThumbnailEntry)
		if time.Now().Before(entry.expires) {
			c.lru.MoveToFront(element)
			c.mu.Unlock()
			return entry.value, true
		}
		c.remove(element)
	}
	c.mu.Unlock()
	// Disk reads and one-time legacy PNG compression must not hold the global
	// memory-cache lock; different previews can finish independently.
	if c.directory != "" {
		path := c.diskPath(key)
		if info, err := os.Stat(path); err == nil && info.Size() <= assetThumbnailEntryBytes*2 {
			body, err := os.ReadFile(path)
			var entry thumbnailDiskEntry
			if err == nil && json.Unmarshal(body, &entry) == nil && len(entry.Body) > 0 && len(entry.Body) <= assetThumbnailEntryBytes && (entry.ContentType == "image/jpeg" || entry.ContentType == "image/png") {
				value := assetThumbnail{body: entry.Body, contentType: entry.ContentType, etag: entry.ETag, lastModified: entry.LastModified}
				value = compactCachedThumbnail(value)
				c.mu.Lock()
				c.putMemory(key, value)
				c.mu.Unlock()
				return value, true
			}
		}
	}
	return assetThumbnail{}, false
}

// Reuse already downloaded thumbnails after upgrading instead of fetching all
// originals from NAS again. Transparent PNGs retain their original bytes.
func compactCachedThumbnail(value assetThumbnail) assetThumbnail {
	if value.contentType != "image/png" {
		return value
	}
	source, _, err := image.Decode(bytes.NewReader(value.body))
	if err != nil {
		return value
	}
	opaque, ok := source.(interface{ Opaque() bool })
	if !ok || !opaque.Opaque() {
		return value
	}
	var encoded bytes.Buffer
	if jpeg.Encode(&encoded, source, &jpeg.Options{Quality: assetThumbnailJPEGQuality}) != nil || encoded.Len() >= len(value.body) {
		return value
	}
	value.body = encoded.Bytes()
	value.contentType = "image/jpeg"
	value.etag = fmt.Sprintf(`"thumbnail-%x"`, sha256.Sum256(value.body))
	return value
}

func (c *assetThumbnailCache) put(key string, value assetThumbnail) {
	if len(value.body) > assetThumbnailEntryBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.putMemory(key, value)
	if c.directory == "" || c.diskBytes >= assetThumbnailDiskBytes || (value.contentType != "image/jpeg" && value.contentType != "image/png") {
		return
	}
	path := c.diskPath(key)
	if _, err := os.Stat(path); err == nil {
		return
	}
	body, err := json.Marshal(thumbnailDiskEntry{value.body, value.contentType, value.etag, value.lastModified})
	if err != nil || c.diskBytes+int64(len(body)) > assetThumbnailDiskBytes {
		return
	}
	if os.MkdirAll(c.directory, 0700) != nil {
		return
	}
	f, err := os.CreateTemp(c.directory, ".preview-")
	if err != nil {
		return
	}
	defer os.Remove(f.Name())
	_, err = f.Write(body)
	closeErr := f.Close()
	if err == nil && closeErr == nil && os.Rename(f.Name(), path) == nil {
		c.diskBytes += int64(len(body))
	}
}

func (c *assetThumbnailCache) diskPath(key string) string {
	return filepath.Join(c.directory, fmt.Sprintf("%x.json", sha256.Sum256([]byte(key))))
}

func (c *assetThumbnailCache) putMemory(key string, value assetThumbnail) {
	if old := c.items[key]; old != nil {
		c.remove(old)
	}
	for c.bytes+len(value.body) > assetThumbnailCacheBytes || c.lru.Len() >= assetThumbnailCacheEntries {
		c.remove(c.lru.Back())
	}
	c.items[key] = c.lru.PushFront(assetThumbnailEntry{key: key, value: value, expires: time.Now().Add(assetThumbnailCacheTTL)})
	c.bytes += len(value.body)
}
