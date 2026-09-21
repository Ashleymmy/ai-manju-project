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

// MaxUsageFacts bounds report memory. Oversized reports fail explicitly;
// they never return truncated totals. Operators can narrow the time range.
const MaxUsageFacts = 50000

var ErrUsageTooLarge = errors.New("too many tasks; narrow the date range or member filter")

type UsageFacts struct {
	Jobs         []model.Job
	Consumptions []model.TaskConsumption
	TextCalls    []model.AIRequestLog
	Memberships  []model.UserMembership
	Rates        []model.ModelCostRate
	Costs        []model.TaskActualCost
}

type UsageRepository interface {
	Facts(start, end time.Time, userID string) (UsageFacts, error)
	ListRates() ([]model.ModelCostRate, error)
	AddRate(model.ModelCostRate) error
	PutActualCost(model.TaskActualCost) error
	TaskExists(string) (bool, error)
}

type MemoryUsageRepository struct {
	mu          sync.Mutex
	jobs        *MemoryJobRepository
	credits     *MemoryCreditRepository
	monitoring  *MemoryMonitoringRepository
	memberships *MemoryMembershipRepository
	rates       []model.ModelCostRate
	costs       map[string]model.TaskActualCost
}
type GormUsageRepository struct{ db *gorm.DB }

func NewUsageRepository(jobs JobRepository, credits CreditRepository, monitoring MonitoringRepository, memberships MembershipRepository) UsageRepository {
	if r, ok := jobs.(*GormJobRepository); ok {
		return &GormUsageRepository{db: r.db}
	}
	return &MemoryUsageRepository{jobs: jobs.(*MemoryJobRepository), credits: credits.(*MemoryCreditRepository), monitoring: monitoring.(*MemoryMonitoringRepository), memberships: memberships.(*MemoryMembershipRepository), rates: []model.ModelCostRate{}, costs: map[string]model.TaskActualCost{}}
}

func (r *MemoryUsageRepository) Facts(start, end time.Time, userID string) (UsageFacts, error) {
	var f UsageFacts
	match := func(t time.Time, u string) bool {
		return !t.Before(start) && t.Before(end) && (userID == "" || u == userID)
	}
	r.jobs.mu.RLock()
	for _, j := range r.jobs.jobs {
		if match(j.CreatedAt, j.UserID) {
			f.Jobs = append(f.Jobs, j)
		}
	}
	r.jobs.mu.RUnlock()
	r.credits.mu.Lock()
	for _, c := range r.credits.consumptions {
		if match(c.CreatedAt, c.UserID) {
			f.Consumptions = append(f.Consumptions, c)
		}
	}
	r.credits.mu.Unlock()
	r.monitoring.mu.RLock()
	for _, l := range r.monitoring.logs {
		if l.Operation == "text" && match(l.CreatedAt, l.UserID) {
			f.TextCalls = append(f.TextCalls, l)
		}
	}
	r.monitoring.mu.RUnlock()
	r.memberships.mu.RLock()
	for _, m := range r.memberships.memberships {
		if userID == "" || m.UserID == userID {
			f.Memberships = append(f.Memberships, m)
		}
	}
	r.memberships.mu.RUnlock()
	r.mu.Lock()
	f.Rates = append([]model.ModelCostRate{}, r.rates...)
	for _, c := range r.costs {
		f.Costs = append(f.Costs, c)
	}
	r.mu.Unlock()
	if len(f.Jobs)+len(f.TextCalls) > MaxUsageFacts || len(f.Consumptions) > MaxUsageFacts {
		return UsageFacts{}, ErrUsageTooLarge
	}
	return f, nil
}

func (r *GormUsageRepository) Facts(start, end time.Time, userID string) (UsageFacts, error) {
	var f UsageFacts
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// A report's rows and totals use one consistent database snapshot.
		if err := tx.Exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY").Error; err != nil {
			return err
		}
		query := func() *gorm.DB {
			q := tx.Where("created_at >= ? AND created_at < ?", start, end)
			if userID != "" {
				q = q.Where("user_id = ?", userID)
			}
			return q.Limit(MaxUsageFacts + 1)
		}
		if err := query().Find(&f.Jobs).Error; err != nil {
			return err
		}
		if err := query().Find(&f.Consumptions).Error; err != nil {
			return err
		}
		if err := query().Where("operation = ?", "text").Find(&f.TextCalls).Error; err != nil {
			return err
		}
		if len(f.Jobs)+len(f.TextCalls) > MaxUsageFacts || len(f.Consumptions) > MaxUsageFacts {
			return ErrUsageTooLarge
		}
		q := tx.Model(&model.UserMembership{})
		if userID != "" {
			q = q.Where("user_id = ?", userID)
		}
		if err := q.Find(&f.Memberships).Error; err != nil {
			return err
		}
		if err := tx.Find(&f.Rates).Error; err != nil {
			return err
		}
		ids := make([]string, 0, len(f.Jobs)+len(f.TextCalls)+len(f.Consumptions))
		seen := map[string]bool{}
		add := func(id string) {
			if !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
		for _, j := range f.Jobs {
			add(j.ID)
		}
		for _, l := range f.TextCalls {
			add(l.ID)
		}
		for _, c := range f.Consumptions {
			add(c.JobID)
		}
		// Chunk parameter lists below PostgreSQL's bind-parameter limit.
		const costQueryBatchSize = 1000
		for offset := 0; offset < len(ids); offset += costQueryBatchSize {
			end := offset + costQueryBatchSize
			if end > len(ids) {
				end = len(ids)
			}
			var costs []model.TaskActualCost
			if err := tx.Where("job_id IN ?", ids[offset:end]).Find(&costs).Error; err != nil {
				return err
			}
			f.Costs = append(f.Costs, costs...)
		}
		return nil
	})
	return f, err
}

func sortRates(rates []model.ModelCostRate) {
	sort.Slice(rates, func(i, j int) bool {
		if rates[i].EffectiveAt.Equal(rates[j].EffectiveAt) {
			if !rates[i].CreatedAt.Equal(rates[j].CreatedAt) {
				return rates[i].CreatedAt.After(rates[j].CreatedAt)
			}
			return rates[i].ID > rates[j].ID
		}
		return rates[i].EffectiveAt.After(rates[j].EffectiveAt)
	})
}
func (r *MemoryUsageRepository) ListRates() ([]model.ModelCostRate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := append([]model.ModelCostRate{}, r.rates...)
	sortRates(v)
	return v, nil
}
func (r *GormUsageRepository) ListRates() ([]model.ModelCostRate, error) {
	v := []model.ModelCostRate{}
	err := r.db.Order("effective_at DESC, created_at DESC, id DESC").Find(&v).Error
	return v, err
}
func (r *MemoryUsageRepository) AddRate(v model.ModelCostRate) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, old := range r.rates {
		if old.ID == v.ID {
			return nil
		}
	}
	r.rates = append(r.rates, v)
	return nil
}
func (r *GormUsageRepository) AddRate(v model.ModelCostRate) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&v).Error
}
func (r *MemoryUsageRepository) PutActualCost(v model.TaskActualCost) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.costs[v.JobID] = v
	return nil
}
func (r *GormUsageRepository) PutActualCost(v model.TaskActualCost) error {
	return r.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&v).Error
}
func (r *MemoryUsageRepository) TaskExists(id string) (bool, error) {
	if _, err := r.jobs.GetByID(id); err == nil {
		return true, nil
	}
	if _, err := r.credits.GetConsumptionByJobID(id); err == nil {
		return true, nil
	}
	r.monitoring.mu.RLock()
	defer r.monitoring.mu.RUnlock()
	for _, l := range r.monitoring.logs {
		if l.ID == id && l.Operation == "text" {
			return true, nil
		}
	}
	return false, nil
}
func (r *GormUsageRepository) TaskExists(id string) (bool, error) {
	var count int64
	err := r.db.Model(&model.Job{}).Where("id = ?", id).Count(&count).Error
	if err != nil || count > 0 {
		return count > 0, err
	}
	err = r.db.Model(&model.TaskConsumption{}).Where("job_id = ?", id).Count(&count).Error
	if err != nil || count > 0 {
		return count > 0, err
	}
	err = r.db.Model(&model.AIRequestLog{}).Where("id = ? AND operation = ?", id, "text").Count(&count).Error
	return count > 0, err
}
