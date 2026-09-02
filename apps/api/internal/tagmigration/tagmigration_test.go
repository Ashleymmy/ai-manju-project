package tagmigration

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestRunDryRunAndIdempotentBackfillIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL migration integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("tag_migration_%d", time.Now().UTC().UnixNano())
	workspaceID, assetID := "default:"+prefix, prefix+"_asset"
	asset := model.Asset{ID: assetID, UserID: prefix, WorkspaceID: workspaceID, Type: "image", URL: "test.png", Tags: model.JSONB(`["古装","夜景","古装"]`)}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		bindingQuery := db.Model(&model.AssetTagBinding{}).Select("id").Where("asset_id = ?", assetID)
		_ = db.Where("binding_id IN (?)", bindingQuery).Delete(&model.AssetTagOrigin{}).Error
		_ = db.Where("asset_id = ?", assetID).Delete(&model.AssetTagBinding{}).Error
		tagQuery := db.Model(&model.Tag{}).Select("id").Where("scope_key = ?", workspaceID)
		_ = db.Where("ancestor_id IN (?) OR descendant_id IN (?)", tagQuery, tagQuery).Delete(&model.TagClosure{}).Error
		_ = db.Where("scope_key = ?", workspaceID).Delete(&model.Tag{}).Error
		_ = db.Where("id = ?", assetID).Delete(&model.Asset{}).Error
	})

	dryRun, err := Run(db, true)
	if err != nil {
		t.Fatal(err)
	}
	if dryRun.TagsToCreate != 3 || dryRun.BindingsToCreate != 2 || dryRun.OriginsToCreate != 2 {
		t.Fatalf("dry run = %+v", dryRun)
	}
	var tagCount int64
	if err := db.Model(&model.Tag{}).Where("scope_key = ?", workspaceID).Count(&tagCount).Error; err != nil {
		t.Fatal(err)
	}
	if tagCount != 0 {
		t.Fatalf("dry run wrote %d tags", tagCount)
	}
	applied, err := Run(db, false)
	if err != nil {
		t.Fatal(err)
	}
	if applied.CreatedTags != 3 || applied.CreatedBindings != 2 || applied.CreatedOrigins != 2 {
		t.Fatalf("applied = %+v", applied)
	}
	repeated, err := Run(db, false)
	if err != nil {
		t.Fatal(err)
	}
	if repeated.TagsToCreate != 0 || repeated.BindingsToCreate != 0 || repeated.OriginsToCreate != 0 {
		t.Fatalf("repeated = %+v", repeated)
	}
	var unchanged model.Asset
	if err := db.First(&unchanged, "id = ?", assetID).Error; err != nil {
		t.Fatal(err)
	}
	var originalTags, unchangedTags []string
	if err := json.Unmarshal(asset.Tags, &originalTags); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(unchanged.Tags, &unchangedTags); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(unchangedTags, originalTags) {
		t.Fatalf("legacy JSON changed: %v", unchangedTags)
	}
}
