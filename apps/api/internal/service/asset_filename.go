package service

import (
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// Display names can contain decimal numbers; only a media suffix is a file extension.
var assetMediaExtension = regexp.MustCompile(`(?i)^\.(png|jpe?g|webp|gif|avif|bmp|tiff?|svg|heic|heif|mp4|m4v|mov|webm|mkv|avi|mp3|wav|ogg|opus|aac|flac|m4a|pcm)$`)

// Canonical suffixes for extension-free display names, independent of MIME registry aliases.
var assetContentTypeExtensions = map[string]string{
	"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
	"image/svg+xml": ".svg", "image/bmp": ".bmp", "image/tiff": ".tiff", "image/heic": ".heic", "image/heif": ".heif",
	"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv",
	"audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/ogg": ".ogg",
	"audio/opus": ".opus", "audio/aac": ".aac", "audio/flac": ".flac", "audio/mp4": ".m4a", "audio/pcm": ".pcm",
}

// AssetDownloadFileName preserves editable library names without requiring users
// to include an extension in the display name. Storage keys are unchanged.
func AssetDownloadFileName(asset model.Asset) string {
	name := safeArchiveSegment(asset.Name)
	if name == "" || name == "unnamed" {
		name = asset.ID
	}
	if !assetMediaExtension.MatchString(filepath.Ext(name)) {
		name += exportAssetExtension(asset)
	}
	return strings.TrimSpace(name)
}
