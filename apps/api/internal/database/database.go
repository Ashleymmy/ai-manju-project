package database

import (
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type PoolConfig struct {
	MaxOpenConns int
	MaxIdleConns int
	MaxLifetime  time.Duration
}

func OpenPostgres(dsn string) (*gorm.DB, error) {
	return openPostgres(dsn, nil)
}

func OpenPostgresWithPool(dsn string, pool PoolConfig) (*gorm.DB, error) {
	return openPostgres(dsn, &pool)
}

func openPostgres(dsn string, pool *PoolConfig) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	if pool != nil {
		sqlDB, err := db.DB()
		if err != nil {
			return nil, err
		}
		if pool.MaxOpenConns > 0 {
			sqlDB.SetMaxOpenConns(pool.MaxOpenConns)
		}
		if pool.MaxIdleConns > 0 {
			maxIdleConns := pool.MaxIdleConns
			if pool.MaxOpenConns > 0 && maxIdleConns > pool.MaxOpenConns {
				maxIdleConns = pool.MaxOpenConns
			}
			sqlDB.SetMaxIdleConns(maxIdleConns)
		}
		if pool.MaxLifetime > 0 {
			sqlDB.SetConnMaxLifetime(pool.MaxLifetime)
		}
	}

	if err := db.AutoMigrate(
		&model.User{},
		&model.Session{},
		&model.UserPreference{},
		&model.Project{},
		&model.AssetFolder{},
		&model.Asset{},
		&model.Tag{},
		&model.TagClosure{},
		&model.TagAlias{},
		&model.AssetTagBinding{},
		&model.AssetTagOrigin{},
		&model.PromptTagBinding{},
		&model.AssetLineage{},
		&model.AssetUsageEvent{},
		&model.AssetUsageAggregate{},
		&model.AssetUserState{},
		&model.AssetReference{},
		&model.AssetExportBatch{},
		&model.AssetExportItem{},
		&model.SeedanceAssetGroup{},
		&model.SeedanceAsset{},
		&model.SeedanceAssetTag{},
		&model.SeedanceAssetTagBinding{},
		&model.CanvasSnapshot{},
		&model.ModelProviderConfig{},
		&model.AIRequestLog{},
		&model.SystemAnnouncement{},
		&model.SystemAnnouncementRead{},
		&model.Job{},
		&model.ComicAssetProject{},
		&model.ComicAsset{},
		&model.ComicAssetAnalysisSession{},
		&model.ComicAssetAnalysisRevision{},
		&model.ComicAssetGenerationBatch{},
		&model.ComicAssetGenerationItem{},
	); err != nil {
		return nil, err
	}

	return db, nil
}
