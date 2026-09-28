package repository

import (
	"context"
	"errors"
	"hash/fnv"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GormCreditRepository is the PostgreSQL implementation. Every mutation runs
// in one transaction and takes locks in a fixed order — account row first,
// then grant rows in FEFO order — so concurrent reserves cannot deadlock or
// overspend. Semantics must match MemoryCreditRepository exactly.
type GormCreditRepository struct {
	db *gorm.DB
}

func NewGormCreditRepository(db *gorm.DB) *GormCreditRepository {
	return &GormCreditRepository{db: db}
}

func (r *GormCreditRepository) EnsureAccount(userID string, now time.Time) (model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		locked, err := lockAccountForUpdate(tx, userID, now)
		if err != nil {
			return err
		}
		account = locked
		return nil
	})
	return account, err
}

// lockAccountForUpdate reads the account under SELECT ... FOR UPDATE, creating
// the zero-balance row first when missing. OnConflict-DoNothing keeps the
// create safe against a racing creator.
func lockAccountForUpdate(tx *gorm.DB, userID string, now time.Time) (model.CreditAccount, error) {
	var account model.CreditAccount
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "user_id = ?", userID).Error
	if err == nil {
		return account, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CreditAccount{}, err
	}
	fresh := model.CreditAccount{UserID: userID, CreatedAt: now, UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&fresh).Error; err != nil {
		return model.CreditAccount{}, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "user_id = ?", userID).Error; err != nil {
		return model.CreditAccount{}, err
	}
	return account, nil
}

func (r *GormCreditRepository) GetAccount(userID string) (model.CreditAccount, error) {
	var account model.CreditAccount
	if err := r.db.First(&account, "user_id = ?", userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CreditAccount{}, ErrCreditAccountNotFound
		}
		return model.CreditAccount{}, err
	}
	return account, nil
}

func (r *GormCreditRepository) GetGrantByID(id string) (model.CreditGrant, error) {
	var grant model.CreditGrant
	if err := r.db.First(&grant, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CreditGrant{}, ErrCreditGrantNotFound
		}
		return model.CreditGrant{}, err
	}
	return grant, nil
}

func (r *GormCreditRepository) GetGrantByPeriodKey(periodKey string) (model.CreditGrant, error) {
	var grant model.CreditGrant
	if err := r.db.First(&grant, "period_key = ?", periodKey).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CreditGrant{}, ErrCreditGrantNotFound
		}
		return model.CreditGrant{}, err
	}
	return grant, nil
}

func (r *GormCreditRepository) ListActiveGrants(userID string, now time.Time) ([]model.CreditGrant, error) {
	grants := make([]model.CreditGrant, 0)
	err := r.db.
		Where("user_id = ? AND status = ? AND expires_at > ?", userID, model.GrantStatusActive, now).
		Order("expires_at ASC, id ASC").
		Find(&grants).Error
	return grants, err
}

func (r *GormCreditRepository) ListGrantsByUser(userID string) ([]model.CreditGrant, error) {
	grants := make([]model.CreditGrant, 0)
	err := r.db.Where("user_id = ?", userID).Order("expires_at ASC, id ASC").Find(&grants).Error
	return grants, err
}

func (r *GormCreditRepository) ListGrantsByRelatedID(relatedID string, sourceType string) ([]model.CreditGrant, error) {
	grants := make([]model.CreditGrant, 0)
	err := r.db.
		Where("related_id = ? AND source_type = ?", relatedID, sourceType).
		Order("expires_at ASC, id ASC").
		Find(&grants).Error
	return grants, err
}

func (r *GormCreditRepository) ListExpirableGrants(now time.Time, limit int) ([]model.CreditGrant, error) {
	grants := make([]model.CreditGrant, 0)
	query := r.db.
		Where("status = ? AND expires_at <= ? AND amount_remaining > amount_frozen", model.GrantStatusActive, now).
		Order("expires_at ASC, id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&grants).Error
	return grants, err
}

func (r *GormCreditRepository) LedgerEntryExists(idempotencyKey string) (bool, error) {
	var count int64
	err := r.db.Model(&model.CreditLedgerEntry{}).Where("idempotency_key = ?", idempotencyKey).Count(&count).Error
	return count > 0, err
}

func (r *GormCreditRepository) ListLedger(userID string, entryType string, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error) {
	if page < 1 {
		page = 1
	}
	entries := make([]model.CreditLedgerEntry, 0)
	base := r.db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", userID)
	if entryType != "" {
		base = base.Where("entry_type = ?", entryType)
	}
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := base.
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&entries).Error
	return entries, total, err
}

func (r *GormCreditRepository) ListLedgerGlobal(userID string, entryType string, start time.Time, end time.Time, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error) {
	if page < 1 {
		page = 1
	}
	entries := make([]model.CreditLedgerEntry, 0)
	base := r.db.Model(&model.CreditLedgerEntry{})
	if userID != "" {
		base = base.Where("user_id = ?", userID)
	}
	if entryType != "" {
		base = base.Where("entry_type = ?", entryType)
	}
	if !start.IsZero() {
		base = base.Where("created_at >= ?", start)
	}
	if !end.IsZero() {
		base = base.Where("created_at <= ?", end)
	}
	// Count 用单独 session，避免与列表查询互相污染
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := base.
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&entries).Error
	return entries, total, err
}

func (r *GormCreditRepository) ListConsumptionsGlobal(userID string, taskType string, status string, start time.Time, end time.Time, page int, pageSize int) ([]model.TaskConsumption, int64, error) {
	if page < 1 {
		page = 1
	}
	consumptions := make([]model.TaskConsumption, 0)
	base := r.db.Model(&model.TaskConsumption{})
	if userID != "" {
		base = base.Where("user_id = ?", userID)
	}
	if taskType != "" {
		base = base.Where("task_type = ?", taskType)
	}
	if status != "" {
		base = base.Where("status = ?", status)
	}
	if !start.IsZero() {
		base = base.Where("created_at >= ?", start)
	}
	if !end.IsZero() {
		base = base.Where("created_at <= ?", end)
	}
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := base.
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&consumptions).Error
	return consumptions, total, err
}

// ConsumptionStats：为保持与 Memory 版口径一致，行数据取出后在 Go 里
// 统计（duration_sec 也走 JSON 解析，不用 SQL jsonb 函数）。
func (r *GormCreditRepository) ConsumptionStats(userID string) (ConsumptionStats, error) {
	return r.ConsumptionStatsInRange(userID, time.Time{}, time.Time{})
}

func (r *GormCreditRepository) ConsumptionStatsInRange(userID string, start time.Time, end time.Time) (ConsumptionStats, error) {
	consumptions := make([]model.TaskConsumption, 0)
	query := r.db.Model(&model.TaskConsumption{})
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if !start.IsZero() {
		query = query.Where("created_at >= ?", start)
	}
	if !end.IsZero() {
		query = query.Where("created_at <= ?", end)
	}
	if err := query.Find(&consumptions).Error; err != nil {
		return ConsumptionStats{}, err
	}
	return computeConsumptionStats(consumptions), nil
}

// SumConsumedCredits：SQL 侧直接合计 -amount，空结果回 0。
func (r *GormCreditRepository) SumConsumedCredits(start time.Time, end time.Time) (int64, error) {
	base := r.db.Model(&model.CreditLedgerEntry{}).Where("entry_type = ?", model.LedgerTypeConsume)
	if !start.IsZero() {
		base = base.Where("created_at >= ?", start)
	}
	if !end.IsZero() {
		base = base.Where("created_at <= ?", end)
	}
	var total int64
	if err := base.Select("COALESCE(SUM(-amount), 0)").Row().Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *GormCreditRepository) GetConsumptionByJobID(jobID string) (model.TaskConsumption, error) {
	var consumption model.TaskConsumption
	if err := r.db.First(&consumption, "job_id = ?", jobID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.TaskConsumption{}, ErrConsumptionNotFound
		}
		return model.TaskConsumption{}, err
	}
	return consumption, nil
}

func (r *GormCreditRepository) ListConsumptions(userID string, status string, page int, pageSize int) ([]model.TaskConsumption, int64, error) {
	if page < 1 {
		page = 1
	}
	consumptions := make([]model.TaskConsumption, 0)
	base := r.db.Model(&model.TaskConsumption{}).Where("user_id = ?", userID)
	if status != "" {
		base = base.Where("status = ?", status)
	}
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := base.
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&consumptions).Error
	return consumptions, total, err
}

func (r *GormCreditRepository) ListReservedConsumptions(limit int) ([]model.TaskConsumption, error) {
	consumptions := make([]model.TaskConsumption, 0)
	query := r.db.
		Where("status = ?", model.TaskConsumptionStatusReserved).
		Order("created_at ASC, id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&consumptions).Error
	return consumptions, err
}

func (r *GormCreditRepository) CreateGrantWithLedger(grant model.CreditGrant, entryType string, operatorID string, relatedOrderID string, now time.Time) (GrantOutcome, error) {
	if grant.PeriodKey == "" {
		grant.PeriodKey = "grant:" + randomRepositoryHex(12)
	}
	if grant.ID == "" {
		grant.ID = "grant_" + randomRepositoryHex(12)
	}
	grant.CreatedAt = now

	var outcome GrantOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "period_key"}}, DoNothing: true}).Create(&grant)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var existing model.CreditGrant
			if err := tx.First(&existing, "period_key = ?", grant.PeriodKey).Error; err != nil {
				return err
			}
			outcome = GrantOutcome{Grant: existing, Created: false}
			return nil
		}

		account, err := lockAccountForUpdate(tx, grant.UserID, now)
		if err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{
			ID:                  "led_" + randomRepositoryHex(12),
			UserID:              grant.UserID,
			EntryType:           entryType,
			Amount:              grant.AmountTotal,
			Bucket:              model.CreditBucketGrant,
			GrantID:             grant.ID,
			PermanentAfter:      account.PermanentBalance,
			GrantRemainingAfter: grant.AmountRemaining,
			OrderID:             relatedOrderID,
			OperatorID:          operatorID,
			IdempotencyKey:      "grant:" + grant.PeriodKey,
			CreatedAt:           now,
		}
		if err := tx.Create(&entry).Error; err != nil {
			return err
		}
		outcome = GrantOutcome{Grant: grant, Created: true}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) Reserve(input ReserveInput) (ReserveOutcome, error) {
	var outcome ReserveOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Idempotent replay: the job already holds a consumption record.
		var existing model.TaskConsumption
		probe := tx.First(&existing, "job_id = ?", input.JobID)
		if probe.Error == nil {
			outcome = ReserveOutcome{Consumption: existing, Duplicate: true}
			return nil
		}
		if !errors.Is(probe.Error, gorm.ErrRecordNotFound) {
			return probe.Error
		}

		account, err := lockAccountForUpdate(tx, input.UserID, input.Now)
		if err != nil {
			return err
		}

		grants := make([]model.CreditGrant, 0)
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ? AND status = ? AND expires_at > ?", input.UserID, model.GrantStatusActive, input.Now).
			Order("expires_at ASC, id ASC").
			Find(&grants).Error; err != nil {
			return err
		}

		var grantAvailable int64
		for _, grant := range grants {
			grantAvailable += grant.AmountRemaining - grant.AmountFrozen
		}
		permanentAvailable := account.PermanentBalance - account.PermanentFrozen
		if permanentAvailable < 0 {
			permanentAvailable = 0
		}
		if grantAvailable+permanentAvailable < input.Credits {
			return ErrInsufficientCredits
		}

		allocation := make([]model.CreditAllocationItem, 0)
		remaining := input.Credits
		for _, grant := range grants {
			if remaining == 0 {
				break
			}
			spendable := grant.AmountRemaining - grant.AmountFrozen
			if spendable <= 0 {
				continue
			}
			take := spendable
			if take > remaining {
				take = remaining
			}
			if err := tx.Model(&model.CreditGrant{}).Where("id = ?", grant.ID).
				Update("amount_frozen", grant.AmountFrozen+take).Error; err != nil {
				return err
			}
			allocation = append(allocation, model.CreditAllocationItem{Bucket: model.CreditBucketGrant, GrantID: grant.ID, Amount: take})
			remaining -= take
		}
		if remaining > 0 {
			account.PermanentFrozen += remaining
			allocation = append(allocation, model.CreditAllocationItem{Bucket: model.CreditBucketPermanent, Amount: remaining})
		}
		account.UpdatedAt = input.Now
		if err := tx.Save(&account).Error; err != nil {
			return err
		}

		consumption := model.TaskConsumption{
			ID:            "cons_" + randomRepositoryHex(12),
			JobID:         input.JobID,
			UserID:        input.UserID,
			TaskType:      input.TaskType,
			Model:         input.Model,
			Params:        input.Params,
			CreditsQuoted: input.Credits,
			Allocation:    marshalAllocation(allocation),
			Status:        model.TaskConsumptionStatusReserved,
			CreatedAt:     input.Now,
		}
		if err := tx.Create(&consumption).Error; err != nil {
			return err
		}
		outcome = ReserveOutcome{Consumption: consumption}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) Settle(jobID string, now time.Time) (SettleOutcome, error) {
	return r.settle(jobID, nil, now)
}

func (r *GormCreditRepository) SettleAmount(jobID string, credits int64, params model.JSONB, now time.Time) (SettleOutcome, error) {
	return r.settle(jobID, &creditSettlement{Credits: credits, Params: params}, now)
}

func (r *GormCreditRepository) settle(jobID string, settlement *creditSettlement, now time.Time) (SettleOutcome, error) {
	var outcome SettleOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var consumption model.TaskConsumption
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&consumption, "job_id = ?", jobID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConsumptionNotFound
			}
			return err
		}
		if consumption.Status != model.TaskConsumptionStatusReserved {
			outcome = SettleOutcome{Consumption: consumption, Changed: false}
			return nil
		}
		charged, err := settlementCredits(consumption, settlement)
		if err != nil {
			return err
		}

		allocation, err := unmarshalAllocation(consumption.Allocation)
		if err != nil {
			return err
		}
		if err := validateSettlementAllocation(allocation, consumption.CreditsQuoted); err != nil {
			return err
		}

		account, err := lockAccountForUpdate(tx, consumption.UserID, now)
		if err != nil {
			return err
		}
		remainingCharge := charged

		// Grant buckets first, permanent last — same ordering as the Memory
		// implementation so ledger snapshots match.
		for _, item := range allocation {
			if item.Bucket != model.CreditBucketGrant {
				continue
			}
			var grant model.CreditGrant
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&grant, "id = ?", item.GrantID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrCreditGrantNotFound
				}
				return err
			}
			grant.AmountFrozen -= item.Amount
			take := min(item.Amount, remainingCharge)
			remainingCharge -= take
			grant.AmountRemaining -= take
			expired := grant.Status == model.GrantStatusExpired || !grant.ExpiresAt.After(now)
			if grant.AmountRemaining == 0 && grant.AmountFrozen == 0 {
				grant.Status = model.GrantStatusExhausted
			}
			if take > 0 {
				entry := model.CreditLedgerEntry{
					ID:                  "led_" + randomRepositoryHex(12),
					UserID:              consumption.UserID,
					EntryType:           model.LedgerTypeConsume,
					Amount:              -take,
					Bucket:              model.CreditBucketGrant,
					GrantID:             grant.ID,
					PermanentAfter:      account.PermanentBalance,
					GrantRemainingAfter: grant.AmountRemaining,
					JobID:               jobID,
					OperatorID:          "system",
					IdempotencyKey:      "consume:" + jobID + ":grant:" + grant.ID,
					CreatedAt:           now,
				}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
			if released := item.Amount - take; expired && released > 0 {
				grant.AmountRemaining -= released
				entry := model.CreditLedgerEntry{ID: "led_" + randomRepositoryHex(12), UserID: consumption.UserID, EntryType: model.LedgerTypeExpire, Amount: -released, Bucket: model.CreditBucketGrant, GrantID: grant.ID, PermanentAfter: account.PermanentBalance, GrantRemainingAfter: grant.AmountRemaining, JobID: jobID, OperatorID: "system", IdempotencyKey: "expire-settle:" + jobID + ":" + grant.ID, CreatedAt: now}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
			if expired && take < item.Amount && grant.AmountRemaining == 0 && grant.AmountFrozen == 0 {
				grant.Status = model.GrantStatusExpired
			}
			if err := tx.Save(&grant).Error; err != nil {
				return err
			}
		}
		for _, item := range allocation {
			if item.Bucket != model.CreditBucketPermanent {
				continue
			}
			account.PermanentFrozen -= item.Amount
			take := min(item.Amount, remainingCharge)
			remainingCharge -= take
			account.PermanentBalance -= take
			if take > 0 {
				entry := model.CreditLedgerEntry{
					ID:             "led_" + randomRepositoryHex(12),
					UserID:         consumption.UserID,
					EntryType:      model.LedgerTypeConsume,
					Amount:         -take,
					Bucket:         model.CreditBucketPermanent,
					PermanentAfter: account.PermanentBalance,
					JobID:          jobID,
					OperatorID:     "system",
					IdempotencyKey: "consume:" + jobID + ":permanent",
					CreatedAt:      now,
				}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
		}
		account.UpdatedAt = now
		if err := tx.Save(&account).Error; err != nil {
			return err
		}

		consumption.Status = model.TaskConsumptionStatusSettled
		consumption.CreditsSettled = charged
		if settlement != nil {
			consumption.Params = settlement.Params
		}
		consumption.SettledAt = &now
		if err := tx.Save(&consumption).Error; err != nil {
			return err
		}
		outcome = SettleOutcome{Consumption: consumption, Changed: true}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) Release(jobID string, now time.Time) (ReleaseOutcome, error) {
	var outcome ReleaseOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var consumption model.TaskConsumption
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&consumption, "job_id = ?", jobID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConsumptionNotFound
			}
			return err
		}
		if consumption.Status != model.TaskConsumptionStatusReserved {
			outcome = ReleaseOutcome{Consumption: consumption, Changed: false}
			return nil
		}

		allocation, err := unmarshalAllocation(consumption.Allocation)
		if err != nil {
			return err
		}

		account, err := lockAccountForUpdate(tx, consumption.UserID, now)
		if err != nil {
			return err
		}

		for _, item := range allocation {
			if item.Bucket != model.CreditBucketGrant {
				continue
			}
			var grant model.CreditGrant
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&grant, "id = ?", item.GrantID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrCreditGrantNotFound
				}
				return err
			}
			grant.AmountFrozen -= item.Amount
			// 冻结退回不动 remaining；批次已过期且无剩余时直接标记过期。
			if grant.Status == model.GrantStatusExpired || !grant.ExpiresAt.After(now) {
				grant.AmountRemaining -= item.Amount
				entry := model.CreditLedgerEntry{ID: "led_" + randomRepositoryHex(12), UserID: grant.UserID, EntryType: model.LedgerTypeExpire, Amount: -item.Amount, Bucket: model.CreditBucketGrant, GrantID: grant.ID, JobID: jobID, PermanentAfter: account.PermanentBalance, GrantRemainingAfter: grant.AmountRemaining, OperatorID: "system", IdempotencyKey: "expire-release:" + jobID + ":" + grant.ID, CreatedAt: now}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
			if grant.AmountRemaining == 0 && grant.AmountFrozen == 0 && grant.Status == model.GrantStatusActive && !grant.ExpiresAt.After(now) {
				grant.Status = model.GrantStatusExpired
			}
			if err := tx.Save(&grant).Error; err != nil {
				return err
			}
		}
		for _, item := range allocation {
			if item.Bucket != model.CreditBucketPermanent {
				continue
			}
			account.PermanentFrozen -= item.Amount
		}
		account.UpdatedAt = now
		if err := tx.Save(&account).Error; err != nil {
			return err
		}

		consumption.Status = model.TaskConsumptionStatusReleased
		consumption.SettledAt = &now
		if err := tx.Save(&consumption).Error; err != nil {
			return err
		}
		outcome = ReleaseOutcome{Consumption: consumption, Changed: true}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) ExpireGrant(grantID string, now time.Time) (ExpireOutcome, error) {
	var outcome ExpireOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Match Reserve/Settle/Release lock order: account, then grant. Acquiring
		// the grant first can deadlock against a task completing at expiry.
		var initial model.CreditGrant
		if err := tx.First(&initial, "id = ?", grantID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCreditGrantNotFound
			}
			return err
		}
		account, err := lockAccountForUpdate(tx, initial.UserID, now)
		if err != nil {
			return err
		}
		var grant model.CreditGrant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&grant, "id = ?", grantID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCreditGrantNotFound
			}
			return err
		}
		if grant.Status != model.GrantStatusActive {
			outcome = ExpireOutcome{Grant: grant, AlreadyExpired: true}
			return nil
		}

		deductible := grant.AmountRemaining - grant.AmountFrozen
		if deductible > 0 {
			key := "expire:" + grant.ID
			var seen int64
			if err := tx.Model(&model.CreditLedgerEntry{}).Where("idempotency_key = ?", key).Count(&seen).Error; err != nil {
				return err
			}
			if seen > 0 {
				outcome = ExpireOutcome{Grant: grant, AlreadyExpired: true}
				return nil
			}
			grant.AmountRemaining = grant.AmountFrozen
			entry := model.CreditLedgerEntry{
				ID:                  "led_" + randomRepositoryHex(12),
				UserID:              grant.UserID,
				EntryType:           model.LedgerTypeExpire,
				Amount:              -deductible,
				Bucket:              model.CreditBucketGrant,
				GrantID:             grant.ID,
				PermanentAfter:      account.PermanentBalance,
				GrantRemainingAfter: grant.AmountRemaining,
				OperatorID:          "system",
				IdempotencyKey:      key,
				CreatedAt:           now,
			}
			if err := tx.Create(&entry).Error; err != nil {
				return err
			}
		}
		grant.Status = model.GrantStatusExpired
		if err := tx.Save(&grant).Error; err != nil {
			return err
		}
		outcome = ExpireOutcome{Grant: grant, Deducted: deductible}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) AdjustPermanent(userID string, delta int64, entryType string, operatorID string, nonce string, now time.Time) (AdjustOutcome, error) {
	if nonce == "" {
		nonce = "adjust:" + randomRepositoryHex(12)
	}
	var outcome AdjustOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var seen int64
		if err := tx.Model(&model.CreditLedgerEntry{}).Where("idempotency_key = ?", nonce).Count(&seen).Error; err != nil {
			return err
		}
		account, err := lockAccountForUpdate(tx, userID, now)
		if err != nil {
			return err
		}
		if seen > 0 {
			outcome = AdjustOutcome{Account: account, Applied: false}
			return nil
		}

		account.PermanentBalance += delta
		account.UpdatedAt = now
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{
			ID:             "led_" + randomRepositoryHex(12),
			UserID:         userID,
			EntryType:      entryType,
			Amount:         delta,
			Bucket:         model.CreditBucketPermanent,
			PermanentAfter: account.PermanentBalance,
			OperatorID:     operatorID,
			IdempotencyKey: nonce,
			CreatedAt:      now,
		}
		if err := tx.Create(&entry).Error; err != nil {
			return err
		}
		outcome = AdjustOutcome{Account: account, Applied: true}
		return nil
	})
	return outcome, err
}

func (r *GormCreditRepository) GetLedgerByIdempotencyKey(key string) (model.CreditLedgerEntry, error) {
	var entry model.CreditLedgerEntry
	err := r.db.First(&entry, "idempotency_key = ?", key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CreditLedgerEntry{}, ErrCreditLedgerNotFound
	}
	return entry, err
}

func (r *GormCreditRepository) DeductPermanentForRefund(userID string, credits int64, orderID string, now time.Time) (bool, error) {
	key := "refund:" + orderID
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var seen int64
		if err := tx.Model(&model.CreditLedgerEntry{}).Where("idempotency_key = ?", key).Count(&seen).Error; err != nil {
			return err
		}
		if seen > 0 {
			return nil
		}
		account, err := lockAccountForUpdate(tx, userID, now)
		if err != nil {
			return err
		}
		account.PermanentBalance -= credits
		account.UpdatedAt = now
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{
			ID:             "led_" + randomRepositoryHex(12),
			UserID:         userID,
			EntryType:      model.LedgerTypeRefundRollback,
			Amount:         -credits,
			Bucket:         model.CreditBucketPermanent,
			PermanentAfter: account.PermanentBalance,
			OrderID:        orderID,
			OperatorID:     "system",
			IdempotencyKey: key,
			CreatedAt:      now,
		}
		if err := tx.Create(&entry).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	return applied, err
}

// TryAcquireSchedulerLock takes a Postgres session-level advisory lock on a
// dedicated connection (advisory locks are per-session, so the pooled *gorm.DB
// must not be used — unlock would race other pool users). The returned release
// unlocks and closes the connection. When another replica holds the lock,
// acquired=false and release is nil.
func (r *GormCreditRepository) TryAcquireSchedulerLock(name string) (func(), bool, error) {
	sqlDB, err := r.db.DB()
	if err != nil {
		return nil, false, err
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	key := advisoryLockKey(name)
	var acquired bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, false, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, false, nil
	}
	release := func() {
		_, _ = conn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", key)
		_ = conn.Close()
	}
	return release, true, nil
}

// advisoryLockKey hashes the lock name into the bigint key space Postgres
// expects. FNV-1a 64 位转 int64（符号位不影响唯一性）。
func advisoryLockKey(name string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte("credit-scheduler:" + name))
	return int64(hash.Sum64())
}
