package repository

import (
	"crypto/rand"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

var (
	ErrInviteProfileNotFound = errors.New("invite profile not found")
	ErrInviteRecordNotFound  = errors.New("invite record not found")
	ErrInviteeAlreadyBound   = errors.New("invitee already bound to an inviter")
)

// inviteCodeAlphabet 邀请码字符集：大写字母 + 数字。
const inviteCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// inviteCodeMaxRetries 邀请码碰撞重试上限。
const inviteCodeMaxRetries = 5

// InviteRepository 邀请关系仓储。
// 关键不变量：InviteRecord.InviteeID 全局唯一 —— 一个用户只能被邀请一次，
// 数据层封堵自刷号。
type InviteRepository interface {
	GetOrCreateProfile(userID string, now time.Time) (model.InviteProfile, error)
	GetProfileByCode(code string) (model.InviteProfile, error)
	// RegenerateInviteCode 重置邀请码（后台模块8 reset_invite_code）：
	// 生成新码并更新 InviteCode/UpdatedAt；用户无 profile 时按
	// GetOrCreateProfile 语义先建。
	RegenerateInviteCode(userID string, now time.Time) (model.InviteProfile, error)
	CreateRecord(r model.InviteRecord) (model.InviteRecord, error)
	GetRecordByInvitee(inviteeID string) (model.InviteRecord, error)
	ListRecordsByInviter(inviterID string) ([]model.InviteRecord, error)
	// ListAllRecords 全量邀请记录（后台列表）：CreatedAt DESC, ID DESC + 总数。
	ListAllRecords(page int, pageSize int) ([]model.InviteRecord, int64, error)
	UpdateRewardStatus(id string, from string, to string, grantedAt time.Time) (bool, error)
}

type MemoryInviteRepository struct {
	mu               sync.RWMutex
	profiles         map[string]model.InviteProfile // key = UserID
	profilesByCode   map[string]string              // code -> UserID
	records          map[string]model.InviteRecord  // key = ID
	recordsByInvitee map[string]string              // inviteeID -> record ID
}

func NewMemoryInviteRepository() *MemoryInviteRepository {
	return &MemoryInviteRepository{
		profiles:         make(map[string]model.InviteProfile),
		profilesByCode:   make(map[string]string),
		records:          make(map[string]model.InviteRecord),
		recordsByInvitee: make(map[string]string),
	}
}

// GetOrCreateProfile 没有则生成唯一邀请码（碰撞重试最多 5 次）。
func (r *MemoryInviteRepository) GetOrCreateProfile(userID string, now time.Time) (model.InviteProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if profile, ok := r.profiles[userID]; ok {
		return profile, nil
	}

	var profile model.InviteProfile
	created := false
	for attempt := 0; attempt < inviteCodeMaxRetries; attempt++ {
		code, err := generateInviteCode()
		if err != nil {
			return model.InviteProfile{}, err
		}
		if _, exists := r.profilesByCode[code]; exists {
			continue
		}
		profile = model.InviteProfile{UserID: userID, InviteCode: code, CreatedAt: now, UpdatedAt: now}
		created = true
		break
	}
	if !created {
		return model.InviteProfile{}, errors.New("failed to allocate a unique invite code")
	}
	r.profiles[userID] = profile
	r.profilesByCode[profile.InviteCode] = userID

	return profile, nil
}

func (r *MemoryInviteRepository) GetProfileByCode(code string) (model.InviteProfile, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userID, ok := r.profilesByCode[code]
	if !ok {
		return model.InviteProfile{}, ErrInviteProfileNotFound
	}

	return r.profiles[userID], nil
}

// RegenerateInviteCode 重置邀请码：无 profile 时按 GetOrCreateProfile 语义先建；
// 碰撞重试最多 5 次（含撞到自身旧码的情形，保证必然换码）。
func (r *MemoryInviteRepository) RegenerateInviteCode(userID string, now time.Time) (model.InviteProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	profile, exists := r.profiles[userID]
	for attempt := 0; attempt < inviteCodeMaxRetries; attempt++ {
		code, err := generateInviteCode()
		if err != nil {
			return model.InviteProfile{}, err
		}
		if _, taken := r.profilesByCode[code]; taken {
			continue
		}
		if exists {
			delete(r.profilesByCode, profile.InviteCode)
		} else {
			profile = model.InviteProfile{UserID: userID, CreatedAt: now}
		}
		profile.InviteCode = code
		profile.UpdatedAt = now
		r.profiles[userID] = profile
		r.profilesByCode[code] = userID

		return profile, nil
	}

	return model.InviteProfile{}, errors.New("failed to allocate a unique invite code")
}

// CreateRecord 强制 InviteeID 唯一，冲突返回 ErrInviteeAlreadyBound。
func (r *MemoryInviteRepository) CreateRecord(record model.InviteRecord) (model.InviteRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.recordsByInvitee[record.InviteeID]; exists {
		return model.InviteRecord{}, ErrInviteeAlreadyBound
	}
	if record.ID == "" {
		record.ID = "inv_" + randomRepositoryHex(12)
	}
	record.CreatedAt = time.Now().UTC()
	r.records[record.ID] = record
	r.recordsByInvitee[record.InviteeID] = record.ID

	return record, nil
}

func (r *MemoryInviteRepository) GetRecordByInvitee(inviteeID string) (model.InviteRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	id, ok := r.recordsByInvitee[inviteeID]
	if !ok {
		return model.InviteRecord{}, ErrInviteRecordNotFound
	}

	return r.records[id], nil
}

func (r *MemoryInviteRepository) ListRecordsByInviter(inviterID string) ([]model.InviteRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	records := make([]model.InviteRecord, 0)
	for _, record := range r.records {
		if record.InviterID == inviterID {
			records = append(records, record)
		}
	}
	// 与 Gorm 版排序逐一致：CreatedAt DESC
	sort.Slice(records, func(i, j int) bool {
		return records[i].CreatedAt.After(records[j].CreatedAt)
	})

	return records, nil
}

// ListAllRecords 全量邀请记录：CreatedAt DESC, ID DESC + 总数。
func (r *MemoryInviteRepository) ListAllRecords(page int, pageSize int) ([]model.InviteRecord, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	records := make([]model.InviteRecord, 0, len(r.records))
	for _, record := range r.records {
		records = append(records, record)
	}
	// 与 Gorm 版排序逐一致：CreatedAt DESC, ID DESC
	sort.Slice(records, func(i, j int) bool {
		if !records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].CreatedAt.After(records[j].CreatedAt)
		}
		return records[i].ID > records[j].ID
	})

	items, total := paginateMemorySlice(records, page, pageSize)

	return items, total, nil
}

// UpdateRewardStatus 守卫迁移：仅当当前 reward_status==from 才更新，并写 GrantedAt。
func (r *MemoryInviteRepository) UpdateRewardStatus(id string, from string, to string, grantedAt time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	record, ok := r.records[id]
	if !ok {
		return false, ErrInviteRecordNotFound
	}
	if record.RewardStatus != from {
		return false, nil
	}
	record.RewardStatus = to
	record.GrantedAt = &grantedAt
	r.records[id] = record

	return true, nil
}

type GormInviteRepository struct {
	db *gorm.DB
}

func NewGormInviteRepository(db *gorm.DB) *GormInviteRepository {
	return &GormInviteRepository{db: db}
}

func (r *GormInviteRepository) GetOrCreateProfile(userID string, now time.Time) (model.InviteProfile, error) {
	var profile model.InviteProfile
	err := r.db.First(&profile, "user_id = ?", userID).Error
	if err == nil {
		return profile, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.InviteProfile{}, err
	}

	// 生成唯一邀请码；撞唯一索引时重试（并发下 user_id 主键冲突也重读）
	for attempt := 0; attempt < inviteCodeMaxRetries; attempt++ {
		code, genErr := generateInviteCode()
		if genErr != nil {
			return model.InviteProfile{}, genErr
		}
		profile = model.InviteProfile{UserID: userID, InviteCode: code, CreatedAt: now, UpdatedAt: now}
		if createErr := r.db.Create(&profile).Error; createErr != nil {
			if isInviteConflictError(createErr) {
				// 并发已被其它请求创建：重读已存在记录；邀请码碰撞则重试
				if existing, readErr := r.getProfileByUserID(userID); readErr == nil {
					return existing, nil
				}
				continue
			}
			return model.InviteProfile{}, createErr
		}
		return profile, nil
	}

	return model.InviteProfile{}, errors.New("failed to allocate a unique invite code")
}

// getProfileByUserID 仅供并发冲突重读使用。
func (r *GormInviteRepository) getProfileByUserID(userID string) (model.InviteProfile, error) {
	var profile model.InviteProfile
	err := r.db.First(&profile, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.InviteProfile{}, ErrInviteProfileNotFound
	}

	return profile, err
}

func (r *GormInviteRepository) GetProfileByCode(code string) (model.InviteProfile, error) {
	var profile model.InviteProfile
	err := r.db.First(&profile, "invite_code = ?", code).Error

	return profile, mapInviteGormError(err, ErrInviteProfileNotFound)
}

// RegenerateInviteCode 重置邀请码：无 profile 时按 GetOrCreateProfile 语义先建；
// 撞唯一索引时换码重试（最多 5 次），并显式跳过与旧码相同的情形。
func (r *GormInviteRepository) RegenerateInviteCode(userID string, now time.Time) (model.InviteProfile, error) {
	var profile model.InviteProfile
	err := r.db.First(&profile, "user_id = ?", userID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return r.GetOrCreateProfile(userID, now)
		}
		return model.InviteProfile{}, err
	}

	for attempt := 0; attempt < inviteCodeMaxRetries; attempt++ {
		code, genErr := generateInviteCode()
		if genErr != nil {
			return model.InviteProfile{}, genErr
		}
		if code == profile.InviteCode {
			continue
		}
		updateErr := r.db.Model(&model.InviteProfile{}).
			Where("user_id = ?", userID).
			Updates(map[string]any{"invite_code": code, "updated_at": now}).Error
		if updateErr != nil {
			if isInviteConflictError(updateErr) {
				continue
			}
			return model.InviteProfile{}, updateErr
		}
		profile.InviteCode = code
		profile.UpdatedAt = now

		return profile, nil
	}

	return model.InviteProfile{}, errors.New("failed to allocate a unique invite code")
}

func (r *GormInviteRepository) CreateRecord(record model.InviteRecord) (model.InviteRecord, error) {
	if record.ID == "" {
		record.ID = "inv_" + randomRepositoryHex(12)
	}
	record.CreatedAt = time.Now().UTC()
	if err := r.db.Create(&record).Error; err != nil {
		if isInviteConflictError(err) {
			return model.InviteRecord{}, ErrInviteeAlreadyBound
		}
		return model.InviteRecord{}, err
	}

	return record, nil
}

func (r *GormInviteRepository) GetRecordByInvitee(inviteeID string) (model.InviteRecord, error) {
	var record model.InviteRecord
	err := r.db.First(&record, "invitee_id = ?", inviteeID).Error

	return record, mapInviteGormError(err, ErrInviteRecordNotFound)
}

func (r *GormInviteRepository) ListRecordsByInviter(inviterID string) ([]model.InviteRecord, error) {
	var records []model.InviteRecord
	err := r.db.Where("inviter_id = ?", inviterID).Order("created_at DESC").Find(&records).Error

	return records, err
}

// ListAllRecords 全量邀请记录：CreatedAt DESC, ID DESC + 总数。
func (r *GormInviteRepository) ListAllRecords(page int, pageSize int) ([]model.InviteRecord, int64, error) {
	if page < 1 {
		page = 1
	}
	// Count 用单独 session，避免与列表查询互相污染
	var total int64
	if err := r.db.Session(&gorm.Session{}).Model(&model.InviteRecord{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	records := make([]model.InviteRecord, 0)
	err := r.db.Model(&model.InviteRecord{}).
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&records).Error

	return records, total, err
}

func (r *GormInviteRepository) UpdateRewardStatus(id string, from string, to string, grantedAt time.Time) (bool, error) {
	var record model.InviteRecord
	if err := r.db.First(&record, "id = ?", id).Error; err != nil {
		return false, mapInviteGormError(err, ErrInviteRecordNotFound)
	}
	result := r.db.Model(&model.InviteRecord{}).
		Where("id = ? AND reward_status = ?", id, from).
		Updates(map[string]any{"reward_status": to, "granted_at": grantedAt})
	if result.Error != nil {
		return false, result.Error
	}

	return result.RowsAffected > 0, nil
}

// generateInviteCode 用 crypto/rand 生成 8 位大写字母数字邀请码。
func generateInviteCode() (string, error) {
	buf := make([]byte, model.InviteCodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := make([]byte, model.InviteCodeLength)
	for i, b := range buf {
		code[i] = inviteCodeAlphabet[int(b)%len(inviteCodeAlphabet)]
	}

	return string(code), nil
}

// isInviteConflictError 判定唯一键冲突（invite_code / invitee_id / user_id）。
func isInviteConflictError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return true
	}

	return strings.Contains(err.Error(), "duplicate key")
}

func mapInviteGormError(err error, notFound error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound
	}

	return err
}
