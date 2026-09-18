package repository

import (
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

// AuditRepository 管理端审计日志仓储。
// 关键不变量：append-only —— 只提供 Append/List，绝不提供 Update/Delete；
// Postgres 端另由 database.go REVOKE UPDATE/DELETE 兜底。
type AuditRepository interface {
	Append(log model.AdminAuditLog) (model.AdminAuditLog, error)
	List(adminID string, action string, page int, pageSize int) ([]model.AdminAuditLog, int64, error)
}

type MemoryAuditRepository struct {
	mu   sync.RWMutex
	logs map[string]model.AdminAuditLog
}

func NewMemoryAuditRepository() *MemoryAuditRepository {
	return &MemoryAuditRepository{
		logs: make(map[string]model.AdminAuditLog),
	}
}

func (r *MemoryAuditRepository) Append(log model.AdminAuditLog) (model.AdminAuditLog, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if log.ID == "" {
		log.ID = "aud_" + randomRepositoryHex(12)
	}
	log.CreatedAt = time.Now().UTC()
	r.logs[log.ID] = log

	return log, nil
}

func (r *MemoryAuditRepository) List(adminID string, action string, page int, pageSize int) ([]model.AdminAuditLog, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// 空字符串 = 不筛
	filtered := make([]model.AdminAuditLog, 0)
	for _, log := range r.logs {
		if adminID != "" && log.AdminID != adminID {
			continue
		}
		if action != "" && log.Action != action {
			continue
		}
		filtered = append(filtered, log)
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
		return []model.AdminAuditLog{}, total, nil
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	return filtered[start:end], total, nil
}

type GormAuditRepository struct {
	db *gorm.DB
}

func NewGormAuditRepository(db *gorm.DB) *GormAuditRepository {
	return &GormAuditRepository{db: db}
}

func (r *GormAuditRepository) Append(log model.AdminAuditLog) (model.AdminAuditLog, error) {
	if log.ID == "" {
		log.ID = "aud_" + randomRepositoryHex(12)
	}
	log.CreatedAt = time.Now().UTC()
	if err := r.db.Create(&log).Error; err != nil {
		return model.AdminAuditLog{}, err
	}

	return log, nil
}

func (r *GormAuditRepository) List(adminID string, action string, page int, pageSize int) ([]model.AdminAuditLog, int64, error) {
	applyFilters := func(query *gorm.DB) *gorm.DB {
		if adminID != "" {
			query = query.Where("admin_id = ?", adminID)
		}
		if action != "" {
			query = query.Where("action = ?", action)
		}
		return query
	}

	// Count 用单独 session，避免与列表查询的条件互相污染
	var total int64
	if err := applyFilters(r.db.Session(&gorm.Session{}).Model(&model.AdminAuditLog{})).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	var logs []model.AdminAuditLog
	err := applyFilters(r.db.Model(&model.AdminAuditLog{})).
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&logs).Error

	return logs, total, err
}
