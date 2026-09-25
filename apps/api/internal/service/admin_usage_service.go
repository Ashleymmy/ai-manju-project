package service

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

type UsageFilter struct {
	Start, End                                                                       time.Time
	UserID, ProjectID, JobID, Model, Provider, Status, MemberKind, TaskType, GroupBy string
	Page, PageSize, TimezoneOffset                                                   int
}

// UsageRow exposes only operational metadata; prompts, credentials and raw
// provider responses deliberately stay outside the admin reporting API.
type UsageRow struct {
	JobID               string     `json:"job_id"`
	UserID              string     `json:"user_id"`
	Username            string     `json:"username"`
	DisplayName         string     `json:"display_name"`
	ProjectID           string     `json:"project_id"`
	ProjectName         string     `json:"project_name"`
	WorkspaceID         string     `json:"workspace_id"`
	Internal            bool       `json:"internal"`
	TaskType            string     `json:"task_type"`
	Model               string     `json:"model"`
	Provider            string     `json:"provider"`
	Status              string     `json:"status"`
	QueuePhase          string     `json:"queue_phase"`
	CreditStatus        string     `json:"credit_status"`
	PendingReason       string     `json:"pending_reason"`
	PendingAgeSeconds   float64    `json:"pending_age_seconds"`
	CreditsQuoted       int64      `json:"credits_quoted"`
	CreditsSettled      int64      `json:"credits_settled"`
	CreatedAt           time.Time  `json:"created_at"`
	StartedAt           *time.Time `json:"started_at"`
	FinishedAt          *time.Time `json:"finished_at"`
	SettledAt           *time.Time `json:"settled_at"`
	Attempts            int        `json:"attempts"`
	EstimatedCostMicros *int64     `json:"estimated_cost_micros"`
	ActualCostMicros    *int64     `json:"actual_cost_micros"`
	CostReference       string     `json:"cost_reference"`
	RateID              string     `json:"rate_id"`
	CostUnit            string     `json:"cost_unit"`
	CostQuantity        float64    `json:"cost_quantity"`
	Resolution          string     `json:"resolution"`
	DurationSeconds     float64    `json:"duration_seconds"`
	OutputCount         float64    `json:"output_count"`
}

type UsageTotals struct {
	Tasks               int   `json:"tasks"`
	CreditsSettled      int64 `json:"credits_settled"`
	CreditsFrozen       int64 `json:"credits_frozen"`
	Succeeded           int   `json:"succeeded"`
	Failed              int   `json:"failed"`
	EstimatedCostMicros int64 `json:"estimated_cost_micros"`
	ActualCostMicros    int64 `json:"actual_cost_micros"`
	AccountedCostMicros int64 `json:"accounted_cost_micros"`
	ActualCount         int   `json:"actual_count"`
	EstimatedCount      int   `json:"estimated_count"`
	UnknownCostCount    int   `json:"unknown_cost_count"`
}
type UsageGroup struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	UsageTotals
}
type UsageReport struct {
	Items    []UsageRow   `json:"items"`
	Total    int          `json:"total"`
	Page     int          `json:"page"`
	PageSize int          `json:"page_size"`
	Stats    UsageTotals  `json:"stats"`
	Groups   []UsageGroup `json:"groups"`
}

type AdminUsageService struct {
	usage       repository.UsageRepository
	users       repository.UserRepository
	projects    repository.ProjectRepository
	memberships repository.MembershipRepository
}

func NewAdminUsageService(usage repository.UsageRepository, users repository.UserRepository, projects repository.ProjectRepository, memberships repository.MembershipRepository) *AdminUsageService {
	return &AdminUsageService{usage: usage, users: users, projects: projects, memberships: memberships}
}

func (s *AdminUsageService) Report(f UsageFilter) (UsageReport, error) {
	out := UsageReport{Items: []UsageRow{}, Groups: []UsageGroup{}, Page: f.Page, PageSize: f.PageSize}
	facts, err := s.usage.Facts(f.Start, f.End, f.UserID)
	if err != nil {
		return out, err
	}
	users, err := s.users.ListUsers()
	if err != nil {
		return out, err
	}
	projects, err := s.projects.List()
	if err != nil {
		return out, err
	}
	plans, err := s.memberships.ListPlans(false)
	if err != nil {
		return out, err
	}
	userMap := map[string]model.User{}
	for _, u := range users {
		userMap[u.ID] = u
	}
	projectMap := map[string]model.Project{}
	for _, p := range projects {
		projectMap[p.ID] = p
	}
	internalPlans := map[string]bool{}
	for _, p := range plans {
		if p.Code == model.PlanCodeInternal {
			internalPlans[p.ID] = true
		}
	}
	terms := map[string][]model.UserMembership{}
	for _, m := range facts.Memberships {
		if internalPlans[m.PlanID] {
			terms[m.UserID] = append(terms[m.UserID], m)
		}
	}
	costs := map[string]model.TaskActualCost{}
	for _, c := range facts.Costs {
		costs[c.JobID] = c
	}
	consumptions := map[string]model.TaskConsumption{}
	for _, c := range facts.Consumptions {
		consumptions[c.JobID] = c
	}
	sort.Slice(facts.Rates, func(i, j int) bool {
		a, b := facts.Rates[i], facts.Rates[j]
		if a.EffectiveAt.Equal(b.EffectiveAt) {
			if !a.CreatedAt.Equal(b.CreatedAt) {
				return a.CreatedAt.After(b.CreatedAt)
			}
			return a.ID > b.ID
		}
		return a.EffectiveAt.After(b.EffectiveAt)
	})
	rows := make([]UsageRow, 0, len(facts.Jobs)+len(facts.TextCalls))
	seen := map[string]bool{}
	for _, j := range facts.Jobs {
		seen[j.ID] = true
		row := usageJobRow(j)
		if c, ok := consumptions[j.ID]; ok {
			attachConsumption(&row, c)
			// A submission requiring reconciliation is only a pending charge
			// while its reservation remains held. Historical failures must not
			// look like frozen credits after settlement or release.
			if row.CreditStatus == model.TaskConsumptionStatusReserved && row.Provider == "sd-video" && row.Status == model.JobStatusFailed {
				var failure map[string]any
				if json.Unmarshal(j.Error, &failure) == nil && usageString(failure, "code") == "submission_uncertain" {
					row.PendingReason = "submission_uncertain"
				}
			}
		}
		rows = append(rows, row)
	}
	for _, c := range facts.Consumptions {
		if !seen[c.JobID] {
			row := UsageRow{JobID: c.JobID, UserID: c.UserID, CreatedAt: c.CreatedAt, Status: "missing_job"}
			attachConsumption(&row, c)
			rows = append(rows, row)
		}
	}
	// Image/video request logs describe submissions already represented by Jobs.
	// Only synchronous text logs are added, avoiding double-counted generation.
	for _, l := range facts.TextCalls {
		finished := l.CreatedAt.Add(time.Duration(l.DurationMS) * time.Millisecond)
		status := model.JobStatusFailed
		if l.Status == "success" {
			status = model.JobStatusSucceeded
		}
		rows = append(rows, UsageRow{JobID: l.ID, UserID: l.UserID, Username: l.Username, DisplayName: l.UserDisplayName, TaskType: "text", Model: l.Model, Provider: l.ProviderHost, Status: status, CreditStatus: "untracked", CreatedAt: l.CreatedAt, StartedAt: &l.CreatedAt, FinishedAt: &finished, OutputCount: float64(l.OutputCount)})
	}
	if len(rows) > repository.MaxUsageFacts {
		return out, repository.ErrUsageTooLarge
	}
	filtered := make([]UsageRow, 0, len(rows))
	groups := map[string]*UsageGroup{}
	for _, row := range rows {
		if u, ok := userMap[row.UserID]; ok {
			row.Username = u.Username
			row.DisplayName = u.DisplayName
		}
		if p, ok := projectMap[row.ProjectID]; ok {
			row.ProjectName = p.Title
		}
		for _, m := range terms[row.UserID] {
			end := m.ExpiresAt
			if m.Status == model.MembershipStatusRevoked && m.UpdatedAt.Before(end) {
				end = m.UpdatedAt
			}
			if !row.CreatedAt.Before(m.StartedAt) && row.CreatedAt.Before(end) {
				row.Internal = true
				break
			}
		}
		if !matchesUsage(row, f) {
			continue
		}
		estimateUsageCost(&row, facts.Rates)
		if cost, ok := costs[row.JobID]; ok {
			amount := cost.AmountMicros
			row.ActualCostMicros = &amount
			row.CostReference = cost.Reference
		}
		filtered = append(filtered, row)
		addUsageTotals(&out.Stats, row)
		key, label := usageGroupKey(row, f)
		g := groups[key]
		if g == nil {
			g = &UsageGroup{Key: key, Label: label}
			groups[key] = g
		}
		addUsageTotals(&g.UsageTotals, row)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].JobID > filtered[j].JobID
		}
		return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
	})
	for _, g := range groups {
		out.Groups = append(out.Groups, *g)
	}
	sort.Slice(out.Groups, func(i, j int) bool {
		if f.GroupBy == "hour" || f.GroupBy == "day" || f.GroupBy == "month" {
			return out.Groups[i].Key < out.Groups[j].Key
		}
		if out.Groups[i].CreditsSettled == out.Groups[j].CreditsSettled {
			return out.Groups[i].Key < out.Groups[j].Key
		}
		return out.Groups[i].CreditsSettled > out.Groups[j].CreditsSettled
	})
	out.Total = len(filtered)
	start := (f.Page - 1) * f.PageSize
	if start < 0 {
		start = 0
	}
	end := start + f.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	if start < len(filtered) {
		out.Items = filtered[start:end]
	}
	return out, nil
}

func usageJobRow(j model.Job) UsageRow {
	var payload map[string]any
	_ = json.Unmarshal(j.Payload, &payload)
	row := UsageRow{JobID: j.ID, UserID: j.UserID, WorkspaceID: j.WorkspaceID, TaskType: j.Type, Status: j.Status, QueuePhase: j.QueuePhase, CreatedAt: j.CreatedAt, StartedAt: j.StartedAt, FinishedAt: j.FinishedAt, Attempts: j.Attempts, CreditStatus: "untracked", Provider: j.ExternalProvider}
	row.Model = usageString(payload, "model", "model_id")
	if row.Provider == "" {
		row.Provider = usageString(payload, "provider_id", "provider")
	}
	row.ProjectID = usageString(payload, "source_project_id", "project_id")
	for _, key := range []string{"asset_registration", "asset_context", "registration"} {
		if v, ok := payload[key].(map[string]any); ok && row.ProjectID == "" {
			row.ProjectID = usageString(v, "source_project_id", "project_id")
		}
	}
	row.Resolution = usageString(payload, "resolution", "size")
	row.DurationSeconds = usageNumber(payload, "duration_sec", "duration_seconds", "duration")
	row.OutputCount = usageNumber(payload, "n", "num_images", "count")
	if row.OutputCount == 0 && strings.HasPrefix(j.Type, "image.") {
		row.OutputCount = 1
	}
	return row
}

func attachConsumption(row *UsageRow, c model.TaskConsumption) {
	row.CreditStatus = c.Status
	row.CreditsQuoted = c.CreditsQuoted
	row.CreditsSettled = c.CreditsSettled
	row.SettledAt = c.SettledAt
	row.TaskType = c.TaskType
	if c.Model != "" {
		row.Model = c.Model
	}
	var p map[string]any
	_ = json.Unmarshal(c.Params, &p)
	row.PendingReason = ""
	row.PendingAgeSeconds = 0
	if c.Status == model.TaskConsumptionStatusReserved {
		pendingSince := c.CreatedAt
		if pendingSince.IsZero() {
			pendingSince = row.CreatedAt
		}
		if !pendingSince.IsZero() {
			row.PendingAgeSeconds = math.Max(0, time.Since(pendingSince).Seconds())
		}
		switch {
		case row.Status == model.JobStatusSucceeded && usageString(p, "billing_mode") == AutomaticVideoBillingMode:
			row.PendingReason = "video_metrics_pending"
		case row.QueuePhase != "":
			row.PendingReason = row.QueuePhase
		case row.Status == model.JobStatusQueued || row.Status == model.JobStatusRunning:
			row.PendingReason = "job_in_progress"
		default:
			row.PendingReason = "reservation_pending"
		}
	}
	if row.DurationSeconds == 0 {
		row.DurationSeconds = usageNumber(p, "duration_sec", "duration")
	}
	if row.Resolution == "" {
		row.Resolution = usageString(p, "resolution", "size")
	}
}
func usageString(p map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := p[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func usageNumber(p map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if v, ok := p[key].(float64); ok && v > 0 && !math.IsNaN(v) && !math.IsInf(v, 0) {
			return v
		}
	}
	return 0
}
func matchesUsage(r UsageRow, f UsageFilter) bool {
	return (f.UserID == "" || r.UserID == f.UserID) && (f.ProjectID == "" || r.ProjectID == f.ProjectID || (f.ProjectID == "unassigned" && r.ProjectID == "")) && (f.JobID == "" || strings.Contains(r.JobID, f.JobID)) && (f.Model == "" || strings.Contains(strings.ToLower(r.Model), strings.ToLower(f.Model))) && (f.Provider == "" || r.Provider == f.Provider) && (f.Status == "" || r.Status == f.Status) && (f.TaskType == "" || r.TaskType == f.TaskType) && (f.MemberKind == "" || (f.MemberKind == "internal" && r.Internal) || (f.MemberKind == "external" && !r.Internal))
}

func estimateUsageCost(row *UsageRow, rates []model.ModelCostRate) {
	// Failed/canceled calls may still incur vendor charges: they stay unknown
	// until reconciled, instead of silently assuming that their cost is zero.
	if row.Status != model.JobStatusSucceeded {
		return
	}
	var rate *model.ModelCostRate
	for i := range rates {
		v := &rates[i]
		if v.Model != row.Model || v.EffectiveAt.After(row.CreatedAt) || (v.Provider != "" && v.Provider != row.Provider) {
			continue
		}
		if rate == nil || (rate.Provider == "" && v.Provider != "") {
			rate = v
		}
	}
	if rate == nil {
		return
	}
	quantity := float64(1)
	switch rate.Unit {
	case model.CostUnitImage:
		quantity = row.OutputCount
	case model.CostUnitSecond:
		quantity = row.DurationSeconds
	case model.CostUnitTask:
	default:
		return
	}
	value := float64(rate.UnitCostMicros) * quantity
	if quantity <= 0 || math.IsInf(value, 0) || value > float64(math.MaxInt64) {
		return
	}
	amount := int64(math.Round(value))
	row.EstimatedCostMicros = &amount
	row.CostUnit = rate.Unit
	row.CostQuantity = quantity
	row.RateID = rate.ID
}
func addUsageTotals(t *UsageTotals, r UsageRow) {
	t.Tasks++
	t.CreditsSettled += r.CreditsSettled
	if r.CreditStatus == model.TaskConsumptionStatusReserved {
		t.CreditsFrozen += r.CreditsQuoted
	}
	if r.Status == model.JobStatusSucceeded {
		t.Succeeded++
	}
	if r.Status == model.JobStatusFailed || r.Status == model.JobStatusCanceled {
		t.Failed++
	}
	if r.EstimatedCostMicros != nil {
		t.EstimatedCostMicros += *r.EstimatedCostMicros
		t.EstimatedCount++
	}
	if r.ActualCostMicros != nil {
		t.ActualCostMicros += *r.ActualCostMicros
		t.AccountedCostMicros += *r.ActualCostMicros
		t.ActualCount++
	} else if r.EstimatedCostMicros != nil {
		t.AccountedCostMicros += *r.EstimatedCostMicros
	} else {
		t.UnknownCostCount++
	}
}
func usageGroupKey(r UsageRow, f UsageFilter) (string, string) {
	switch f.GroupBy {
	case "member":
		label := r.DisplayName
		if label == "" {
			label = r.Username
		}
		return r.UserID, label
	case "project":
		label := r.ProjectName
		if label == "" {
			label = r.ProjectID
		}
		if label == "" {
			label = "未关联项目"
		}
		return r.ProjectID, label
	case "model":
		return r.Provider + "/" + r.Model, r.Model
	case "task":
		return r.JobID, r.JobID
	default:
		local := r.CreatedAt.In(time.FixedZone("report", f.TimezoneOffset*60))
		layout := "2006-01-02"
		if f.GroupBy == "hour" {
			layout = "2006-01-02 15:00"
		}
		if f.GroupBy == "month" {
			layout = "2006-01"
		}
		key := local.Format(layout)
		return key, fmt.Sprint(key)
	}
}
