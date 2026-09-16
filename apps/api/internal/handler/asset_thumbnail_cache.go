package handler

import (
	"container/list"
	"fmt"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
)

const (
	// Keep derived previews bounded independently of original media sizes.
	assetThumbnailCacheBytes   = 64 * 1024 * 1024
	assetThumbnailCacheEntries = 512
	assetThumbnailEntryBytes   = 2 * 1024 * 1024
	// Legacy assets may not have content hashes; periodically recheck storage.
	assetThumbnailCacheTTL = 10 * time.Minute
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

// Only accessed after a fresh workspace authorization. No signed URLs or
// credentials are cached. Entries are disposable and rebuilt after restart.
type assetThumbnailCache struct {
	mu    sync.Mutex
	lru   *list.List
	items map[string]*list.Element
	bytes int
}

func newAssetThumbnailCache() *assetThumbnailCache {
	return &assetThumbnailCache{lru: list.New(), items: make(map[string]*list.Element)}
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
	defer c.mu.Unlock()
	if element := c.items[key]; element != nil {
		entry := element.Value.(assetThumbnailEntry)
		if time.Now().Before(entry.expires) {
			c.lru.MoveToFront(element)
			return entry.value, true
		}
		c.remove(element)
	}
	return assetThumbnail{}, false
}

func (c *assetThumbnailCache) put(key string, value assetThumbnail) {
	if len(value.body) > assetThumbnailEntryBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if old := c.items[key]; old != nil {
		c.remove(old)
	}
	for c.bytes+len(value.body) > assetThumbnailCacheBytes || c.lru.Len() >= assetThumbnailCacheEntries {
		c.remove(c.lru.Back())
	}
	c.items[key] = c.lru.PushFront(assetThumbnailEntry{key: key, value: value, expires: time.Now().Add(assetThumbnailCacheTTL)})
	c.bytes += len(value.body)
}
