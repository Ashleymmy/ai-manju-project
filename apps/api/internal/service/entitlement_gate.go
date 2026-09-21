package service

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Entitlement gate errors.
var (
	// ErrConcurrencyLimitExceeded 用户维度并发上限（会员权益：更高并发）。
	ErrConcurrencyLimitExceeded = repository.ErrJobConcurrencyLimit
	// ErrAgentRequiresMember Agent 模式仅会员可用（文档：agent模式解锁且免费使用，非会员不开相关功能）。
	ErrAgentRequiresMember = errors.New("agent mode requires an active membership")
	// ErrMemberFeatureRequired 会员特权功能（去水印/商用授权/素材库等）。
	ErrMemberFeatureRequired = errors.New("this feature requires an active membership")
)

// EntitlementGate 会员权益门禁（WP-M6）。并发上限在任务**准入**侧执行
// （Enqueue 前计数拒绝），不动 worker 的 provider 级 Lua 闸门——两层互不干扰：
// provider 闸门保护上游，准入闸门实现会员权益。
type EntitlementGate struct {
	memberships repository.MembershipRepository
	jobs        repository.JobRepository
	clock       func() time.Time
}

func NewEntitlementGate(memberships repository.MembershipRepository, jobs repository.JobRepository) *EntitlementGate {
	return &EntitlementGate{
		memberships: memberships, jobs: jobs,
		clock: func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (g *EntitlementGate) SetClock(clock func() time.Time) {
	if clock != nil {
		g.clock = clock
	}
}

// activePlan 返回用户当前有效会员的套餐；非会员返回 (nil, nil)。
func (g *EntitlementGate) activePlan(userID string) (*model.MembershipPlan, error) {
	membership, err := g.memberships.GetActiveMembership(userID, g.clock())
	if err != nil {
		if errors.Is(err, repository.ErrMembershipNotFound) {
			return nil, nil
		}
		return nil, err
	}
	plan, err := g.memberships.GetPlanByID(membership.PlanID)
	if err != nil {
		return nil, err
	}
	return &plan, nil
}

// ImageConcurrency / VideoConcurrency 返回用户的图片/视频并发上限。
func (g *EntitlementGate) ImageConcurrency(userID string) (int, error) {
	plan, err := g.activePlan(userID)
	if err != nil || plan == nil {
		return model.FreeImageConcurrency, err
	}
	return plan.ImageConcurrency, nil
}

func (g *EntitlementGate) VideoConcurrency(userID string) (int, error) {
	plan, err := g.activePlan(userID)
	if err != nil || plan == nil {
		return model.FreeVideoConcurrency, err
	}
	return plan.VideoConcurrency, nil
}

// CheckAdmission 准入检查：用户当前排队+运行中的同能力任务数达到上限则拒绝。
// jobType → 能力桶：image.* → 图片并发，video.generate → 视频并发。
func (g *EntitlementGate) CheckAdmission(userID string, jobType string) error {
	var types []string
	var limit int
	var err error
	switch {
	case jobType == model.JobTypeImageGenerate || jobType == model.JobTypeImageEdit:
		types = []string{model.JobTypeImageGenerate, model.JobTypeImageEdit}
		limit, err = g.ImageConcurrency(userID)
	case jobType == model.JobTypeVideoGenerate:
		types = []string{model.JobTypeVideoGenerate}
		limit, err = g.VideoConcurrency(userID)
	default:
		return nil // 转码等非计费类型不设准入
	}
	if err != nil {
		return err
	}
	active, err := g.jobs.CountActiveByUserAndTypes(userID, types)
	if err != nil {
		return err
	}
	if active >= int64(limit) {
		return ErrConcurrencyLimitExceeded
	}
	return nil
}

// AgentAccess Agent 模式仅会员可用。
func (g *EntitlementGate) AgentAccess(userID string) error {
	plan, err := g.activePlan(userID)
	if err != nil {
		return err
	}
	if plan == nil {
		return ErrAgentRequiresMember
	}
	return nil
}

// FeatureEnabled 检查套餐 features JSONB 中的开关（remove_watermark /
// commercial / agent_free 等）。非会员一律 false。
func (g *EntitlementGate) FeatureEnabled(userID string, feature string) (bool, error) {
	plan, err := g.activePlan(userID)
	if err != nil || plan == nil {
		return false, err
	}
	var features map[string]any
	if len(plan.Features) > 0 {
		if err := json.Unmarshal(plan.Features, &features); err != nil {
			return false, nil
		}
	}
	enabled, _ := features[feature].(bool)
	return enabled, nil
}
