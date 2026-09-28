package repository

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
)

// Credit ledger repository sentinel errors.
var (
	ErrCreditAccountNotFound    = errors.New("credit account not found")
	ErrCreditGrantNotFound      = errors.New("credit grant not found")
	ErrCreditLedgerNotFound     = errors.New("credit ledger entry not found")
	ErrConsumptionNotFound      = errors.New("task consumption not found")
	ErrInsufficientCredits      = errors.New("insufficient credits")
	ErrConsumptionNotReserved   = errors.New("task consumption is not in reserved state")
	ErrActualSettlementRequired = errors.New("automatic video requires measured settlement")
	ErrInvalidSettlementAmount  = errors.New("settlement must be between zero and reserved credits")
)

// ReserveInput carries a fully priced charge request. Pricing is computed
// upstream from billing_configs; the repository never interprets prices.
type ReserveInput struct {
	JobID    string
	UserID   string
	TaskType string
	Model    string
	Params   model.JSONB
	Credits  int64
	Now      time.Time
}

// ReserveOutcome reports the reservation; Duplicate=true means the job already
// had a consumption record (idempotent replay) and nothing was frozen again.
type ReserveOutcome struct {
	Consumption model.TaskConsumption
	Duplicate   bool
}

// SettleOutcome / ReleaseOutcome report terminal transitions; Changed=false
// means the record was already terminal (idempotent no-op).
type SettleOutcome struct {
	Consumption model.TaskConsumption
	Changed     bool
}

type ReleaseOutcome struct {
	Consumption model.TaskConsumption
	Changed     bool
}

// GrantOutcome reports a grant creation; Created=false means the PeriodKey
// already existed and the existing grant was returned unchanged.
type GrantOutcome struct {
	Grant   model.CreditGrant
	Created bool
}

// ExpireOutcome reports one sweep of a grant. Deducted is the amount written
// off (remaining minus frozen at sweep time); AlreadyExpired=true means the
// grant was no longer active.
type ExpireOutcome struct {
	Grant          model.CreditGrant
	Deducted       int64
	AlreadyExpired bool
}

// AdjustOutcome reports an admin adjustment; Applied=false means the nonce was
// seen before and no balance moved.
type AdjustOutcome struct {
	Account model.CreditAccount
	Applied bool
}

// ConsumptionStats 汇总任务消耗（后台模块4 顶部统计卡）。
type ConsumptionStats struct {
	TotalCreditsSettled int64 // 已结算扣减积分合计
	SuccessCount        int64 // status=settled
	FailedCount         int64 // 已释放且原任务失败的统计在 service 层做，这里只数 consumption 状态
	ReleasedCount       int64 // status=released
	ReservedCount       int64 // status=reserved
	ImageCount          int64 // settled 且 task_type=image 的任务数
	VideoSeconds        int64 // settled 且 task_type=video_* 的 params.duration_sec 合计
	AgentCalls          int64 // settled 且 task_type=agent_skill 的次数
}

// CreditRepository is the transactional core of the credit ledger. Every
// mutation method is atomic and owns its full transaction; the Memory
// implementation reproduces identical semantics under one mutex so the same
// test suite can run against both.
type CreditRepository interface {
	// EnsureAccount creates the zero-balance account when missing.
	EnsureAccount(userID string, now time.Time) (model.CreditAccount, error)
	GetAccount(userID string) (model.CreditAccount, error)

	GetGrantByID(id string) (model.CreditGrant, error)
	GetGrantByPeriodKey(periodKey string) (model.CreditGrant, error)
	// ListActiveGrants returns spendable grants in FEFO order
	// (expires_at ASC, id ASC) — 限时优先且先扣快过期的。
	ListActiveGrants(userID string, now time.Time) ([]model.CreditGrant, error)
	ListGrantsByUser(userID string) ([]model.CreditGrant, error)
	// ListGrantsByRelatedID finds grant batches tied to one source record
	// (membership/order/invite) — used by membership-expiry and refund sweeps.
	ListGrantsByRelatedID(relatedID string, sourceType string) ([]model.CreditGrant, error)
	// ListExpirableGrants feeds the sweeper: active, past expiry, still holding
	// spendable (remaining > frozen) balance.
	ListExpirableGrants(now time.Time, limit int) ([]model.CreditGrant, error)

	LedgerEntryExists(idempotencyKey string) (bool, error)
	GetLedgerByIdempotencyKey(idempotencyKey string) (model.CreditLedgerEntry, error)
	ListLedger(userID string, entryType string, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error)
	// ListLedgerGlobal 全平台/按用户流水查询（后台模块4）：userID/entryType
	// 空串不筛；start/end 零值不筛（start → created_at>=，end → created_at<=）；
	// 排序 created_at DESC, id DESC，分页与总数口径同 ListLedger。
	ListLedgerGlobal(userID string, entryType string, start time.Time, end time.Time, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error)

	GetConsumptionByJobID(jobID string) (model.TaskConsumption, error)
	ListConsumptions(userID string, status string, page int, pageSize int) ([]model.TaskConsumption, int64, error)
	// ListConsumptionsGlobal 全平台/按用户消耗查询：userID/taskType/status 空串不筛，
	// start/end 非零则按 created_at 过滤；排序 created_at DESC, id DESC。
	ListConsumptionsGlobal(userID string, taskType string, status string, start time.Time, end time.Time, page int, pageSize int) ([]model.TaskConsumption, int64, error)
	// ConsumptionStats 汇总任务消耗统计卡；userID 空串 = 全平台。
	ConsumptionStats(userID string) (ConsumptionStats, error)
	// ConsumptionStatsInRange 同上，但按 created_at 时间窗过滤（用户端「本月消耗」）。
	ConsumptionStatsInRange(userID string, start time.Time, end time.Time) (ConsumptionStats, error)
	// SumConsumedCredits 合计 consume 流水在范围内的 -amount（返回正数）；
	// start/end 零值不筛。
	SumConsumedCredits(start time.Time, end time.Time) (int64, error)
	// ListReservedConsumptions feeds the settlement reconciler: consumptions
	// still holding a freeze, oldest first so a backlog drains in order.
	ListReservedConsumptions(limit int) ([]model.TaskConsumption, error)
	ListReservedConsumptionsAfter(createdAt time.Time, id string, limit int) ([]model.TaskConsumption, error)

	// CreateGrantWithLedger inserts the grant and its ledger entry atomically.
	// An empty PeriodKey gets a generated unique value so the unique index is
	// never exercised by one-off grants.
	CreateGrantWithLedger(grant model.CreditGrant, entryType string, operatorID string, relatedOrderID string, now time.Time) (GrantOutcome, error)

	// Reserve freezes credits FEFO (grants first, permanent last) and records
	// the freeze-time allocation snapshot on the consumption row.
	Reserve(input ReserveInput) (ReserveOutcome, error)
	// Settle replays the allocation snapshot (frozen → charged) and writes one
	// ledger line per touched bucket. Never re-reads balances.
	Settle(jobID string, now time.Time) (SettleOutcome, error)
	// SettleAmount atomically charges part of the frozen allocation and releases
	// its remainder; params retains the submitted rate snapshot and actual metrics.
	SettleAmount(jobID string, credits int64, params model.JSONB, now time.Time) (SettleOutcome, error)
	// Release returns frozen amounts without any ledger movement (失败/取消不扣费).
	Release(jobID string, now time.Time) (ReleaseOutcome, error)
	// ExpireGrant writes off the spendable part (remaining − frozen) of one
	// grant, keeping frozen amounts for in-flight tasks. Idempotent via the
	// expire:{grant_id} ledger key.
	ExpireGrant(grantID string, now time.Time) (ExpireOutcome, error)
	// AdjustPermanent moves the permanent balance by a signed delta with a
	// caller-supplied nonce as the idempotency key.
	AdjustPermanent(userID string, delta int64, entryType string, operatorID string, nonce string, now time.Time) (AdjustOutcome, error)
	// DeductPermanentForRefund rolls back credits a refunded order granted.
	// The permanent balance may go negative; reserves stay blocked until a
	// later recharge lifts it back above zero.
	DeductPermanentForRefund(userID string, credits int64, orderID string, now time.Time) (bool, error)

	// TryAcquireSchedulerLock serializes the WP-M4 scheduler across API
	// replicas. Postgres uses a session-level advisory lock held on a dedicated
	// connection; Memory always acquires (single process). The engine's
	// idempotency keys remain the real safety net — the lock only reduces
	// duplicate work. release must be called when acquired is true.
	TryAcquireSchedulerLock(name string) (release func(), acquired bool, err error)
}

// ---------------------------------------------------------------------------
// Memory implementation (dev/test). One mutex serializes everything — memory
// mode prioritizes correctness over parallelism.
// ---------------------------------------------------------------------------

type MemoryCreditRepository struct {
	mu           sync.Mutex
	accounts     map[string]model.CreditAccount
	grants       map[string]model.CreditGrant
	ledger       map[string]model.CreditLedgerEntry
	consumptions map[string]model.TaskConsumption
}

func NewMemoryCreditRepository() *MemoryCreditRepository {
	return &MemoryCreditRepository{
		accounts:     make(map[string]model.CreditAccount),
		grants:       make(map[string]model.CreditGrant),
		ledger:       make(map[string]model.CreditLedgerEntry),
		consumptions: make(map[string]model.TaskConsumption),
	}
}

func (r *MemoryCreditRepository) EnsureAccount(userID string, now time.Time) (model.CreditAccount, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ensureAccountLocked(userID, now), nil
}

func (r *MemoryCreditRepository) ensureAccountLocked(userID string, now time.Time) model.CreditAccount {
	account, ok := r.accounts[userID]
	if !ok {
		account = model.CreditAccount{UserID: userID, CreatedAt: now, UpdatedAt: now}
		r.accounts[userID] = account
	}
	return account
}

func (r *MemoryCreditRepository) GetAccount(userID string) (model.CreditAccount, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	account, ok := r.accounts[userID]
	if !ok {
		return model.CreditAccount{}, ErrCreditAccountNotFound
	}
	return account, nil
}

func (r *MemoryCreditRepository) GetGrantByID(id string) (model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	grant, ok := r.grants[id]
	if !ok {
		return model.CreditGrant{}, ErrCreditGrantNotFound
	}
	return grant, nil
}

func (r *MemoryCreditRepository) GetGrantByPeriodKey(periodKey string) (model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, grant := range r.grants {
		if grant.PeriodKey == periodKey {
			return grant, nil
		}
	}
	return model.CreditGrant{}, ErrCreditGrantNotFound
}

func sortGrantsFEFO(grants []model.CreditGrant) {
	sort.SliceStable(grants, func(i, j int) bool {
		if !grants[i].ExpiresAt.Equal(grants[j].ExpiresAt) {
			return grants[i].ExpiresAt.Before(grants[j].ExpiresAt)
		}
		return grants[i].ID < grants[j].ID
	})
}

func (r *MemoryCreditRepository) ListActiveGrants(userID string, now time.Time) ([]model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.CreditGrant, 0)
	for _, grant := range r.grants {
		if grant.UserID == userID && grant.Status == model.GrantStatusActive && grant.ExpiresAt.After(now) {
			result = append(result, grant)
		}
	}
	sortGrantsFEFO(result)
	return result, nil
}

func (r *MemoryCreditRepository) ListGrantsByUser(userID string) ([]model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.CreditGrant, 0)
	for _, grant := range r.grants {
		if grant.UserID == userID {
			result = append(result, grant)
		}
	}
	sortGrantsFEFO(result)
	return result, nil
}

func (r *MemoryCreditRepository) ListGrantsByRelatedID(relatedID string, sourceType string) ([]model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.CreditGrant, 0)
	for _, grant := range r.grants {
		if grant.RelatedID == relatedID && grant.SourceType == sourceType {
			result = append(result, grant)
		}
	}
	sortGrantsFEFO(result)
	return result, nil
}

func (r *MemoryCreditRepository) ListExpirableGrants(now time.Time, limit int) ([]model.CreditGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.CreditGrant, 0)
	for _, grant := range r.grants {
		if grant.Status != model.GrantStatusActive || grant.ExpiresAt.After(now) {
			continue
		}
		if grant.AmountRemaining-grant.AmountFrozen <= 0 {
			continue
		}
		result = append(result, grant)
	}
	sortGrantsFEFO(result)
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *MemoryCreditRepository) LedgerEntryExists(idempotencyKey string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, entry := range r.ledger {
		if entry.IdempotencyKey == idempotencyKey {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryCreditRepository) ListLedger(userID string, entryType string, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]model.CreditLedgerEntry, 0)
	for _, entry := range r.ledger {
		if entry.UserID != userID {
			continue
		}
		if entryType != "" && entry.EntryType != entryType {
			continue
		}
		filtered = append(filtered, entry)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
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
		return []model.CreditLedgerEntry{}, total, nil
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[start:end], total, nil
}

// paginateMemorySlice 对已排序列表做通用分页切片（page 从 1 开始），
// 仅供 Memory 实现的只读列表方法使用。
func paginateMemorySlice[T any](items []T, page int, pageSize int) ([]T, int64) {
	total := int64(len(items))
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []T{}, total
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[start:end], total
}

func (r *MemoryCreditRepository) ListLedgerGlobal(userID string, entryType string, start time.Time, end time.Time, page int, pageSize int) ([]model.CreditLedgerEntry, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]model.CreditLedgerEntry, 0)
	for _, entry := range r.ledger {
		if userID != "" && entry.UserID != userID {
			continue
		}
		if entryType != "" && entry.EntryType != entryType {
			continue
		}
		if !start.IsZero() && entry.CreatedAt.Before(start) {
			continue
		}
		if !end.IsZero() && entry.CreatedAt.After(end) {
			continue
		}
		filtered = append(filtered, entry)
	}
	// 与 Gorm 版排序逐一致：created_at DESC, id DESC
	sort.SliceStable(filtered, func(i, j int) bool {
		if !filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
		}
		return filtered[i].ID > filtered[j].ID
	})
	items, total := paginateMemorySlice(filtered, page, pageSize)
	return items, total, nil
}

func (r *MemoryCreditRepository) ListConsumptionsGlobal(userID string, taskType string, status string, start time.Time, end time.Time, page int, pageSize int) ([]model.TaskConsumption, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]model.TaskConsumption, 0)
	for _, consumption := range r.consumptions {
		if userID != "" && consumption.UserID != userID {
			continue
		}
		if taskType != "" && consumption.TaskType != taskType {
			continue
		}
		if status != "" && consumption.Status != status {
			continue
		}
		if !start.IsZero() && consumption.CreatedAt.Before(start) {
			continue
		}
		if !end.IsZero() && consumption.CreatedAt.After(end) {
			continue
		}
		filtered = append(filtered, consumption)
	}
	// 与 Gorm 版排序逐一致：created_at DESC, id DESC
	sort.SliceStable(filtered, func(i, j int) bool {
		if !filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
		}
		return filtered[i].ID > filtered[j].ID
	})
	items, total := paginateMemorySlice(filtered, page, pageSize)
	return items, total, nil
}

func (r *MemoryCreditRepository) ConsumptionStats(userID string) (ConsumptionStats, error) {
	return r.ConsumptionStatsInRange(userID, time.Time{}, time.Time{})
}

func (r *MemoryCreditRepository) ConsumptionStatsInRange(userID string, start time.Time, end time.Time) (ConsumptionStats, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	consumptions := make([]model.TaskConsumption, 0)
	for _, consumption := range r.consumptions {
		if userID != "" && consumption.UserID != userID {
			continue
		}
		if !start.IsZero() && consumption.CreatedAt.Before(start) {
			continue
		}
		if !end.IsZero() && consumption.CreatedAt.After(end) {
			continue
		}
		consumptions = append(consumptions, consumption)
	}
	return computeConsumptionStats(consumptions), nil
}

func (r *MemoryCreditRepository) SumConsumedCredits(start time.Time, end time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total int64
	for _, entry := range r.ledger {
		if entry.EntryType != model.LedgerTypeConsume {
			continue
		}
		if !start.IsZero() && entry.CreatedAt.Before(start) {
			continue
		}
		if !end.IsZero() && entry.CreatedAt.After(end) {
			continue
		}
		// consume 流水的 amount 为负，取负得正数合计
		total += -entry.Amount
	}
	return total, nil
}

// computeConsumptionStats 由 Memory/Gorm 双实现共用，保证统计口径一致：
// VideoSeconds 在 Go 里解析 params JSONB 的 duration_sec（字段缺失/非数按 0），
// Gorm 版刻意不用 SQL jsonb 函数。
func computeConsumptionStats(consumptions []model.TaskConsumption) ConsumptionStats {
	stats := ConsumptionStats{}
	for _, consumption := range consumptions {
		switch consumption.Status {
		case model.TaskConsumptionStatusSettled:
			stats.SuccessCount++
			stats.TotalCreditsSettled += consumption.CreditsSettled
			if consumption.TaskType == model.TaskTypeImage {
				stats.ImageCount++
			}
			if strings.HasPrefix(consumption.TaskType, "video_") {
				stats.VideoSeconds += consumptionDurationSec(consumption.Params)
			}
			if consumption.TaskType == model.TaskTypeAgentSkill {
				stats.AgentCalls++
			}
		case model.TaskConsumptionStatusReleased:
			stats.ReleasedCount++
		case model.TaskConsumptionStatusReserved:
			stats.ReservedCount++
		}
	}
	// FailedCount 不在仓储层推导：「已释放且原任务失败」需要关联任务状态，
	// 由 service 层统计。
	return stats
}

// consumptionDurationSec 从 params JSONB 取 duration_sec；缺失/非数按 0。
func consumptionDurationSec(params model.JSONB) int64 {
	if len(params) == 0 {
		return 0
	}
	var payload map[string]any
	if err := json.Unmarshal(params, &payload); err != nil {
		return 0
	}
	value, ok := payload["duration_sec"].(float64)
	if !ok || value <= 0 {
		return 0
	}
	return int64(value)
}

func (r *MemoryCreditRepository) GetConsumptionByJobID(jobID string) (model.TaskConsumption, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, consumption := range r.consumptions {
		if consumption.JobID == jobID {
			return consumption, nil
		}
	}
	return model.TaskConsumption{}, ErrConsumptionNotFound
}

func (r *MemoryCreditRepository) ListConsumptions(userID string, status string, page int, pageSize int) ([]model.TaskConsumption, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]model.TaskConsumption, 0)
	for _, consumption := range r.consumptions {
		if consumption.UserID != userID {
			continue
		}
		if status != "" && consumption.Status != status {
			continue
		}
		filtered = append(filtered, consumption)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
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
		return []model.TaskConsumption{}, total, nil
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[start:end], total, nil
}

func (r *MemoryCreditRepository) ListReservedConsumptions(limit int) ([]model.TaskConsumption, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.TaskConsumption, 0)
	for _, consumption := range r.consumptions {
		if consumption.Status == model.TaskConsumptionStatusReserved {
			result = append(result, consumption)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		return result[i].ID < result[j].ID
	})
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *MemoryCreditRepository) CreateGrantWithLedger(grant model.CreditGrant, entryType string, operatorID string, relatedOrderID string, now time.Time) (GrantOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if grant.PeriodKey == "" {
		grant.PeriodKey = "grant:" + randomRepositoryHex(12)
	}
	for _, existing := range r.grants {
		if existing.PeriodKey == grant.PeriodKey {
			return GrantOutcome{Grant: existing, Created: false}, nil
		}
	}
	if grant.ID == "" {
		grant.ID = "grant_" + randomRepositoryHex(12)
	}
	grant.CreatedAt = now
	r.grants[grant.ID] = grant

	account := r.ensureAccountLocked(grant.UserID, now)
	entry := model.CreditLedgerEntry{
		ID:                  "led_" + randomRepositoryHex(12),
		UserID:              grant.UserID,
		EntryType:           entryType,
		Amount:              grant.AmountTotal,
		Bucket:              model.CreditBucketGrant,
		GrantID:             grant.ID,
		PermanentAfter:      account.PermanentBalance,
		GrantRemainingAfter: grant.AmountRemaining,
		OrderID:             relatedOrderID,
		OperatorID:          operatorID,
		IdempotencyKey:      "grant:" + grant.PeriodKey,
		CreatedAt:           now,
	}
	r.ledger[entry.ID] = entry
	return GrantOutcome{Grant: grant, Created: true}, nil
}

func (r *MemoryCreditRepository) Reserve(input ReserveInput) (ReserveOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, existing := range r.consumptions {
		if existing.JobID == input.JobID {
			return ReserveOutcome{Consumption: existing, Duplicate: true}, nil
		}
	}

	account := r.ensureAccountLocked(input.UserID, input.Now)
	grants := make([]model.CreditGrant, 0)
	for _, grant := range r.grants {
		if grant.UserID == input.UserID && grant.Status == model.GrantStatusActive && grant.ExpiresAt.After(input.Now) {
			grants = append(grants, grant)
		}
	}
	sortGrantsFEFO(grants)

	var grantAvailable int64
	for _, grant := range grants {
		grantAvailable += grant.AmountRemaining - grant.AmountFrozen
	}
	permanentAvailable := account.PermanentBalance - account.PermanentFrozen
	if permanentAvailable < 0 {
		permanentAvailable = 0
	}
	if grantAvailable+permanentAvailable < input.Credits {
		return ReserveOutcome{}, ErrInsufficientCredits
	}

	allocation := make([]model.CreditAllocationItem, 0)
	remaining := input.Credits
	for _, grant := range grants {
		if remaining == 0 {
			break
		}
		spendable := grant.AmountRemaining - grant.AmountFrozen
		if spendable <= 0 {
			continue
		}
		take := spendable
		if take > remaining {
			take = remaining
		}
		grant.AmountFrozen += take
		r.grants[grant.ID] = grant
		allocation = append(allocation, model.CreditAllocationItem{Bucket: model.CreditBucketGrant, GrantID: grant.ID, Amount: take})
		remaining -= take
	}
	if remaining > 0 {
		account.PermanentFrozen += remaining
		allocation = append(allocation, model.CreditAllocationItem{Bucket: model.CreditBucketPermanent, Amount: remaining})
	}
	account.UpdatedAt = input.Now
	r.accounts[input.UserID] = account

	consumption := model.TaskConsumption{
		ID:            "cons_" + randomRepositoryHex(12),
		JobID:         input.JobID,
		UserID:        input.UserID,
		TaskType:      input.TaskType,
		Model:         input.Model,
		Params:        input.Params,
		CreditsQuoted: input.Credits,
		Allocation:    marshalAllocation(allocation),
		Status:        model.TaskConsumptionStatusReserved,
		CreatedAt:     input.Now,
	}
	r.consumptions[consumption.ID] = consumption
	return ReserveOutcome{Consumption: consumption}, nil
}

func (r *MemoryCreditRepository) Settle(jobID string, now time.Time) (SettleOutcome, error) {
	return r.settle(jobID, nil, now)
}

func (r *MemoryCreditRepository) SettleAmount(jobID string, credits int64, params model.JSONB, now time.Time) (SettleOutcome, error) {
	return r.settle(jobID, &creditSettlement{Credits: credits, Params: params}, now)
}

func (r *MemoryCreditRepository) settle(jobID string, settlement *creditSettlement, now time.Time) (SettleOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	consumption, found := r.findConsumptionByJobLocked(jobID)
	if !found {
		return SettleOutcome{}, ErrConsumptionNotFound
	}
	if consumption.Status != model.TaskConsumptionStatusReserved {
		return SettleOutcome{Consumption: consumption, Changed: false}, nil
	}
	charged, err := settlementCredits(consumption, settlement)
	if err != nil {
		return SettleOutcome{}, err
	}

	allocation, err := unmarshalAllocation(consumption.Allocation)
	if err != nil {
		return SettleOutcome{}, err
	}
	// Validate before mutating the in-memory repository, matching transaction
	// rollback semantics if one frozen grant is missing or malformed.
	if err := validateSettlementAllocation(allocation, consumption.CreditsQuoted); err != nil {
		return SettleOutcome{}, err
	}
	for _, item := range allocation {
		if item.Bucket == model.CreditBucketGrant {
			if _, ok := r.grants[item.GrantID]; !ok {
				return SettleOutcome{}, ErrCreditGrantNotFound
			}
		}
	}

	account := r.ensureAccountLocked(consumption.UserID, now)
	remainingCharge := charged
	// Grant buckets first, permanent last — keeps ledger snapshots ordered.
	for _, item := range allocation {
		if item.Bucket != model.CreditBucketGrant {
			continue
		}
		grant, ok := r.grants[item.GrantID]
		if !ok {
			return SettleOutcome{}, ErrCreditGrantNotFound
		}
		grant.AmountFrozen -= item.Amount
		take := min(item.Amount, remainingCharge)
		remainingCharge -= take
		grant.AmountRemaining -= take
		expired := grant.Status == model.GrantStatusExpired || !grant.ExpiresAt.After(now)
		if grant.AmountRemaining == 0 && grant.AmountFrozen == 0 {
			grant.Status = model.GrantStatusExhausted
		}
		if take > 0 {
			r.appendLedgerLocked(model.CreditLedgerEntry{
				UserID:              consumption.UserID,
				EntryType:           model.LedgerTypeConsume,
				Amount:              -take,
				Bucket:              model.CreditBucketGrant,
				GrantID:             grant.ID,
				PermanentAfter:      account.PermanentBalance,
				GrantRemainingAfter: grant.AmountRemaining,
				JobID:               jobID,
				OperatorID:          "system",
				IdempotencyKey:      "consume:" + jobID + ":grant:" + grant.ID,
				CreatedAt:           now,
			})
		}
		if released := item.Amount - take; expired && released > 0 {
			grant.AmountRemaining -= released
			r.appendLedgerLocked(model.CreditLedgerEntry{UserID: consumption.UserID, EntryType: model.LedgerTypeExpire, Amount: -released, Bucket: model.CreditBucketGrant, GrantID: grant.ID, PermanentAfter: account.PermanentBalance, GrantRemainingAfter: grant.AmountRemaining, JobID: jobID, OperatorID: "system", IdempotencyKey: "expire-settle:" + jobID + ":" + grant.ID, CreatedAt: now})
		}
		if expired && take < item.Amount && grant.AmountRemaining == 0 && grant.AmountFrozen == 0 {
			grant.Status = model.GrantStatusExpired
		}
		r.grants[grant.ID] = grant
	}
	for _, item := range allocation {
		if item.Bucket != model.CreditBucketPermanent {
			continue
		}
		account.PermanentFrozen -= item.Amount
		take := min(item.Amount, remainingCharge)
		remainingCharge -= take
		account.PermanentBalance -= take
		if take > 0 {
			r.appendLedgerLocked(model.CreditLedgerEntry{
				UserID:         consumption.UserID,
				EntryType:      model.LedgerTypeConsume,
				Amount:         -take,
				Bucket:         model.CreditBucketPermanent,
				PermanentAfter: account.PermanentBalance,
				JobID:          jobID,
				OperatorID:     "system",
				IdempotencyKey: "consume:" + jobID + ":permanent",
				CreatedAt:      now,
			})
		}
	}
	account.UpdatedAt = now
	r.accounts[consumption.UserID] = account

	consumption.Status = model.TaskConsumptionStatusSettled
	consumption.CreditsSettled = charged
	if settlement != nil {
		consumption.Params = settlement.Params
	}
	consumption.SettledAt = &now
	r.consumptions[consumption.ID] = consumption
	return SettleOutcome{Consumption: consumption, Changed: true}, nil
}

func (r *MemoryCreditRepository) Release(jobID string, now time.Time) (ReleaseOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	consumption, found := r.findConsumptionByJobLocked(jobID)
	if !found {
		return ReleaseOutcome{}, ErrConsumptionNotFound
	}
	if consumption.Status != model.TaskConsumptionStatusReserved {
		return ReleaseOutcome{Consumption: consumption, Changed: false}, nil
	}

	allocation, err := unmarshalAllocation(consumption.Allocation)
	if err != nil {
		return ReleaseOutcome{}, err
	}

	account := r.ensureAccountLocked(consumption.UserID, now)
	for _, item := range allocation {
		if item.Bucket == model.CreditBucketGrant {
			grant, ok := r.grants[item.GrantID]
			if !ok {
				return ReleaseOutcome{}, ErrCreditGrantNotFound
			}
			grant.AmountFrozen -= item.Amount
			if grant.Status == model.GrantStatusExpired || !grant.ExpiresAt.After(now) {
				grant.AmountRemaining -= item.Amount
				r.appendLedgerLocked(model.CreditLedgerEntry{UserID: grant.UserID, EntryType: model.LedgerTypeExpire, Amount: -item.Amount, Bucket: model.CreditBucketGrant, GrantID: grant.ID, JobID: jobID, PermanentAfter: account.PermanentBalance, GrantRemainingAfter: grant.AmountRemaining, OperatorID: "system", IdempotencyKey: "expire-release:" + jobID + ":" + grant.ID, CreatedAt: now})
			}
			// 冻结退回不改变 remaining；若批次已过期且不再有余量，标记过期。
			if grant.AmountRemaining == 0 && grant.AmountFrozen == 0 && grant.Status == model.GrantStatusActive && !grant.ExpiresAt.After(now) {
				grant.Status = model.GrantStatusExpired
			}
			r.grants[grant.ID] = grant
			continue
		}
		account.PermanentFrozen -= item.Amount
	}
	account.UpdatedAt = now
	r.accounts[consumption.UserID] = account

	consumption.Status = model.TaskConsumptionStatusReleased
	consumption.SettledAt = &now
	r.consumptions[consumption.ID] = consumption
	return ReleaseOutcome{Consumption: consumption, Changed: true}, nil
}

func (r *MemoryCreditRepository) ExpireGrant(grantID string, now time.Time) (ExpireOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	grant, ok := r.grants[grantID]
	if !ok {
		return ExpireOutcome{}, ErrCreditGrantNotFound
	}
	if grant.Status != model.GrantStatusActive {
		return ExpireOutcome{Grant: grant, AlreadyExpired: true}, nil
	}

	deductible := grant.AmountRemaining - grant.AmountFrozen
	if deductible > 0 {
		key := "expire:" + grant.ID
		for _, entry := range r.ledger {
			if entry.IdempotencyKey == key {
				return ExpireOutcome{Grant: grant, AlreadyExpired: true}, nil
			}
		}
		account := r.ensureAccountLocked(grant.UserID, now)
		grant.AmountRemaining = grant.AmountFrozen
		r.appendLedgerLocked(model.CreditLedgerEntry{
			UserID:              grant.UserID,
			EntryType:           model.LedgerTypeExpire,
			Amount:              -deductible,
			Bucket:              model.CreditBucketGrant,
			GrantID:             grant.ID,
			PermanentAfter:      account.PermanentBalance,
			GrantRemainingAfter: grant.AmountRemaining,
			OperatorID:          "system",
			IdempotencyKey:      key,
			CreatedAt:           now,
		})
	}
	// Even a fully frozen grant must remember that its remaining credit is void.
	grant.Status = model.GrantStatusExpired
	r.grants[grant.ID] = grant
	return ExpireOutcome{Grant: grant, Deducted: deductible}, nil
}

func (r *MemoryCreditRepository) AdjustPermanent(userID string, delta int64, entryType string, operatorID string, nonce string, now time.Time) (AdjustOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if nonce == "" {
		nonce = "adjust:" + randomRepositoryHex(12)
	}
	for _, entry := range r.ledger {
		if entry.IdempotencyKey == nonce {
			account := r.ensureAccountLocked(userID, now)
			return AdjustOutcome{Account: account, Applied: false}, nil
		}
	}

	account := r.ensureAccountLocked(userID, now)
	account.PermanentBalance += delta
	account.UpdatedAt = now
	r.accounts[userID] = account

	r.appendLedgerLocked(model.CreditLedgerEntry{
		UserID:         userID,
		EntryType:      entryType,
		Amount:         delta,
		Bucket:         model.CreditBucketPermanent,
		PermanentAfter: account.PermanentBalance,
		OperatorID:     operatorID,
		IdempotencyKey: nonce,
		CreatedAt:      now,
	})
	return AdjustOutcome{Account: account, Applied: true}, nil
}

func (r *MemoryCreditRepository) GetLedgerByIdempotencyKey(key string) (model.CreditLedgerEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, entry := range r.ledger {
		if entry.IdempotencyKey == key {
			return entry, nil
		}
	}
	return model.CreditLedgerEntry{}, ErrCreditLedgerNotFound
}

func (r *MemoryCreditRepository) DeductPermanentForRefund(userID string, credits int64, orderID string, now time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	key := "refund:" + orderID
	for _, entry := range r.ledger {
		if entry.IdempotencyKey == key {
			return false, nil
		}
	}

	account := r.ensureAccountLocked(userID, now)
	account.PermanentBalance -= credits
	account.UpdatedAt = now
	r.accounts[userID] = account

	r.appendLedgerLocked(model.CreditLedgerEntry{
		UserID:         userID,
		EntryType:      model.LedgerTypeRefundRollback,
		Amount:         -credits,
		Bucket:         model.CreditBucketPermanent,
		PermanentAfter: account.PermanentBalance,
		OrderID:        orderID,
		OperatorID:     "system",
		IdempotencyKey: key,
		CreatedAt:      now,
	})
	return true, nil
}

// TryAcquireSchedulerLock：Memory 模式单进程，始终获取成功。
func (r *MemoryCreditRepository) TryAcquireSchedulerLock(name string) (func(), bool, error) {
	return func() {}, true, nil
}

func (r *MemoryCreditRepository) findConsumptionByJobLocked(jobID string) (model.TaskConsumption, bool) {
	for _, consumption := range r.consumptions {
		if consumption.JobID == jobID {
			return consumption, true
		}
	}
	return model.TaskConsumption{}, false
}

func (r *MemoryCreditRepository) appendLedgerLocked(entry model.CreditLedgerEntry) {
	if entry.ID == "" {
		entry.ID = "led_" + randomRepositoryHex(12)
	}
	r.ledger[entry.ID] = entry
}

// marshalAllocation / unmarshalAllocation convert the freeze-time allocation
// snapshot. Shared by the Memory and Gorm implementations so both persist
// byte-identical JSONB.
func marshalAllocation(allocation []model.CreditAllocationItem) model.JSONB {
	if allocation == nil {
		allocation = []model.CreditAllocationItem{}
	}
	raw, err := json.Marshal(allocation)
	if err != nil {
		return model.JSONB("[]")
	}
	return model.JSONB(raw)
}

func unmarshalAllocation(raw model.JSONB) ([]model.CreditAllocationItem, error) {
	if len(raw) == 0 {
		return []model.CreditAllocationItem{}, nil
	}
	allocation := make([]model.CreditAllocationItem, 0)
	if err := json.Unmarshal(raw, &allocation); err != nil {
		return nil, err
	}
	return allocation, nil
}
