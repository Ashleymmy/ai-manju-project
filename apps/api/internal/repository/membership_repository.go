package repository

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrMembershipPlanNotFound  = errors.New("membership plan not found")
	ErrMembershipNotFound      = errors.New("membership not found")
	ErrMembershipAlreadyActive = errors.New("user already has an active membership")
)

// MembershipRepository 会员套餐与会员周期仓储。
// 关键不变量：同一用户最多存在一条 status='active' 的 UserMembership。
// Postgres 端由部分唯一索引 idx_user_memberships_one_active 兜底，
// Memory 端在 CreateMembership 中做同等检查。
type MembershipRepository interface {
	SeedPlans(plans []model.MembershipPlan) error
	ListPlans(enabledOnly bool) ([]model.MembershipPlan, error)
	GetPlanByCode(code string) (model.MembershipPlan, error)
	GetPlanByID(id string) (model.MembershipPlan, error)
	UpsertPlan(plan model.MembershipPlan) (model.MembershipPlan, error)
	CreateMembership(m model.UserMembership) (model.UserMembership, error)
	GetActiveMembership(userID string, now time.Time) (model.UserMembership, error)
	GetMembershipByID(id string) (model.UserMembership, error)
	GetMembershipByOrderID(orderID string) (model.UserMembership, error)
	UpdateMembershipStatus(id string, from string, to string) (bool, error)
	ListActiveMembershipsExpiringBefore(now time.Time, limit int) ([]model.UserMembership, error)
	// ListActiveMemberships pages all active memberships (created_at ASC, id ASC)
	// for the monthly-grant scheduler. offset 分页在发放幂等的前提下是安全的。
	ListActiveMemberships(limit int, offset int) ([]model.UserMembership, error)
}

type MemoryMembershipRepository struct {
	mu          sync.RWMutex
	plans       map[string]model.MembershipPlan // key = ID
	plansByCode map[string]string               // code -> ID
	memberships map[string]model.UserMembership // key = ID
}

func NewMemoryMembershipRepository() *MemoryMembershipRepository {
	return &MemoryMembershipRepository{
		plans:       make(map[string]model.MembershipPlan),
		plansByCode: make(map[string]string),
		memberships: make(map[string]model.UserMembership),
	}
}

// SeedPlans 按 Code 幂等 upsert：已存在时保留 ID/CreatedAt，仅更新业务字段。
func (r *MemoryMembershipRepository) SeedPlans(plans []model.MembershipPlan) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	for _, plan := range plans {
		if existingID, ok := r.plansByCode[plan.Code]; ok {
			existing := r.plans[existingID]
			plan.ID = existing.ID
			plan.CreatedAt = existing.CreatedAt
		} else if plan.ID == "" {
			plan.ID = "plan_" + randomRepositoryHex(12)
			plan.CreatedAt = now
		}
		plan.UpdatedAt = now
		r.plans[plan.ID] = plan
		r.plansByCode[plan.Code] = plan.ID
	}

	return nil
}

func (r *MemoryMembershipRepository) ListPlans(enabledOnly bool) ([]model.MembershipPlan, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	plans := make([]model.MembershipPlan, 0, len(r.plans))
	for _, plan := range r.plans {
		if enabledOnly && !plan.Enabled {
			continue
		}
		plans = append(plans, plan)
	}
	// 与 Gorm 版排序逐一致：PriceMonthCents ASC, Code ASC
	sort.Slice(plans, func(i, j int) bool {
		if plans[i].PriceMonthCents != plans[j].PriceMonthCents {
			return plans[i].PriceMonthCents < plans[j].PriceMonthCents
		}
		return plans[i].Code < plans[j].Code
	})

	return plans, nil
}

func (r *MemoryMembershipRepository) GetPlanByCode(code string) (model.MembershipPlan, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	id, ok := r.plansByCode[code]
	if !ok {
		return model.MembershipPlan{}, ErrMembershipPlanNotFound
	}

	return r.plans[id], nil
}

func (r *MemoryMembershipRepository) GetPlanByID(id string) (model.MembershipPlan, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	plan, ok := r.plans[id]
	if !ok {
		return model.MembershipPlan{}, ErrMembershipPlanNotFound
	}

	return plan, nil
}

func (r *MemoryMembershipRepository) UpsertPlan(plan model.MembershipPlan) (model.MembershipPlan, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	if plan.ID == "" {
		plan.ID = "plan_" + randomRepositoryHex(12)
		plan.CreatedAt = now
	} else if existing, ok := r.plans[plan.ID]; ok {
		plan.CreatedAt = existing.CreatedAt
	} else {
		plan.CreatedAt = now
	}
	plan.UpdatedAt = now

	// Code 变更时维护 code -> id 索引，保证 GetPlanByCode 一致
	if old, ok := r.plans[plan.ID]; ok && old.Code != plan.Code {
		delete(r.plansByCode, old.Code)
	}
	r.plans[plan.ID] = plan
	r.plansByCode[plan.Code] = plan.ID

	return plan, nil
}

// CreateMembership 强制「同一用户最多一条 active」不变量。
func (r *MemoryMembershipRepository) CreateMembership(m model.UserMembership) (model.UserMembership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if m.Status == model.MembershipStatusActive {
		for _, existing := range r.memberships {
			if existing.UserID == m.UserID && existing.Status == model.MembershipStatusActive {
				return model.UserMembership{}, ErrMembershipAlreadyActive
			}
		}
	}

	now := time.Now().UTC()
	if m.ID == "" {
		m.ID = "mem_" + randomRepositoryHex(12)
	}
	m.CreatedAt = now
	m.UpdatedAt = now
	r.memberships[m.ID] = m

	return m, nil
}

func (r *MemoryMembershipRepository) GetActiveMembership(userID string, now time.Time) (model.UserMembership, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, m := range r.memberships {
		if m.UserID == userID && m.Status == model.MembershipStatusActive && m.ExpiresAt.After(now) {
			return m, nil
		}
	}

	return model.UserMembership{}, ErrMembershipNotFound
}

func (r *MemoryMembershipRepository) GetMembershipByID(id string) (model.UserMembership, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	m, ok := r.memberships[id]
	if !ok {
		return model.UserMembership{}, ErrMembershipNotFound
	}

	return m, nil
}

// GetMembershipByOrderID 按来源订单反查会员记录（退款回滚用）。
func (r *MemoryMembershipRepository) GetMembershipByOrderID(orderID string) (model.UserMembership, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, m := range r.memberships {
		if m.OrderID == orderID {
			return m, nil
		}
	}

	return model.UserMembership{}, ErrMembershipNotFound
}

// UpdateMembershipStatus 守卫迁移：仅当当前 status==from 才更新，返回是否变更。
func (r *MemoryMembershipRepository) UpdateMembershipStatus(id string, from string, to string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	m, ok := r.memberships[id]
	if !ok {
		return false, ErrMembershipNotFound
	}
	if m.Status != from {
		return false, nil
	}
	m.Status = to
	m.UpdatedAt = time.Now().UTC()
	r.memberships[id] = m

	return true, nil
}

func (r *MemoryMembershipRepository) ListActiveMembershipsExpiringBefore(now time.Time, limit int) ([]model.UserMembership, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]model.UserMembership, 0)
	for _, m := range r.memberships {
		if m.Status == model.MembershipStatusActive && !m.ExpiresAt.After(now) {
			items = append(items, m)
		}
	}
	// 与 Gorm 版排序一致：expires_at ASC
	sort.Slice(items, func(i, j int) bool {
		return items[i].ExpiresAt.Before(items[j].ExpiresAt)
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	return items, nil
}

func (r *MemoryMembershipRepository) ListActiveMemberships(limit int, offset int) ([]model.UserMembership, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]model.UserMembership, 0)
	for _, m := range r.memberships {
		if m.Status == model.MembershipStatusActive {
			items = append(items, m)
		}
	}
	// 与 Gorm 版排序一致：created_at ASC, id ASC
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}
		return items[i].ID < items[j].ID
	})
	if offset > 0 {
		if offset >= len(items) {
			return []model.UserMembership{}, nil
		}
		items = items[offset:]
	}
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	return items, nil
}

type GormMembershipRepository struct {
	db *gorm.DB
}

func NewGormMembershipRepository(db *gorm.DB) *GormMembershipRepository {
	return &GormMembershipRepository{db: db}
}

// membershipPlanUpdatableColumns SeedPlans 冲突时更新的全字段（不含主键/唯一键）。
var membershipPlanUpdatableColumns = []string{
	"name", "price_month_cents", "price_year_cents", "monthly_credits",
	"image_concurrency", "video_concurrency", "credit_discount_bps",
	"priority_rank", "features", "enabled", "updated_at",
}

func (r *GormMembershipRepository) SeedPlans(plans []model.MembershipPlan) error {
	now := time.Now().UTC()
	for index := range plans {
		if plans[index].ID == "" {
			plans[index].ID = "plan_" + randomRepositoryHex(12)
		}
		if plans[index].CreatedAt.IsZero() {
			plans[index].CreatedAt = now
		}
		plans[index].UpdatedAt = now
	}
	if len(plans) == 0 {
		return nil
	}
	// 按 code 幂等 upsert
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "code"}},
		DoUpdates: clause.AssignmentColumns(membershipPlanUpdatableColumns),
	}).Create(&plans).Error
}

func (r *GormMembershipRepository) ListPlans(enabledOnly bool) ([]model.MembershipPlan, error) {
	var plans []model.MembershipPlan
	query := r.db.Model(&model.MembershipPlan{})
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("price_month_cents ASC, code ASC").Find(&plans).Error

	return plans, err
}

func (r *GormMembershipRepository) GetPlanByCode(code string) (model.MembershipPlan, error) {
	var plan model.MembershipPlan
	err := r.db.First(&plan, "code = ?", code).Error

	return plan, mapMembershipGormError(err, ErrMembershipPlanNotFound)
}

func (r *GormMembershipRepository) GetPlanByID(id string) (model.MembershipPlan, error) {
	var plan model.MembershipPlan
	err := r.db.First(&plan, "id = ?", id).Error

	return plan, mapMembershipGormError(err, ErrMembershipPlanNotFound)
}

func (r *GormMembershipRepository) UpsertPlan(plan model.MembershipPlan) (model.MembershipPlan, error) {
	now := time.Now().UTC()
	if plan.ID == "" {
		plan.ID = "plan_" + randomRepositoryHex(12)
		plan.CreatedAt = now
	} else if existing, err := r.GetPlanByID(plan.ID); err == nil {
		plan.CreatedAt = existing.CreatedAt
	} else if !errors.Is(err, ErrMembershipPlanNotFound) {
		return model.MembershipPlan{}, err
	} else {
		plan.CreatedAt = now
	}
	plan.UpdatedAt = now
	if err := r.db.Save(&plan).Error; err != nil {
		return model.MembershipPlan{}, err
	}

	return plan, nil
}

// CreateMembership 依赖部分唯一索引 idx_user_memberships_one_active；
// 冲突时映射为 ErrMembershipAlreadyActive。
func (r *GormMembershipRepository) CreateMembership(m model.UserMembership) (model.UserMembership, error) {
	now := time.Now().UTC()
	if m.ID == "" {
		m.ID = "mem_" + randomRepositoryHex(12)
	}
	m.CreatedAt = now
	m.UpdatedAt = now
	if err := r.db.Create(&m).Error; err != nil {
		if isMembershipActiveConflict(err) {
			return model.UserMembership{}, ErrMembershipAlreadyActive
		}
		return model.UserMembership{}, err
	}

	return m, nil
}

func (r *GormMembershipRepository) GetActiveMembership(userID string, now time.Time) (model.UserMembership, error) {
	var m model.UserMembership
	err := r.db.First(&m, "user_id = ? AND status = ? AND expires_at > ?", userID, model.MembershipStatusActive, now).Error

	return m, mapMembershipGormError(err, ErrMembershipNotFound)
}

func (r *GormMembershipRepository) GetMembershipByID(id string) (model.UserMembership, error) {
	var m model.UserMembership
	err := r.db.First(&m, "id = ?", id).Error

	return m, mapMembershipGormError(err, ErrMembershipNotFound)
}

// GetMembershipByOrderID 按来源订单反查会员记录（退款回滚用）。
func (r *GormMembershipRepository) GetMembershipByOrderID(orderID string) (model.UserMembership, error) {
	var m model.UserMembership
	err := r.db.First(&m, "order_id = ?", orderID).Error

	return m, mapMembershipGormError(err, ErrMembershipNotFound)
}

func (r *GormMembershipRepository) UpdateMembershipStatus(id string, from string, to string) (bool, error) {
	if _, err := r.GetMembershipByID(id); err != nil {
		return false, err
	}
	result := r.db.Model(&model.UserMembership{}).
		Where("id = ? AND status = ?", id, from).
		Updates(map[string]any{"status": to, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return false, result.Error
	}

	return result.RowsAffected > 0, nil
}

func (r *GormMembershipRepository) ListActiveMembershipsExpiringBefore(now time.Time, limit int) ([]model.UserMembership, error) {
	var items []model.UserMembership
	query := r.db.
		Where("status = ? AND expires_at <= ?", model.MembershipStatusActive, now).
		Order("expires_at ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&items).Error

	return items, err
}

func (r *GormMembershipRepository) ListActiveMemberships(limit int, offset int) ([]model.UserMembership, error) {
	items := make([]model.UserMembership, 0)
	query := r.db.
		Where("status = ?", model.MembershipStatusActive).
		Order("created_at ASC, id ASC")
	if offset > 0 {
		query = query.Offset(offset)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&items).Error

	return items, err
}

func mapMembershipGormError(err error, notFound error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound
	}

	return err
}

// isMembershipActiveConflict 判定唯一索引 idx_user_memberships_one_active 冲突。
func isMembershipActiveConflict(err error) bool {
	if err == nil {
		return false
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return postgresError.ConstraintName == "idx_user_memberships_one_active" ||
			strings.Contains(err.Error(), "idx_user_memberships_one_active")
	}

	return strings.Contains(err.Error(), "idx_user_memberships_one_active")
}
