package service

import (
	"errors"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// AdminMemberService 聚合后台会员管理（模块1）与运营数据看板（模块6）所需的
// 跨表视图。它不拥有任何新状态，只组合现有仓储。
type AdminMemberService struct {
	users       repository.UserRepository
	memberships repository.MembershipRepository
	credits     repository.CreditRepository
	billing     repository.BillingRepository
	clock       func() time.Time
}

func NewAdminMemberService(users repository.UserRepository, memberships repository.MembershipRepository, credits repository.CreditRepository, billing repository.BillingRepository) *AdminMemberService {
	return &AdminMemberService{
		users: users, memberships: memberships, credits: credits, billing: billing,
		clock: func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (s *AdminMemberService) SetClock(clock func() time.Time) {
	if clock != nil {
		s.clock = clock
	}
}

// AdminMemberUserRow 对应模块1 列表行：用户 ID/账号/昵称/会员等级/会员到期/
// 账号状态/永久积分/限时积分/注册时间/最后登录/累计充值。
type AdminMemberUserRow struct {
	Role               string     `json:"role"`
	MembershipID       string     `json:"membership_id"`
	PlanID             string     `json:"plan_id"`
	PlanCode           string     `json:"plan_code"`
	TestCredits        *int64     `json:"test_credits,omitempty"`
	UserID             string     `json:"user_id"`
	Username           string     `json:"username"`
	DisplayName        string     `json:"display_name"`
	MemberLevel        string     `json:"member_level"` // 套餐名；非会员为 ""
	MemberExpiresAt    *time.Time `json:"member_expires_at"`
	Status             string     `json:"status"`
	PermanentBalance   int64      `json:"permanent_balance"`
	LimitedBalance     int64      `json:"limited_balance"`
	RegisteredAt       time.Time  `json:"registered_at"`
	LastLoginAt        *time.Time `json:"last_login_at"`
	TotalRechargeCents int64      `json:"total_recharge_cents"`
}

// ListMemberUsers composes the admin member list. 规模为当前量级设计：
// 用户表全量读入后内存分页；会员/账户聚合成 map 一次查询。
type AdminMemberFilter struct{ Search, Level, Status string }

func (s *AdminMemberService) GetUser(id string) (model.User, error) { return s.users.GetUser(id) }

func (s *AdminMemberService) ListMemberUsers(page int, pageSize int, filters ...AdminMemberFilter) ([]AdminMemberUserRow, int64, error) {
	if page < 1 {
		page = 1
	}
	users, err := s.users.ListUsers()
	if err != nil {
		return nil, 0, err
	}
	filter := AdminMemberFilter{}
	if len(filters) > 0 {
		filter = filters[0]
	}

	// 活跃会员一次取出，按 user_id 索引。
	activeMemberships, err := s.memberships.ListActiveMemberships(0, 0)
	if err != nil {
		return nil, 0, err
	}
	planNames := map[string]string{}
	planCodes := map[string]string{}
	plans, err := s.memberships.ListPlans(false)
	if err != nil {
		return nil, 0, err
	}
	for _, plan := range plans {
		planNames[plan.ID] = plan.Name
		planCodes[plan.ID] = plan.Code
	}
	membershipByUser := map[string]model.UserMembership{}
	now := s.clock()
	for _, membership := range activeMemberships {
		membershipByUser[membership.UserID] = membership
	}
	filtered := make([]model.User, 0, len(users))
	for _, user := range users {
		m, has := membershipByUser[user.ID]
		active := has && !m.StartedAt.After(now) && m.ExpiresAt.After(now)
		code := "free"
		if active {
			code = planCodes[m.PlanID]
		}
		if filter.Status != "" && user.Status != filter.Status {
			continue
		}
		if filter.Level == "member" {
			if !active || code == model.PlanCodeInternal {
				continue
			}
		} else if filter.Level != "" && filter.Level != code {
			continue
		}
		if filter.Search != "" && !strings.Contains(strings.ToLower(user.ID+" "+user.Username+" "+user.DisplayName), strings.ToLower(filter.Search)) {
			continue
		}
		filtered = append(filtered, user)
	}
	users = filtered
	total := int64(len(users))

	start := (page - 1) * pageSize
	if start >= len(users) {
		return []AdminMemberUserRow{}, total, nil
	}
	end := start + pageSize
	if end > len(users) {
		end = len(users)
	}

	rows := make([]AdminMemberUserRow, 0, end-start)
	for _, user := range users[start:end] {
		row := AdminMemberUserRow{
			Role:   user.Role,
			UserID: user.ID, Username: user.Username, DisplayName: user.DisplayName,
			Status: user.Status, RegisteredAt: user.CreatedAt, LastLoginAt: user.LastLoginAt,
		}
		if membership, ok := membershipByUser[user.ID]; ok {
			row.MembershipID = membership.ID
			if membership.ExpiresAt.After(now) && !membership.StartedAt.After(now) {
				row.MemberLevel = planNames[membership.PlanID]
				row.PlanID, row.PlanCode, row.TestCredits = membership.PlanID, planCodes[membership.PlanID], membership.MonthlyCreditsOverride
				expires := membership.ExpiresAt
				row.MemberExpiresAt = &expires
			}
		}
		if account, err := s.credits.GetAccount(user.ID); err == nil {
			row.PermanentBalance = account.PermanentBalance
		} else if !errors.Is(err, repository.ErrCreditAccountNotFound) {
			return nil, 0, err
		}
		if grants, err := s.credits.ListActiveGrants(user.ID, now); err == nil {
			for _, grant := range grants {
				row.LimitedBalance += grant.AmountRemaining - grant.AmountFrozen
			}
		} else {
			return nil, 0, err
		}
		if sum, err := s.billing.SumPaidAmountByUser(user.ID); err == nil {
			row.TotalRechargeCents = sum
		} else {
			return nil, 0, err
		}
		rows = append(rows, row)
	}
	return rows, total, nil
}

// AdminDashboard 对应模块6 核心指标卡片。
type AdminDashboard struct {
	TotalUsers           int64 `json:"total_users"`
	PaidUsers            int64 `json:"paid_users"`
	GmvTodayCents        int64 `json:"gmv_today_cents"`
	GmvMonthCents        int64 `json:"gmv_month_cents"`
	CreditsConsumedToday int64 `json:"credits_consumed_today"`
	ImageGenerationTotal int64 `json:"image_generation_total"`
	VideoSecondsTotal    int64 `json:"video_seconds_total"`
}

// Dashboard aggregates the KPI cards. 日的边界按 UTC 自然日；如需本地时区
// 报表，由上层传入换算后的 clock。
func (s *AdminMemberService) Dashboard() (AdminDashboard, error) {
	now := s.clock()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var dashboard AdminDashboard
	var err error
	if dashboard.TotalUsers, err = s.users.CountUsers(); err != nil {
		return dashboard, err
	}
	if dashboard.PaidUsers, err = s.billing.CountDistinctPaidUsers(); err != nil {
		return dashboard, err
	}
	if dashboard.GmvTodayCents, err = s.billing.SumPaidAmount(dayStart, time.Time{}); err != nil {
		return dashboard, err
	}
	if dashboard.GmvMonthCents, err = s.billing.SumPaidAmount(monthStart, time.Time{}); err != nil {
		return dashboard, err
	}
	if dashboard.CreditsConsumedToday, err = s.credits.SumConsumedCredits(dayStart, time.Time{}); err != nil {
		return dashboard, err
	}
	stats, err := s.credits.ConsumptionStats("")
	if err != nil {
		return dashboard, err
	}
	dashboard.ImageGenerationTotal = stats.ImageCount
	dashboard.VideoSecondsTotal = stats.VideoSeconds
	return dashboard, nil
}
