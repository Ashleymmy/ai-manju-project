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

var ErrAnnouncementNotFound = errors.New("announcement not found")

type AnnouncementRepository interface {
	ListAnnouncements(limit int) ([]model.SystemAnnouncement, error)
	GetAnnouncement(id string) (model.SystemAnnouncement, error)
	GetActiveAnnouncement() (model.SystemAnnouncement, error)
	GetUnreadActiveAnnouncement(userID string) (*model.SystemAnnouncement, error)
	CreateAnnouncement(announcement model.SystemAnnouncement) (model.SystemAnnouncement, error)
	RepublishAnnouncement(sourceID string, announcement model.SystemAnnouncement) (model.SystemAnnouncement, error)
	RevokeAnnouncement(id string) (model.SystemAnnouncement, error)
	MarkRead(announcementID string, userID string) (model.SystemAnnouncementRead, error)
}

type MemoryAnnouncementRepository struct {
	mu            sync.RWMutex
	announcements map[string]model.SystemAnnouncement
	reads         map[string]model.SystemAnnouncementRead
}

func NewMemoryAnnouncementRepository() *MemoryAnnouncementRepository {
	return &MemoryAnnouncementRepository{
		announcements: make(map[string]model.SystemAnnouncement),
		reads:         make(map[string]model.SystemAnnouncementRead),
	}
}

func (r *MemoryAnnouncementRepository) ListAnnouncements(limit int) ([]model.SystemAnnouncement, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]model.SystemAnnouncement, 0, len(r.announcements))
	for _, item := range r.announcements {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].PublishedAt.After(items[j].PublishedAt)
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryAnnouncementRepository) GetAnnouncement(id string) (model.SystemAnnouncement, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.announcements[id]
	if !ok {
		return model.SystemAnnouncement{}, ErrAnnouncementNotFound
	}
	return item, nil
}

func (r *MemoryAnnouncementRepository) GetActiveAnnouncement() (model.SystemAnnouncement, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var active *model.SystemAnnouncement
	for _, item := range r.announcements {
		if item.Status != model.SystemAnnouncementStatusActive {
			continue
		}
		copy := item
		if active == nil || copy.PublishedAt.After(active.PublishedAt) {
			active = &copy
		}
	}
	if active == nil {
		return model.SystemAnnouncement{}, ErrAnnouncementNotFound
	}
	return *active, nil
}

func (r *MemoryAnnouncementRepository) GetUnreadActiveAnnouncement(userID string) (*model.SystemAnnouncement, error) {
	active, err := r.GetActiveAnnouncement()
	if err != nil {
		if errors.Is(err, ErrAnnouncementNotFound) {
			return nil, nil
		}
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.reads[readKey(active.ID, userID)]; ok {
		return nil, nil
	}
	return &active, nil
}

func (r *MemoryAnnouncementRepository) CreateAnnouncement(announcement model.SystemAnnouncement) (model.SystemAnnouncement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	for id, item := range r.announcements {
		if item.Status != model.SystemAnnouncementStatusActive {
			continue
		}
		item.Status = model.SystemAnnouncementStatusRevoked
		item.RevokedAt = &now
		item.UpdatedAt = now
		r.announcements[id] = item
	}
	if announcement.PublishedAt.IsZero() {
		announcement.PublishedAt = now
	}
	if announcement.CreatedAt.IsZero() {
		announcement.CreatedAt = now
	}
	announcement.UpdatedAt = now
	announcement.Status = model.SystemAnnouncementStatusActive
	r.announcements[announcement.ID] = announcement
	return announcement, nil
}

func (r *MemoryAnnouncementRepository) RepublishAnnouncement(sourceID string, announcement model.SystemAnnouncement) (model.SystemAnnouncement, error) {
	r.mu.RLock()
	source, ok := r.announcements[sourceID]
	r.mu.RUnlock()
	if !ok {
		return model.SystemAnnouncement{}, ErrAnnouncementNotFound
	}
	if announcement.Title == "" {
		announcement.Title = source.Title
	}
	if announcement.Content == "" {
		announcement.Content = source.Content
	}
	if announcement.Kind == "" {
		announcement.Kind = source.Kind
	}
	return r.CreateAnnouncement(announcement)
}

func (r *MemoryAnnouncementRepository) RevokeAnnouncement(id string) (model.SystemAnnouncement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.announcements[id]
	if !ok {
		return model.SystemAnnouncement{}, ErrAnnouncementNotFound
	}
	now := time.Now().UTC()
	item.Status = model.SystemAnnouncementStatusRevoked
	item.RevokedAt = &now
	item.UpdatedAt = now
	r.announcements[id] = item
	return item, nil
}

func (r *MemoryAnnouncementRepository) MarkRead(announcementID string, userID string) (model.SystemAnnouncementRead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.announcements[announcementID]; !ok {
		return model.SystemAnnouncementRead{}, ErrAnnouncementNotFound
	}
	key := readKey(announcementID, userID)
	if read, ok := r.reads[key]; ok {
		return read, nil
	}
	now := time.Now().UTC()
	read := model.SystemAnnouncementRead{
		ID:             "announcement_read_" + randomRepositoryHex(8),
		AnnouncementID: announcementID,
		UserID:         userID,
		ReadAt:         now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	r.reads[key] = read
	return read, nil
}

type GormAnnouncementRepository struct {
	db *gorm.DB
}

func NewGormAnnouncementRepository(db *gorm.DB) *GormAnnouncementRepository {
	return &GormAnnouncementRepository{db: db}
}

func (r *GormAnnouncementRepository) ListAnnouncements(limit int) ([]model.SystemAnnouncement, error) {
	items := make([]model.SystemAnnouncement, 0)
	query := r.db.Order("published_at DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *GormAnnouncementRepository) GetAnnouncement(id string) (model.SystemAnnouncement, error) {
	var item model.SystemAnnouncement
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SystemAnnouncement{}, ErrAnnouncementNotFound
		}
		return model.SystemAnnouncement{}, err
	}
	return item, nil
}

func (r *GormAnnouncementRepository) GetActiveAnnouncement() (model.SystemAnnouncement, error) {
	var item model.SystemAnnouncement
	err := r.db.Where("status = ?", model.SystemAnnouncementStatusActive).Order("published_at DESC").First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SystemAnnouncement{}, ErrAnnouncementNotFound
		}
		return model.SystemAnnouncement{}, err
	}
	return item, nil
}

func (r *GormAnnouncementRepository) GetUnreadActiveAnnouncement(userID string) (*model.SystemAnnouncement, error) {
	var item model.SystemAnnouncement
	err := r.db.
		Where("system_announcements.status = ?", model.SystemAnnouncementStatusActive).
		Where("NOT EXISTS (?)",
			r.db.Model(&model.SystemAnnouncementRead{}).
				Select("1").
				Where("system_announcement_reads.announcement_id = system_announcements.id").
				Where("system_announcement_reads.user_id = ?", userID),
		).
		Order("system_announcements.published_at DESC").
		First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *GormAnnouncementRepository) CreateAnnouncement(announcement model.SystemAnnouncement) (model.SystemAnnouncement, error) {
	now := time.Now().UTC()
	if announcement.PublishedAt.IsZero() {
		announcement.PublishedAt = now
	}
	if announcement.CreatedAt.IsZero() {
		announcement.CreatedAt = now
	}
	announcement.UpdatedAt = now
	announcement.Status = model.SystemAnnouncementStatusActive

	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.SystemAnnouncement{}).
			Where("status = ?", model.SystemAnnouncementStatusActive).
			Updates(map[string]any{
				"status":     model.SystemAnnouncementStatusRevoked,
				"revoked_at": now,
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		return tx.Create(&announcement).Error
	})
	if err != nil {
		return model.SystemAnnouncement{}, err
	}
	return announcement, nil
}

func (r *GormAnnouncementRepository) RepublishAnnouncement(sourceID string, announcement model.SystemAnnouncement) (model.SystemAnnouncement, error) {
	source, err := r.GetAnnouncement(sourceID)
	if err != nil {
		return model.SystemAnnouncement{}, err
	}
	if announcement.Title == "" {
		announcement.Title = source.Title
	}
	if announcement.Content == "" {
		announcement.Content = source.Content
	}
	if announcement.Kind == "" {
		announcement.Kind = source.Kind
	}
	return r.CreateAnnouncement(announcement)
}

func (r *GormAnnouncementRepository) RevokeAnnouncement(id string) (model.SystemAnnouncement, error) {
	now := time.Now().UTC()
	var item model.SystemAnnouncement
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&item, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAnnouncementNotFound
			}
			return err
		}
		item.Status = model.SystemAnnouncementStatusRevoked
		item.RevokedAt = &now
		item.UpdatedAt = now
		return tx.Save(&item).Error
	})
	if err != nil {
		return model.SystemAnnouncement{}, err
	}
	return item, nil
}

func (r *GormAnnouncementRepository) MarkRead(announcementID string, userID string) (model.SystemAnnouncementRead, error) {
	var announcement model.SystemAnnouncement
	if err := r.db.First(&announcement, "id = ?", announcementID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SystemAnnouncementRead{}, ErrAnnouncementNotFound
		}
		return model.SystemAnnouncementRead{}, err
	}

	now := time.Now().UTC()
	read := model.SystemAnnouncementRead{
		ID:             "announcement_read_" + randomRepositoryHex(8),
		AnnouncementID: announcementID,
		UserID:         userID,
		ReadAt:         now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	err := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "announcement_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{"read_at": now, "updated_at": now}),
	}).Create(&read).Error
	if err != nil {
		return model.SystemAnnouncementRead{}, err
	}

	var saved model.SystemAnnouncementRead
	if err := r.db.First(&saved, "announcement_id = ? AND user_id = ?", announcementID, userID).Error; err != nil {
		return model.SystemAnnouncementRead{}, err
	}
	return saved, nil
}

func readKey(announcementID string, userID string) string {
	return announcementID + "\x00" + userID
}
