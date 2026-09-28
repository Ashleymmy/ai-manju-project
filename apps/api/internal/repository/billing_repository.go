package repository

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPackageNotFound       = errors.New("credit package not found")
	ErrOrderNotFound         = errors.New("order not found")
	ErrOrderStateConflict    = errors.New("order state changed")
	ErrBillingConfigNotFound = errors.New("billing config not found")
)

// BillingRepository 积分套餐、订单与计费配置仓储。
type BillingRepository interface {
	// 套餐
	ListPackages(enabledOnly bool) ([]model.CreditPackage, error)
	GetPackageByID(id string) (model.CreditPackage, error)
	UpsertPackage(pkg model.CreditPackage) (model.CreditPackage, error)
	// 订单
	CreateOrder(o model.Order) (model.Order, error)
	GetOrderByID(id string) (model.Order, error)
	ListOrders(userID string, status string, orderType string, page int, pageSize int) ([]model.Order, int64, error)
	UpdateOrderStatus(id string, from string, to string, now time.Time) (model.Order, bool, error)
	// Order-level serialization spans payment, fulfillment, cancellation and refund.
	WithOrderLock(id string, fn func() error) error
	SetOrderPurchasedCredits(id string, credits int64) (model.Order, error)
	MarkOrderFulfilled(id string, now time.Time) error
	StartOrderRefund(id string, now time.Time) error
	// 订单统计（后台模块4 统计卡）
	// SumPaidAmountByUser 该用户 status='paid' 订单 amount_cents 合计（累计充值）。
	SumPaidAmountByUser(userID string) (int64, error)
	// CountDistinctPaidUsers 有 status='paid' 订单的去重用户数。
	CountDistinctPaidUsers() (int64, error)
	// SumPaidAmount paid 订单 paid_at 在范围内（零值不筛）的 amount_cents 合计（GMV）。
	SumPaidAmount(start time.Time, end time.Time) (int64, error)
	// 配置
	GetConfig(key string) (model.BillingConfig, error)
	UpsertConfig(key string, value model.JSONB, updatedBy string, now time.Time) error
	ListConfigs() ([]model.BillingConfig, error)
}

type MemoryBillingRepository struct {
	orderLocks sync.Map
	mu         sync.RWMutex
	packages   map[string]model.CreditPackage
	orders     map[string]model.Order
	configs    map[string]model.BillingConfig
}

// orderLockWait bounds lock acquisition; business mutations retain their own
// transactions. A separate PostgreSQL connection avoids exhausting the pool.
const orderLockWait = 30 * time.Second
const orderLockCloseTimeout = 5 * time.Second

func (r *MemoryBillingRepository) WithOrderLock(id string, fn func() error) error {
	value, _ := r.orderLocks.LoadOrStore(id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	return fn()
}

func (r *MemoryBillingRepository) SetOrderPurchasedCredits(id string, credits int64) (model.Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	order, ok := r.orders[id]
	if !ok {
		return model.Order{}, ErrOrderNotFound
	}
	if order.PurchasedCredits == nil {
		order.PurchasedCredits = &credits
		r.orders[id] = order
	}
	return order, nil
}

func (r *MemoryBillingRepository) MarkOrderFulfilled(id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	order, ok := r.orders[id]
	if !ok {
		return ErrOrderNotFound
	}
	if order.Status != model.OrderStatusPaid || order.RefundStartedAt != nil {
		return ErrOrderStateConflict
	}
	if order.FulfilledAt == nil {
		order.FulfilledAt, order.UpdatedAt = &now, now
		r.orders[id] = order
	}
	return nil
}

func (r *MemoryBillingRepository) StartOrderRefund(id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	order, ok := r.orders[id]
	if !ok {
		return ErrOrderNotFound
	}
	if order.Status != model.OrderStatusPaid {
		return ErrOrderStateConflict
	}
	if order.RefundStartedAt == nil {
		order.RefundStartedAt, order.UpdatedAt = &now, now
		r.orders[id] = order
	}
	return nil
}

func NewMemoryBillingRepository() *MemoryBillingRepository {
	return &MemoryBillingRepository{
		packages: make(map[string]model.CreditPackage),
		orders:   make(map[string]model.Order),
		configs:  make(map[string]model.BillingConfig),
	}
}

func (r *MemoryBillingRepository) ListPackages(enabledOnly bool) ([]model.CreditPackage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	packages := make([]model.CreditPackage, 0, len(r.packages))
	for _, pkg := range r.packages {
		if enabledOnly && !pkg.Enabled {
			continue
		}
		packages = append(packages, pkg)
	}
	// 与 Gorm 版排序逐一致：SortOrder ASC, CreatedAt ASC
	sort.Slice(packages, func(i, j int) bool {
		if packages[i].SortOrder != packages[j].SortOrder {
			return packages[i].SortOrder < packages[j].SortOrder
		}
		return packages[i].CreatedAt.Before(packages[j].CreatedAt)
	})

	return packages, nil
}

func (r *MemoryBillingRepository) GetPackageByID(id string) (model.CreditPackage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	pkg, ok := r.packages[id]
	if !ok {
		return model.CreditPackage{}, ErrPackageNotFound
	}

	return pkg, nil
}

func (r *MemoryBillingRepository) UpsertPackage(pkg model.CreditPackage) (model.CreditPackage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	if pkg.ID == "" {
		pkg.ID = "pkg_" + randomRepositoryHex(12)
		pkg.CreatedAt = now
	} else if existing, ok := r.packages[pkg.ID]; ok {
		pkg.CreatedAt = existing.CreatedAt
	} else {
		pkg.CreatedAt = now
	}
	pkg.UpdatedAt = now
	r.packages[pkg.ID] = pkg

	return pkg, nil
}

func (r *MemoryBillingRepository) CreateOrder(o model.Order) (model.Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	if o.ID == "" {
		o.ID = "ord_" + randomRepositoryHex(12)
	}
	o.CreatedAt = now
	o.UpdatedAt = now
	r.orders[o.ID] = o

	return o, nil
}

func (r *MemoryBillingRepository) GetOrderByID(id string) (model.Order, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	order, ok := r.orders[id]
	if !ok {
		return model.Order{}, ErrOrderNotFound
	}

	return order, nil
}

func (r *MemoryBillingRepository) ListOrders(userID string, status string, orderType string, page int, pageSize int) ([]model.Order, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// 空字符串 = 不筛
	filtered := make([]model.Order, 0)
	for _, order := range r.orders {
		if userID != "" && order.UserID != userID {
			continue
		}
		if status != "" && order.Status != status {
			continue
		}
		if orderType != "" && order.OrderType != orderType {
			continue
		}
		filtered = append(filtered, order)
	}
	// 与 Gorm 版排序逐一致：CreatedAt DESC, ID DESC
	sort.Slice(filtered, func(i, j int) bool {
		if !filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
		}
		return filtered[i].ID > filtered[j].ID
	})

	total := int64(len(filtered))
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= len(filtered) {
		return []model.Order{}, total, nil
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	return filtered[start:end], total, nil
}

// UpdateOrderStatus 守卫迁移：仅当当前 status==from 才更新；bool=是否变更。
// to==paid 写 PaidAt，to==refunded 写 RefundedAt。
func (r *MemoryBillingRepository) UpdateOrderStatus(id string, from string, to string, now time.Time) (model.Order, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	order, ok := r.orders[id]
	if !ok {
		return model.Order{}, false, ErrOrderNotFound
	}
	if order.Status != from {
		return order, false, nil
	}
	order.Status = to
	switch to {
	case model.OrderStatusPaid:
		order.PaidAt = &now
	case model.OrderStatusRefunded:
		order.RefundedAt = &now
	}
	order.UpdatedAt = now
	r.orders[id] = order

	return order, true, nil
}

// SumPaidAmountByUser 该用户累计充值：status='paid' 订单 amount_cents 合计。
func (r *MemoryBillingRepository) SumPaidAmountByUser(userID string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var total int64
	for _, order := range r.orders {
		if order.UserID == userID && order.Status == model.OrderStatusPaid {
			total += order.AmountCents
		}
	}

	return total, nil
}

// CountDistinctPaidUsers 有 status='paid' 订单的去重用户数。
func (r *MemoryBillingRepository) CountDistinctPaidUsers() (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	paidUsers := make(map[string]struct{})
	for _, order := range r.orders {
		if order.Status == model.OrderStatusPaid {
			paidUsers[order.UserID] = struct{}{}
		}
	}

	return int64(len(paidUsers)), nil
}

// SumPaidAmount GMV：paid 订单 paid_at 在范围内（零值不筛）的 amount_cents 合计。
// 注意：设了时间边界时 PaidAt 为空的行不计入（与 SQL 的 NULL 语义一致）。
func (r *MemoryBillingRepository) SumPaidAmount(start time.Time, end time.Time) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var total int64
	for _, order := range r.orders {
		if order.Status != model.OrderStatusPaid {
			continue
		}
		if !start.IsZero() || !end.IsZero() {
			if order.PaidAt == nil {
				continue
			}
			if !start.IsZero() && order.PaidAt.Before(start) {
				continue
			}
			if !end.IsZero() && order.PaidAt.After(end) {
				continue
			}
		}
		total += order.AmountCents
	}

	return total, nil
}

func (r *MemoryBillingRepository) GetConfig(key string) (model.BillingConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	config, ok := r.configs[key]
	if !ok {
		return model.BillingConfig{}, ErrBillingConfigNotFound
	}

	return config, nil
}

func (r *MemoryBillingRepository) UpsertConfig(key string, value model.JSONB, updatedBy string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.configs[key] = model.BillingConfig{Key: key, Value: value, UpdatedBy: updatedBy, UpdatedAt: now}

	return nil
}

func (r *MemoryBillingRepository) ListConfigs() ([]model.BillingConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	configs := make([]model.BillingConfig, 0, len(r.configs))
	for _, config := range r.configs {
		configs = append(configs, config)
	}
	// 与 Gorm 版排序逐一致：Key ASC
	sort.Slice(configs, func(i, j int) bool {
		return configs[i].Key < configs[j].Key
	})

	return configs, nil
}

type GormBillingRepository struct {
	db *gorm.DB
}

func NewGormBillingRepository(db *gorm.DB) *GormBillingRepository {
	return &GormBillingRepository{db: db}
}

func (r *GormBillingRepository) WithOrderLock(id string, fn func() error) error {
	dialect, ok := r.db.Dialector.(*postgres.Dialector)
	if !ok || dialect.Config.DSN == "" {
		return errors.New("order locking requires PostgreSQL DSN")
	}
	ctx, cancel := context.WithTimeout(context.Background(), orderLockWait)
	defer cancel()
	conn, err := pgx.Connect(ctx, dialect.Config.DSN)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), orderLockCloseTimeout)
		defer closeCancel()
		_ = conn.Close(closeCtx)
	}()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,0))", "billing-order:"+id); err != nil {
		return err
	}
	return fn()
}

func (r *GormBillingRepository) SetOrderPurchasedCredits(id string, credits int64) (model.Order, error) {
	if err := r.db.Model(&model.Order{}).Where("id = ? AND purchased_credits IS NULL", id).Update("purchased_credits", credits).Error; err != nil {
		return model.Order{}, err
	}
	return r.GetOrderByID(id)
}

func (r *GormBillingRepository) MarkOrderFulfilled(id string, now time.Time) error {
	result := r.db.Model(&model.Order{}).Where("id = ? AND status = ? AND refund_started_at IS NULL AND fulfilled_at IS NULL", id, model.OrderStatusPaid).
		Updates(map[string]any{"fulfilled_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		order, err := r.GetOrderByID(id)
		if err != nil {
			return err
		}
		if order.Status == model.OrderStatusPaid && order.RefundStartedAt == nil && order.FulfilledAt != nil {
			return nil
		}
		return ErrOrderStateConflict
	}
	return nil
}

func (r *GormBillingRepository) StartOrderRefund(id string, now time.Time) error {
	result := r.db.Model(&model.Order{}).Where("id = ? AND status = ? AND refund_started_at IS NULL", id, model.OrderStatusPaid).
		Updates(map[string]any{"refund_started_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		order, err := r.GetOrderByID(id)
		if err != nil {
			return err
		}
		if order.Status == model.OrderStatusPaid && order.RefundStartedAt != nil {
			return nil
		}
		return ErrOrderStateConflict
	}
	return nil
}

func (r *GormBillingRepository) ListPackages(enabledOnly bool) ([]model.CreditPackage, error) {
	var packages []model.CreditPackage
	query := r.db.Model(&model.CreditPackage{})
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("sort_order ASC, created_at ASC").Find(&packages).Error

	return packages, err
}

func (r *GormBillingRepository) GetPackageByID(id string) (model.CreditPackage, error) {
	var pkg model.CreditPackage
	err := r.db.First(&pkg, "id = ?", id).Error

	return pkg, mapBillingGormError(err, ErrPackageNotFound)
}

func (r *GormBillingRepository) UpsertPackage(pkg model.CreditPackage) (model.CreditPackage, error) {
	now := time.Now().UTC()
	if pkg.ID == "" {
		pkg.ID = "pkg_" + randomRepositoryHex(12)
		pkg.CreatedAt = now
	} else if existing, err := r.GetPackageByID(pkg.ID); err == nil {
		pkg.CreatedAt = existing.CreatedAt
	} else if !errors.Is(err, ErrPackageNotFound) {
		return model.CreditPackage{}, err
	} else {
		pkg.CreatedAt = now
	}
	pkg.UpdatedAt = now
	if err := r.db.Save(&pkg).Error; err != nil {
		return model.CreditPackage{}, err
	}

	return pkg, nil
}

func (r *GormBillingRepository) CreateOrder(o model.Order) (model.Order, error) {
	now := time.Now().UTC()
	if o.ID == "" {
		o.ID = "ord_" + randomRepositoryHex(12)
	}
	o.CreatedAt = now
	o.UpdatedAt = now
	if err := r.db.Create(&o).Error; err != nil {
		return model.Order{}, err
	}

	return o, nil
}

func (r *GormBillingRepository) GetOrderByID(id string) (model.Order, error) {
	var order model.Order
	err := r.db.First(&order, "id = ?", id).Error

	return order, mapBillingGormError(err, ErrOrderNotFound)
}

func (r *GormBillingRepository) ListOrders(userID string, status string, orderType string, page int, pageSize int) ([]model.Order, int64, error) {
	applyFilters := func(query *gorm.DB) *gorm.DB {
		if userID != "" {
			query = query.Where("user_id = ?", userID)
		}
		if status != "" {
			query = query.Where("status = ?", status)
		}
		if orderType != "" {
			query = query.Where("order_type = ?", orderType)
		}
		return query
	}

	// Count 用单独 session，避免与列表查询的条件互相污染
	var total int64
	if err := applyFilters(r.db.Session(&gorm.Session{}).Model(&model.Order{})).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	var orders []model.Order
	err := applyFilters(r.db.Model(&model.Order{})).
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&orders).Error

	return orders, total, err
}

func (r *GormBillingRepository) UpdateOrderStatus(id string, from string, to string, now time.Time) (model.Order, bool, error) {
	order, err := r.GetOrderByID(id)
	if err != nil {
		return model.Order{}, false, err
	}
	updates := map[string]any{"status": to, "updated_at": now}
	switch to {
	case model.OrderStatusPaid:
		updates["paid_at"] = now
	case model.OrderStatusRefunded:
		updates["refunded_at"] = now
	}
	result := r.db.Model(&model.Order{}).
		Where("id = ? AND status = ?", id, from).
		Updates(updates)
	if result.Error != nil {
		return model.Order{}, false, result.Error
	}
	if result.RowsAffected == 0 {
		return order, false, nil
	}
	order.Status = to
	switch to {
	case model.OrderStatusPaid:
		order.PaidAt = &now
	case model.OrderStatusRefunded:
		order.RefundedAt = &now
	}
	order.UpdatedAt = now

	return order, true, nil
}

// SumPaidAmountByUser 该用户累计充值：status='paid' 订单 amount_cents 合计。
func (r *GormBillingRepository) SumPaidAmountByUser(userID string) (int64, error) {
	var total int64
	err := r.db.Model(&model.Order{}).
		Where("user_id = ? AND status = ?", userID, model.OrderStatusPaid).
		Select("COALESCE(SUM(amount_cents), 0)").
		Row().Scan(&total)

	return total, err
}

// CountDistinctPaidUsers 有 status='paid' 订单的去重用户数。
func (r *GormBillingRepository) CountDistinctPaidUsers() (int64, error) {
	var count int64
	err := r.db.Model(&model.Order{}).
		Where("status = ?", model.OrderStatusPaid).
		Distinct("user_id").
		Count(&count).Error

	return count, err
}

// SumPaidAmount GMV：paid 订单 paid_at 在范围内（零值不筛）的 amount_cents 合计。
func (r *GormBillingRepository) SumPaidAmount(start time.Time, end time.Time) (int64, error) {
	base := r.db.Model(&model.Order{}).Where("status = ?", model.OrderStatusPaid)
	if !start.IsZero() {
		base = base.Where("paid_at >= ?", start)
	}
	if !end.IsZero() {
		base = base.Where("paid_at <= ?", end)
	}
	var total int64
	err := base.Select("COALESCE(SUM(amount_cents), 0)").Row().Scan(&total)

	return total, err
}

func (r *GormBillingRepository) GetConfig(key string) (model.BillingConfig, error) {
	var config model.BillingConfig
	err := r.db.First(&config, "key = ?", key).Error

	return config, mapBillingGormError(err, ErrBillingConfigNotFound)
}

func (r *GormBillingRepository) UpsertConfig(key string, value model.JSONB, updatedBy string, now time.Time) error {
	config := model.BillingConfig{Key: key, Value: value, UpdatedBy: updatedBy, UpdatedAt: now}

	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_by", "updated_at"}),
	}).Create(&config).Error
}

func (r *GormBillingRepository) ListConfigs() ([]model.BillingConfig, error) {
	var configs []model.BillingConfig
	err := r.db.Order("key ASC").Find(&configs).Error

	return configs, err
}

func mapBillingGormError(err error, notFound error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound
	}

	return err
}
