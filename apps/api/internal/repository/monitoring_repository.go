package repository

import (
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

type AIRequestAggregate struct {
	TotalRequests     int64      `json:"total_requests"`
	SuccessRequests   int64      `json:"success_requests"`
	ErrorRequests     int64      `json:"error_requests"`
	TotalDurationMS   int64      `json:"total_duration_ms"`
	TotalOutputCount  int64      `json:"total_output_count"`
	TotalUnits        int64      `json:"total_units"`
	WindowStart       time.Time  `json:"window_start"`
	WindowEnd         time.Time  `json:"window_end"`
	LatestRequestTime *time.Time `json:"latest_request_time,omitempty"`
}

type AIRequestUserAggregate struct {
	UserID          string     `json:"user_id"`
	Username        string     `json:"username"`
	UserDisplayName string     `json:"user_display_name"`
	Requests        int64      `json:"requests"`
	Successes       int64      `json:"successes"`
	Errors          int64      `json:"errors"`
	Outputs         int64      `json:"outputs"`
	Units           int64      `json:"units"`
	AvgDurationMS   float64    `json:"avg_duration_ms"`
	LastRequestAt   *time.Time `json:"last_request_at,omitempty"`
}

type AIRequestModelAggregate struct {
	Model         string  `json:"model"`
	Operation     string  `json:"operation"`
	Requests      int64   `json:"requests"`
	Successes     int64   `json:"successes"`
	Errors        int64   `json:"errors"`
	Outputs       int64   `json:"outputs"`
	Units         int64   `json:"units"`
	AvgDurationMS float64 `json:"avg_duration_ms"`
}

type AIRequestOperationAggregate struct {
	Operation string `json:"operation"`
	Requests  int64  `json:"requests"`
	Successes int64  `json:"successes"`
	Errors    int64  `json:"errors"`
	Outputs   int64  `json:"outputs"`
	Units     int64  `json:"units"`
}

type AIRequestBucketAggregate struct {
	Bucket      time.Time `json:"bucket"`
	Requests    int64     `json:"requests"`
	Successes   int64     `json:"successes"`
	Errors      int64     `json:"errors"`
	Units       int64     `json:"units"`
	AvgDuration float64   `json:"avg_duration"`
	OutputCount int64     `json:"output_count"`
}

type AdminStorageStats struct {
	Users      int64 `json:"users"`
	Projects   int64 `json:"projects"`
	Snapshots  int64 `json:"snapshots"`
	Assets     int64 `json:"assets"`
	AIRequests int64 `json:"ai_requests"`
}

type MonitoringRepository interface {
	CreateAIRequestLog(log model.AIRequestLog) error
	RecentAIRequestLogs(limit int) ([]model.AIRequestLog, error)
	AIRequestSummary(since time.Time) (AIRequestAggregate, error)
	AIRequestUsers(since time.Time, limit int) ([]AIRequestUserAggregate, error)
	AIRequestModels(since time.Time, limit int) ([]AIRequestModelAggregate, error)
	AIRequestOperations(since time.Time) ([]AIRequestOperationAggregate, error)
	AIRequestBuckets(since time.Time, bucketSize time.Duration, limit int) ([]AIRequestBucketAggregate, error)
	StorageStats() (AdminStorageStats, error)
	Ping() error
}

type MemoryMonitoringRepository struct {
	mu   sync.RWMutex
	logs []model.AIRequestLog
}

func NewMemoryMonitoringRepository() *MemoryMonitoringRepository {
	return &MemoryMonitoringRepository{logs: make([]model.AIRequestLog, 0)}
}

func (r *MemoryMonitoringRepository) CreateAIRequestLog(log model.AIRequestLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	if log.CreatedAt.IsZero() {
		log.CreatedAt = now
	}
	log.UpdatedAt = now
	r.logs = append(r.logs, log)
	return nil
}

func (r *MemoryMonitoringRepository) RecentAIRequestLogs(limit int) ([]model.AIRequestLog, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	logs := append([]model.AIRequestLog(nil), r.logs...)
	sort.Slice(logs, func(i, j int) bool {
		return logs[i].CreatedAt.After(logs[j].CreatedAt)
	})
	if limit > 0 && len(logs) > limit {
		logs = logs[:limit]
	}
	return logs, nil
}

func (r *MemoryMonitoringRepository) AIRequestSummary(since time.Time) (AIRequestAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	agg := AIRequestAggregate{WindowStart: since, WindowEnd: time.Now().UTC()}
	for _, item := range r.logs {
		if item.CreatedAt.Before(since) {
			continue
		}
		accumulateSummary(&agg, item)
	}
	return agg, nil
}

func (r *MemoryMonitoringRepository) AIRequestUsers(since time.Time, limit int) ([]AIRequestUserAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	byUser := make(map[string]*AIRequestUserAggregate)
	durationByUser := make(map[string]int64)
	for _, item := range r.logs {
		if item.CreatedAt.Before(since) {
			continue
		}
		key := item.UserID
		if key == "" {
			key = "unknown"
		}
		agg := byUser[key]
		if agg == nil {
			agg = &AIRequestUserAggregate{UserID: item.UserID, Username: item.Username, UserDisplayName: item.UserDisplayName}
			byUser[key] = agg
		}
		agg.Requests++
		if item.Status == model.AIRequestStatusSuccess {
			agg.Successes++
		} else {
			agg.Errors++
		}
		agg.Outputs += int64(item.OutputCount)
		agg.Units += int64(item.EstimatedUnits)
		durationByUser[key] += item.DurationMS
		if agg.LastRequestAt == nil || item.CreatedAt.After(*agg.LastRequestAt) {
			t := item.CreatedAt
			agg.LastRequestAt = &t
		}
	}
	result := make([]AIRequestUserAggregate, 0, len(byUser))
	for key, agg := range byUser {
		if agg.Requests > 0 {
			agg.AvgDurationMS = float64(durationByUser[key]) / float64(agg.Requests)
		}
		result = append(result, *agg)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Requests > result[j].Requests
	})
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *MemoryMonitoringRepository) AIRequestModels(since time.Time, limit int) ([]AIRequestModelAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	byModel := make(map[string]*AIRequestModelAggregate)
	durationByModel := make(map[string]int64)
	for _, item := range r.logs {
		if item.CreatedAt.Before(since) {
			continue
		}
		key := item.Model + "\x00" + item.Operation
		agg := byModel[key]
		if agg == nil {
			agg = &AIRequestModelAggregate{Model: item.Model, Operation: item.Operation}
			byModel[key] = agg
		}
		agg.Requests++
		if item.Status == model.AIRequestStatusSuccess {
			agg.Successes++
		} else {
			agg.Errors++
		}
		agg.Outputs += int64(item.OutputCount)
		agg.Units += int64(item.EstimatedUnits)
		durationByModel[key] += item.DurationMS
	}
	result := make([]AIRequestModelAggregate, 0, len(byModel))
	for key, agg := range byModel {
		if agg.Requests > 0 {
			agg.AvgDurationMS = float64(durationByModel[key]) / float64(agg.Requests)
		}
		result = append(result, *agg)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Requests > result[j].Requests
	})
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *MemoryMonitoringRepository) AIRequestOperations(since time.Time) ([]AIRequestOperationAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	byOperation := make(map[string]*AIRequestOperationAggregate)
	for _, item := range r.logs {
		if item.CreatedAt.Before(since) {
			continue
		}
		agg := byOperation[item.Operation]
		if agg == nil {
			agg = &AIRequestOperationAggregate{Operation: item.Operation}
			byOperation[item.Operation] = agg
		}
		agg.Requests++
		if item.Status == model.AIRequestStatusSuccess {
			agg.Successes++
		} else {
			agg.Errors++
		}
		agg.Outputs += int64(item.OutputCount)
		agg.Units += int64(item.EstimatedUnits)
	}
	result := make([]AIRequestOperationAggregate, 0, len(byOperation))
	for _, agg := range byOperation {
		result = append(result, *agg)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Requests > result[j].Requests
	})
	return result, nil
}

func (r *MemoryMonitoringRepository) AIRequestBuckets(since time.Time, bucketSize time.Duration, limit int) ([]AIRequestBucketAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if bucketSize <= 0 {
		bucketSize = time.Hour
	}
	byBucket := make(map[time.Time]*AIRequestBucketAggregate)
	durationByBucket := make(map[time.Time]int64)
	for _, item := range r.logs {
		if item.CreatedAt.Before(since) {
			continue
		}
		bucket := item.CreatedAt.Truncate(bucketSize).UTC()
		agg := byBucket[bucket]
		if agg == nil {
			agg = &AIRequestBucketAggregate{Bucket: bucket}
			byBucket[bucket] = agg
		}
		agg.Requests++
		if item.Status == model.AIRequestStatusSuccess {
			agg.Successes++
		} else {
			agg.Errors++
		}
		agg.Units += int64(item.EstimatedUnits)
		agg.OutputCount += int64(item.OutputCount)
		durationByBucket[bucket] += item.DurationMS
	}
	result := make([]AIRequestBucketAggregate, 0, len(byBucket))
	for bucket, agg := range byBucket {
		if agg.Requests > 0 {
			agg.AvgDuration = float64(durationByBucket[bucket]) / float64(agg.Requests)
		}
		result = append(result, *agg)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Bucket.Before(result[j].Bucket)
	})
	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result, nil
}

func (r *MemoryMonitoringRepository) StorageStats() (AdminStorageStats, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return AdminStorageStats{AIRequests: int64(len(r.logs))}, nil
}

func (r *MemoryMonitoringRepository) Ping() error {
	return nil
}

type GormMonitoringRepository struct {
	db *gorm.DB
}

func NewGormMonitoringRepository(db *gorm.DB) *GormMonitoringRepository {
	return &GormMonitoringRepository{db: db}
}

func (r *GormMonitoringRepository) CreateAIRequestLog(log model.AIRequestLog) error {
	now := time.Now().UTC()
	if log.CreatedAt.IsZero() {
		log.CreatedAt = now
	}
	log.UpdatedAt = now
	return r.db.Create(&log).Error
}

func (r *GormMonitoringRepository) RecentAIRequestLogs(limit int) ([]model.AIRequestLog, error) {
	logs := make([]model.AIRequestLog, 0)
	query := r.db.Order("created_at DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}

func (r *GormMonitoringRepository) AIRequestSummary(since time.Time) (AIRequestAggregate, error) {
	var agg AIRequestAggregate
	err := r.db.Model(&model.AIRequestLog{}).
		Select(`
			COUNT(*) AS total_requests,
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS success_requests,
			COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS error_requests,
			COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
			COALESCE(SUM(output_count), 0) AS total_output_count,
			COALESCE(SUM(estimated_units), 0) AS total_units,
			MAX(created_at) AS latest_request_time
		`, model.AIRequestStatusSuccess, model.AIRequestStatusSuccess).
		Where("created_at >= ?", since).
		Scan(&agg).Error
	agg.WindowStart = since
	agg.WindowEnd = time.Now().UTC()
	return agg, err
}

func (r *GormMonitoringRepository) AIRequestUsers(since time.Time, limit int) ([]AIRequestUserAggregate, error) {
	rows := make([]AIRequestUserAggregate, 0)
	query := r.db.Model(&model.AIRequestLog{}).
		Select(`
			user_id,
			MAX(username) AS username,
			MAX(user_display_name) AS user_display_name,
			COUNT(*) AS requests,
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS successes,
			COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS errors,
			COALESCE(SUM(output_count), 0) AS outputs,
			COALESCE(SUM(estimated_units), 0) AS units,
			COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
			MAX(created_at) AS last_request_at
		`, model.AIRequestStatusSuccess, model.AIRequestStatusSuccess).
		Where("created_at >= ?", since).
		Group("user_id").
		Order("requests DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	return rows, query.Scan(&rows).Error
}

func (r *GormMonitoringRepository) AIRequestModels(since time.Time, limit int) ([]AIRequestModelAggregate, error) {
	rows := make([]AIRequestModelAggregate, 0)
	query := r.db.Model(&model.AIRequestLog{}).
		Select(`
			model,
			operation,
			COUNT(*) AS requests,
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS successes,
			COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS errors,
			COALESCE(SUM(output_count), 0) AS outputs,
			COALESCE(SUM(estimated_units), 0) AS units,
			COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
		`, model.AIRequestStatusSuccess, model.AIRequestStatusSuccess).
		Where("created_at >= ?", since).
		Group("model, operation").
		Order("requests DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	return rows, query.Scan(&rows).Error
}

func (r *GormMonitoringRepository) AIRequestOperations(since time.Time) ([]AIRequestOperationAggregate, error) {
	rows := make([]AIRequestOperationAggregate, 0)
	return rows, r.db.Model(&model.AIRequestLog{}).
		Select(`
			operation,
			COUNT(*) AS requests,
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS successes,
			COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS errors,
			COALESCE(SUM(output_count), 0) AS outputs,
			COALESCE(SUM(estimated_units), 0) AS units
		`, model.AIRequestStatusSuccess, model.AIRequestStatusSuccess).
		Where("created_at >= ?", since).
		Group("operation").
		Order("requests DESC").
		Scan(&rows).Error
}

func (r *GormMonitoringRepository) AIRequestBuckets(since time.Time, bucketSize time.Duration, limit int) ([]AIRequestBucketAggregate, error) {
	if bucketSize <= 0 {
		bucketSize = time.Hour
	}
	seconds := int(bucketSize.Seconds())
	if seconds <= 0 {
		seconds = 3600
	}

	rows := make([]AIRequestBucketAggregate, 0)
	query := r.db.Model(&model.AIRequestLog{}).
		Select(`
			TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM created_at) / ?) * ?) AT TIME ZONE 'UTC' AS bucket,
			COUNT(*) AS requests,
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS successes,
			COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS errors,
			COALESCE(SUM(estimated_units), 0) AS units,
			COALESCE(AVG(duration_ms), 0) AS avg_duration,
			COALESCE(SUM(output_count), 0) AS output_count
		`, seconds, seconds, model.AIRequestStatusSuccess, model.AIRequestStatusSuccess).
		Where("created_at >= ?", since).
		Group("bucket").
		Order("bucket ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	return rows, query.Scan(&rows).Error
}

func (r *GormMonitoringRepository) StorageStats() (AdminStorageStats, error) {
	var stats AdminStorageStats
	if err := r.db.Model(&model.User{}).Count(&stats.Users).Error; err != nil {
		return stats, err
	}
	if err := r.db.Model(&model.Project{}).Count(&stats.Projects).Error; err != nil {
		return stats, err
	}
	if err := r.db.Model(&model.CanvasSnapshot{}).Count(&stats.Snapshots).Error; err != nil {
		return stats, err
	}
	if err := r.db.Model(&model.Asset{}).Count(&stats.Assets).Error; err != nil {
		return stats, err
	}
	if err := r.db.Model(&model.AIRequestLog{}).Count(&stats.AIRequests).Error; err != nil {
		return stats, err
	}
	return stats, nil
}

func (r *GormMonitoringRepository) Ping() error {
	sqlDB, err := r.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Ping()
}

func accumulateSummary(agg *AIRequestAggregate, item model.AIRequestLog) {
	agg.TotalRequests++
	if item.Status == model.AIRequestStatusSuccess {
		agg.SuccessRequests++
	} else {
		agg.ErrorRequests++
	}
	agg.TotalDurationMS += item.DurationMS
	agg.TotalOutputCount += int64(item.OutputCount)
	agg.TotalUnits += int64(item.EstimatedUnits)
	if agg.LatestRequestTime == nil || item.CreatedAt.After(*agg.LatestRequestTime) {
		t := item.CreatedAt
		agg.LatestRequestTime = &t
	}
}
