package handler

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

// Shared with worker/video_poster.py; only derived JPEGs live here.
const videoPosterDirectory = ".video-posters"

func videoPosterName(assetID, contentHash string) string {
	return fmt.Sprintf("%x.jpg", sha256.Sum256([]byte(assetID+"/"+contentHash)))
}

func (h *AssetHandler) videoPoster(c *gin.Context, userID, scope string) {
	asset, err := h.assets.AuthorizeContent(c.Param("id"), userID, scope)
	if err != nil {
		assetMutationError(c, err)
		return
	}
	if asset.Type != "video" || h.cfg.AssetStorageDir == "" {
		response.Error(c, http.StatusNotFound, "video poster unavailable")
		return
	}
	name := videoPosterName(asset.ID, asset.ContentSHA256)
	file, err := os.Open(filepath.Join(h.cfg.AssetStorageDir, videoPosterDirectory, name))
	if err != nil {
		c.Header("Cache-Control", "private, no-store")
		response.Error(c, http.StatusNotFound, "video poster unavailable")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > assetThumbnailEntryBytes {
		response.Error(c, http.StatusNotFound, "video poster unavailable")
		return
	}
	c.Header("Content-Type", "image/jpeg")
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("ETag", fmt.Sprintf("\"%s\"", name))
	http.ServeContent(c.Writer, c.Request, name, info.ModTime(), file)
}
