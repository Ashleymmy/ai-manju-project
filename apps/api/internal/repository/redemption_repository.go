package repository

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Redemption repository sentinel errors.
var (
	ErrRedemptionCodeNotFound = errors.New("redemption code not found")
	ErrRedemptionUnavailable  = errors.New("redemption code is disabled, exhausted, or expired")
	ErrRedemptionAlreadyUsed  = errors.New("redemption code already used by this user")
)

// RedemptionRepository 兑换码仓储（WP-M14）。核销是原子操作：
// 守卫更新（enabled + 次数 + 有效期 + 每人一次）一步完成。
type RedemptionRepository interface {
	CreateCode(code model.RedemptionCode) (model.RedemptionCode, error)
	GetCodeByCode(code string) (model.RedemptionCode, error)
	ListCodes(page int, pageSize int) ([]model.RedemptionCode, int64, error)
	// RedeemAtomic 原子核销：成功返回新记录；已用过/不可用/次数尽返回对应哨兵。
	RedeemAtomic(codeID string, userID string, now time.Time) (model.RedemptionRecord, error)
	ListRecordsByCode(codeID string) ([]model.RedemptionRecord, error)
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

type MemoryRedemptionRepository struct {
	mu      sync.Mutex
	codes   map[string]model.RedemptionCode
	byCode  map[string]string
	records map[string]model.RedemptionRecord
}

func NewMemoryRedemptionRepository() *MemoryRedemptionRepository {
	return &MemoryRedemptionRepository{
		codes: make(map[string]model.RedemptionCode), byCode: make(map[string]string),
		records: make(map[string]model.RedemptionRecord),
	}
}

func (r *MemoryRedemptionRepository) CreateCode(code model.RedemptionCode) (model.RedemptionCode, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if code.ID == "" {
		code.ID = "rc_" + randomRepositoryHex(12)
	}
	if code.CreatedAt.IsZero() {
		code.CreatedAt = time.Now().UTC()
	}
	r.codes[code.ID] = code
	r.byCode[code.Code] = code.ID
	return code, nil
}

func (r *MemoryRedemptionRepository) GetCodeByCode(code string) (model.RedemptionCode, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id, ok := r.byCode[code]
	if !ok {
		return model.RedemptionCode{}, ErrRedemptionCodeNotFound
	}
	return r.codes[id], nil
}

func (r *MemoryRedemptionRepository) ListCodes(page int, pageSize int) ([]model.RedemptionCode, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]model.RedemptionCode, 0, len(r.codes))
	for _, code := range r.codes {
		items = append(items, code)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].CreatedAt.After(items[j].CreatedAt)
		}
		return items[i].ID > items[j].ID
	})
	paged, total := paginateMemorySlice(items, page, pageSize)
	return paged, total, nil
}

func (r *MemoryRedemptionRepository) RedeemAtomic(codeID string, userID string, now time.Time) (model.RedemptionRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	code, ok := r.codes[codeID]
	if !ok {
		return model.RedemptionRecord{}, ErrRedemptionCodeNotFound
	}
	if !code.Enabled || (code.MaxUses > 0 && code.UsedCount >= code.MaxUses) || (code.ExpiresAt != nil && !code.ExpiresAt.After(now)) {
		return model.RedemptionRecord{}, ErrRedemptionUnavailable
	}
	for _, record := range r.records {
		if record.CodeID == codeID && record.UserID == userID {
			return model.RedemptionRecord{}, ErrRedemptionAlreadyUsed
		}
	}
	code.UsedCount++
	r.codes[codeID] = code
	record := model.RedemptionRecord{ID: "rr_" + randomRepositoryHex(12), CodeID: codeID, UserID: userID, CreatedAt: now}
	r.records[record.ID] = record
	return record, nil
}

func (r *MemoryRedemptionRepository) ListRecordsByCode(codeID string) ([]model.RedemptionRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]model.RedemptionRecord, 0)
	for _, record := range r.records {
		if record.CodeID == codeID {
			items = append(items, record)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

// ---------------------------------------------------------------------------
// Gorm
// ---------------------------------------------------------------------------

type GormRedemptionRepository struct {
	db *gorm.DB
}

func NewGormRedemptionRepository(db *gorm.DB) *GormRedemptionRepository {
	return &GormRedemptionRepository{db: db}
}

func (r *GormRedemptionRepository) CreateCode(code model.RedemptionCode) (model.RedemptionCode, error) {
	if code.ID == "" {
		code.ID = "rc_" + randomRepositoryHex(12)
	}
	if code.CreatedAt.IsZero() {
		code.CreatedAt = time.Now().UTC()
	}
	if err := r.db.Create(&code).Error; err != nil {
		return model.RedemptionCode{}, err
	}
	return code, nil
}

func (r *GormRedemptionRepository) GetCodeByCode(code string) (model.RedemptionCode, error) {
	var result model.RedemptionCode
	if err := r.db.First(&result, "code = ?", code).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.RedemptionCode{}, ErrRedemptionCodeNotFound
		}
		return model.RedemptionCode{}, err
	}
	return result, nil
}

func (r *GormRedemptionRepository) ListCodes(page int, pageSize int) ([]model.RedemptionCode, int64, error) {
	if page < 1 {
		page = 1
	}
	items := make([]model.RedemptionCode, 0)
	var total int64
	if err := r.db.Model(&model.RedemptionCode{}).Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := r.db.Order("created_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error
	return items, total, err
}

// RedeemAtomic 单事务：锁定码行 → 校验可用性 → 次数+1 → 插核销记录
// （code_id+user_id 唯一索引兜底重复核销）。
func (r *GormRedemptionRepository) RedeemAtomic(codeID string, userID string, now time.Time) (model.RedemptionRecord, error) {
	var record model.RedemptionRecord
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var code model.RedemptionCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&code, "id = ?", codeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRedemptionCodeNotFound
			}
			return err
		}
		if !code.Enabled || (code.MaxUses > 0 && code.UsedCount >= code.MaxUses) || (code.ExpiresAt != nil && !code.ExpiresAt.After(now)) {
			return ErrRedemptionUnavailable
		}
		var dupCount int64
		if err := tx.Model(&model.RedemptionRecord{}).Where("code_id = ? AND user_id = ?", codeID, userID).Count(&dupCount).Error; err != nil {
			return err
		}
		if dupCount > 0 {
			return ErrRedemptionAlreadyUsed
		}
		if err := tx.Model(&model.RedemptionCode{}).Where("id = ?", codeID).Update("used_count", code.UsedCount+1).Error; err != nil {
			return err
		}
		record = model.RedemptionRecord{ID: "rr_" + randomRepositoryHex(12), CodeID: codeID, UserID: userID, CreatedAt: now}
		return tx.Create(&record).Error
	})
	return record, err
}

func (r *GormRedemptionRepository) ListRecordsByCode(codeID string) ([]model.RedemptionRecord, error) {
	items := make([]model.RedemptionRecord, 0)
	err := r.db.Where("code_id = ?", codeID).Order("created_at DESC").Find(&items).Error
	return items, err
}
