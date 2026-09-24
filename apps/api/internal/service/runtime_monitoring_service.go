package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/repository"
)

type MonitoringFilter struct {
	Start, End                                 time.Time
	UserID, Source, Status, Code, Model, Query string
	Page, PageSize                             int
	Admin                                      bool
}
type MonitoringRow struct {
	model.RuntimeError
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	Provider    string `json:"provider,omitempty"`
	MaxAttempts int    `json:"max_attempts"`
}
type MonitoringGroup struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}
type MonitoringBucket struct {
	Bucket  time.Time `json:"bucket"`
	Records int       `json:"records"`
	Errors  int       `json:"errors"`
}
type MonitoringStats struct {
	Records           int   `json:"records"`
	Errors            int   `json:"errors"`
	Successes         int   `json:"successes"`
	Pending           int   `json:"pending"`
	Canceled          int   `json:"canceled"`
	AffectedUsers     int   `json:"affected_users"`
	AverageDurationMS int64 `json:"average_duration_ms"`
}
type MonitoringReport struct {
	GeneratedAt time.Time          `json:"generated_at"`
	Start       time.Time          `json:"start"`
	End         time.Time          `json:"end"`
	IsGlobal    bool               `json:"is_global"`
	CanViewAll  bool               `json:"can_view_all"`
	UserID      string             `json:"user_id"`
	Items       []MonitoringRow    `json:"items"`
	Total       int                `json:"total"`
	Page        int                `json:"page"`
	PageSize    int                `json:"page_size"`
	Stats       MonitoringStats    `json:"stats"`
	Buckets     []MonitoringBucket `json:"buckets"`
	Codes       []MonitoringGroup  `json:"codes"`
	Sources     []MonitoringGroup  `json:"sources"`
}
type RuntimeMonitoringService struct {
	repo  repository.RuntimeMonitoringRepository
	users repository.UserRepository
}

func NewRuntimeMonitoringService(repo repository.RuntimeMonitoringRepository, users repository.UserRepository) *RuntimeMonitoringService {
	return &RuntimeMonitoringService{repo: repo, users: users}
}

func (s *RuntimeMonitoringService) Report(ctx context.Context, f MonitoringFilter) (MonitoringReport, error) {
	out := MonitoringReport{GeneratedAt: time.Now().UTC(), Start: f.Start, End: f.End, CanViewAll: f.Admin, IsGlobal: f.Admin && f.UserID == "", UserID: f.UserID, Items: []MonitoringRow{}, Page: f.Page, PageSize: f.PageSize, Buckets: []MonitoringBucket{}, Codes: []MonitoringGroup{}, Sources: []MonitoringGroup{}}
	facts, err := s.repo.Facts(ctx, f.Start, f.End, f.UserID)
	if err != nil {
		return out, err
	}
	rows := make([]MonitoringRow, 0, len(facts.Errors)+len(facts.Calls)+len(facts.Jobs))
	for _, event := range facts.Errors {
		rows = append(rows, MonitoringRow{RuntimeError: event, Status: "error"})
	}
	for _, call := range facts.Calls {
		// Successful image proxy logs acknowledge enqueue, not successful generation.
		if call.Status == model.AIRequestStatusSuccess && (call.Operation == "image_generation" || call.Operation == "image_edit") {
			continue
		}
		rows = append(rows, MonitoringRow{RuntimeError: model.RuntimeError{ID: call.ID, UserID: call.UserID, Source: "ai", RequestID: call.RequestID, Operation: call.Operation, Endpoint: call.Endpoint, Model: call.Model, HTTPStatus: call.HTTPStatus, ProviderStatus: call.ProviderStatus, DurationMS: call.DurationMS, ErrorCode: call.ErrorReason, Message: call.ErrorMessage, Detail: call.ErrorReason, Suggestion: call.ErrorSuggestion, CreatedAt: call.CreatedAt}, Username: call.Username, DisplayName: call.UserDisplayName, Status: call.Status, Provider: call.ProviderHost})
	}
	for _, job := range facts.Jobs {
		payload, problem := map[string]any{}, map[string]any{}
		_ = json.Unmarshal(job.Payload, &payload)
		_ = json.Unmarshal(job.Error, &problem)
		for _, key := range []string{"source_project_id", "source_node_id"} {
			if monitorString(payload, key) == "" {
				for _, nested := range []string{"asset_registration", "asset_context"} {
					if values, ok := payload[nested].(map[string]any); ok && monitorString(values, key) != "" {
						payload[key] = values[key]
						break
					}
				}
			}
		}
		created := job.CreatedAt
		duration := int64(0)
		if job.FinishedAt != nil {
			created = *job.FinishedAt
			duration = max(0, job.FinishedAt.Sub(job.CreatedAt).Milliseconds())
		}
		status := job.Status
		if status == model.JobStatusFailed {
			status = "error"
		}
		if status == model.JobStatusSucceeded {
			status = "success"
		}
		retryable, _ := problem["retryable"].(bool)
		rows = append(rows, MonitoringRow{RuntimeError: model.RuntimeError{ID: job.ID, UserID: job.UserID, Source: "job", JobID: job.ID, RequestID: monitorString(payload, "request_id"), ProjectID: monitorString(payload, "source_project_id"), NodeID: monitorString(payload, "source_node_id"), Model: monitorString(payload, "model"), Operation: job.Type, Message: monitorString(problem, "message"), ErrorCode: monitorString(problem, "code"), Detail: monitorString(problem, "reason"), Suggestion: monitorString(problem, "suggestion"), DurationMS: duration, Attempt: job.Attempts, Retryable: retryable, CreatedAt: created}, Status: status, MaxAttempts: job.MaxAttempts, Provider: job.ExternalProvider})
	}
	users := map[string]model.User{}
	for i := range rows {
		row := &rows[i]
		row.CreatedAt = row.CreatedAt.UTC()
		if row.Source == "ai" {
			row.ErrorCode = ""
			if row.Status == "error" {
				row.ErrorCode = fmt.Sprintf("http_%d", row.HTTPStatus)
			}
		}
		if row.UserID != "" {
			u, ok := users[row.UserID]
			if !ok {
				u, _ = s.users.GetUser(row.UserID)
				users[row.UserID] = u
			}
			if u.ID != "" {
				row.Username, row.DisplayName = u.Username, u.DisplayName
			}
		}
		row.Message, row.Detail, row.Suggestion = monitoring.SafeText(row.Message), monitoring.SafeText(row.Detail), monitoring.SafeText(row.Suggestion)
		row.Model, row.Endpoint, row.Operation = monitoring.SafeText(row.Model), monitoring.SafeText(row.Endpoint), monitoring.SafeText(row.Operation)
		row.ErrorCode = monitoring.SafeText(row.ErrorCode)
		if !f.Admin {
			row.Provider = ""
			if row.Source == "worker" || row.ErrorCode == "internal_panic" {
				row.Detail = ""
			}
			row.ProviderStatus = 0
		}
		if row.Status == "error" && row.ErrorCode == "" {
			row.ErrorCode = "unknown_error"
		}
	}
	filtered := make([]MonitoringRow, 0, len(rows))
	search := strings.ToLower(f.Query)
	for _, r := range rows {
		if (f.Source != "" && r.Source != f.Source) || (f.Code != "" && r.ErrorCode != f.Code) || (f.Model != "" && !strings.Contains(strings.ToLower(r.Model), strings.ToLower(f.Model))) {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(strings.Join([]string{r.ID, r.RequestID, r.JobID, r.ProjectID, r.NodeID, r.Username, r.DisplayName, r.Message, r.Detail, r.ErrorCode, r.Operation, r.Model}, " ")), search) {
			continue
		}
		filtered = append(filtered, r)
	}
	window := f.End.Sub(f.Start)
	bucketSize := time.Hour
	if window <= 2*time.Hour {
		bucketSize = 5 * time.Minute
	} else if window > 24*time.Hour && window <= 7*24*time.Hour {
		bucketSize = 6 * time.Hour
	} else if window > 7*24*time.Hour {
		bucketSize = 24 * time.Hour
	}
	buckets := map[time.Time]*MonitoringBucket{}
	for t := f.Start.Truncate(bucketSize); t.Before(f.End); t = t.Add(bucketSize) {
		buckets[t] = &MonitoringBucket{Bucket: t}
	}
	codes, sources, affected := map[string]int{}, map[string]int{}, map[string]bool{}
	var duration int64
	for _, r := range filtered {
		out.Stats.Records++
		duration += r.DurationMS
		b := buckets[r.CreatedAt.Truncate(bucketSize)]
		if b != nil {
			b.Records++
		}
		switch r.Status {
		case "error":
			out.Stats.Errors++
			codes[r.ErrorCode]++
			sources[r.Source]++
			affected[r.UserID] = true
			if b != nil {
				b.Errors++
			}
		case "success":
			out.Stats.Successes++
		case "canceled":
			out.Stats.Canceled++
		default:
			out.Stats.Pending++
		}
		if f.Status == "" || r.Status == f.Status {
			out.Items = append(out.Items, r)
		}
	}
	delete(affected, "")
	out.Stats.AffectedUsers = len(affected)
	if out.Stats.Records > 0 {
		out.Stats.AverageDurationMS = duration / int64(out.Stats.Records)
	}
	for _, b := range buckets {
		out.Buckets = append(out.Buckets, *b)
	}
	sort.Slice(out.Buckets, func(i, j int) bool { return out.Buckets[i].Bucket.Before(out.Buckets[j].Bucket) })
	out.Codes = monitorGroups(codes)
	out.Sources = monitorGroups(sources)
	sort.Slice(out.Items, func(i, j int) bool {
		if out.Items[i].CreatedAt.Equal(out.Items[j].CreatedAt) {
			return out.Items[i].ID < out.Items[j].ID
		}
		return out.Items[i].CreatedAt.After(out.Items[j].CreatedAt)
	})
	out.Total = len(out.Items)
	offset := min(max(0, (f.Page-1)*f.PageSize), out.Total)
	out.Items = out.Items[offset:min(offset+f.PageSize, out.Total)]
	return out, nil
}
func monitorString(m map[string]any, key string) string { value, _ := m[key].(string); return value }
func monitorGroups(values map[string]int) []MonitoringGroup {
	groups := make([]MonitoringGroup, 0, len(values))
	for k, v := range values {
		groups = append(groups, MonitoringGroup{Key: k, Count: v})
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].Count == groups[j].Count {
			return groups[i].Key < groups[j].Key
		}
		return groups[i].Count > groups[j].Count
	})
	return groups
}
