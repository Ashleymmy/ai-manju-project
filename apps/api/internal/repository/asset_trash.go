package repository

import (
	"time"

	"github.com/ai-manju/api/internal/model"
)

func trashExpiryTime(asset model.Asset) *time.Time {
	if asset.TrashExpiresAt != nil {
		return asset.TrashExpiresAt
	}
	if asset.TrashedAt == nil {
		return nil
	}
	fallback := asset.TrashedAt.Add(model.AssetTrashRetention)
	return &fallback
}

func assetTrashExpired(asset model.Asset, now time.Time) bool {
	if asset.TrashedAt == nil {
		return false
	}
	expires := trashExpiryTime(asset)
	return expires != nil && !expires.After(now)
}
