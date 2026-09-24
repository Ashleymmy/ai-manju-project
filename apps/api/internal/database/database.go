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
		&model.RuntimeError{},
		&model.SystemAnnouncement{},
		&model.SystemAnnouncementRead{},
		&model.Job{},
		&model.ComicAssetProject{},
		&model.ComicAsset{},
		&model.ComicAssetAnalysisSession{},
		&model.ComicAssetAnalysisRevision{},
		&model.ComicAssetGenerationBatch{},
		&model.ComicAssetGenerationItem{},
		// WP-M1: membership & credit ledger models.
		&model.MembershipPlan{},
		&model.UserMembership{},
		&model.CreditAccount{},
		&model.CreditGrant{},
		&model.CreditLedgerEntry{},
		&model.TaskConsumption{},
		&model.ModelCostRate{},
		&model.TaskActualCost{},
		&model.CreditPackage{},
		&model.Order{},
		&model.InviteProfile{},
		&model.InviteRecord{},
		&model.AdminAuditLog{},
		&model.BillingConfig{},
		&model.RedemptionCode{},
		&model.RedemptionRecord{},
	); err != nil {
		return nil, err
	}

	if err := applyMembershipLedgerConstraints(db); err != nil {
		return nil, err
	}

	return db, nil
}

// applyMembershipLedgerConstraints executes the two constraints AutoMigrate
// cannot express:
//
//  1. Partial unique index — a user may hold at most one ACTIVE membership
//     row (Postgres-only feature; the Memory repository enforces the same
//     rule in its Upsert path).
//  2. Append-only enforcement — REVOKE UPDATE/DELETE on the credit ledger and
//     the admin audit log from PUBLIC. Note: the app connects as the table
//     owner, which keeps full privileges, so the primary guarantee remains the
//     application layer exposing no mutation path; full enforcement requires a
//     dedicated non-owner DB role at deployment time.
func applyMembershipLedgerConstraints(db *gorm.DB) error {
	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_one_active
			ON user_memberships (user_id) WHERE status = 'active'`,
		`REVOKE UPDATE, DELETE ON TABLE credit_ledger_entries FROM PUBLIC`,
		`REVOKE UPDATE, DELETE ON TABLE admin_audit_logs FROM PUBLIC`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
