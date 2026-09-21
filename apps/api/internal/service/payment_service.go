package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Payment service errors.
var (
	ErrPayChannelUnavailable = errors.New("payment channel is not configured")
	ErrOrderNotPending       = errors.New("order is not pending")
	ErrBillingItemNotFound   = errors.New("billing item not found")
)

// 会员周期：月付 30 天（与积分月发周期对齐），年付 365 天。
const (
	MembershipMonthlyPeriodDays = 30
	MembershipYearlyPeriodDays  = 365
)

// PaymentChannel 支付渠道抽象。真实渠道（支付宝/微信）需要商户凭证与回调验签，
// 属部署期接入；mock 渠道供开发/测试闭环，生产环境拒绝注册。
type PaymentChannel interface {
	Name() string
	// CreatePayment returns channel-specific pay params for the client.
	CreatePayment(order model.Order) (model.JSONB, error)
}

// MockPaymentChannel immediately produces a paid result in non-production
// environments, letting the full 下单→支付→履约 loop run without商户凭证。
type MockPaymentChannel struct{}

func (MockPaymentChannel) Name() string { return "mock" }

func (MockPaymentChannel) CreatePayment(order model.Order) (model.JSONB, error) {
	return model.JSONB(`{"mock":true,"order_id":"` + order.ID + `"}`), nil
}

// unconfiguredChannel 是支付宝/微信在商户凭证缺失时的占位实现。
type unconfiguredChannel struct{ name string }

func (c unconfiguredChannel) Name() string { return c.name }

func (c unconfiguredChannel) CreatePayment(model.Order) (model.JSONB, error) {
	return nil, ErrPayChannelUnavailable
}

// PaymentService drives the order state machine and fulfillment (WP-M8)。
// 履约顺序：订单置 paid（守卫迁移）→ 发货（积分/会员，各自幂等）→ 邀请首充奖励。
// 每步幂等，崩溃后重放 MarkPaid 安全。
type PaymentService struct {
	billing     repository.BillingRepository
	memberships repository.MembershipRepository
	engine      *CreditLedgerService
	invites     *InviteService
	channels    map[string]PaymentChannel
	clock       func() time.Time
}

func NewPaymentService(billing repository.BillingRepository, memberships repository.MembershipRepository, engine *CreditLedgerService, invites *InviteService, allowMockChannel bool) *PaymentService {
	channels := map[string]PaymentChannel{
		model.PayChannelAlipay:  unconfiguredChannel{name: model.PayChannelAlipay},
		model.PayChannelWechat:  unconfiguredChannel{name: model.PayChannelWechat},
		model.PayChannelBalance: unconfiguredChannel{name: model.PayChannelBalance},
	}
	if allowMockChannel {
		channels["mock"] = MockPaymentChannel{}
	}
	return &PaymentService{
		billing: billing, memberships: memberships, engine: engine, invites: invites,
		channels: channels,
		clock:    func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (s *PaymentService) SetClock(clock func() time.Time) {
	if clock != nil {
		s.clock = clock
	}
}

func (s *PaymentService) now() time.Time { return s.clock() }

// RegisterChannel swaps in a real channel implementation (部署期接入支付宝/微信).
func (s *PaymentService) RegisterChannel(channel PaymentChannel) {
	s.channels[channel.Name()] = channel
}

// CreateOrderInput 下单输入：套餐（会员）或直购包二选一。
type CreateOrderInput struct {
	UserID     string
	PlanID     string // 会员档
	PackageID  string // 直购积分包
	Period     string // month / year（仅会员单）
	PayChannel string
}

// CreateOrder 创建订单。会员购直购包享套餐折扣（文档：会员购买积分享有对应折扣）。
func (s *PaymentService) CreateOrder(input CreateOrderInput) (model.Order, model.JSONB, error) {
	channel, ok := s.channels[input.PayChannel]
	if !ok {
		return model.Order{}, nil, ErrPayChannelUnavailable
	}

	now := s.now()
	order := model.Order{
		UserID: input.UserID, PayChannel: input.PayChannel,
		Status: model.OrderStatusPending, Currency: "CNY",
		CreatedAt: now, UpdatedAt: now,
	}

	switch {
	case input.PlanID != "":
		plan, err := s.memberships.GetPlanByID(input.PlanID)
		if err != nil {
			return model.Order{}, nil, ErrBillingItemNotFound
		}
		if !plan.Enabled || plan.Code == model.PlanCodeInternal {
			return model.Order{}, nil, ErrBillingItemNotFound
		}
		order.PlanID = plan.ID
		switch input.Period {
		case "year":
			if plan.PriceYearCents <= 0 {
				return model.Order{}, nil, fmt.Errorf("plan %s does not offer yearly billing", plan.Code)
			}
			order.OrderType = model.OrderTypeMemberYearly
			order.AmountCents = plan.PriceYearCents
		default:
			order.OrderType = model.OrderTypeMemberMonthly
			order.AmountCents = plan.PriceMonthCents
		}
	case input.PackageID != "":
		pkg, err := s.billing.GetPackageByID(input.PackageID)
		if err != nil {
			return model.Order{}, nil, ErrBillingItemNotFound
		}
		if !pkg.Enabled {
			return model.Order{}, nil, ErrBillingItemNotFound
		}
		order.OrderType = model.OrderTypeCreditPack
		order.PackageID = pkg.ID
		order.AmountCents = pkg.PriceCents
		// 会员购积分折扣（基点：8000 = 8 折）。
		if membership, err := s.memberships.GetActiveMembership(input.UserID, now); err == nil {
			if plan, err := s.memberships.GetPlanByID(membership.PlanID); err == nil && plan.CreditDiscountBps > 0 && plan.CreditDiscountBps < 10000 {
				order.AmountCents = pkg.PriceCents * int64(plan.CreditDiscountBps) / 10000
			}
		}
	default:
		return model.Order{}, nil, fmt.Errorf("plan_id or package_id is required")
	}

	created, err := s.billing.CreateOrder(order)
	if err != nil {
		return model.Order{}, nil, err
	}
	payParams, err := channel.CreatePayment(created)
	if err != nil {
		return model.Order{}, nil, err
	}
	return created, payParams, nil
}

// MarkPaid 支付完成（渠道回调/ mock）。守卫迁移保证重复回调幂等；
// 履约失败会返回错误，渠道应重试回调。
func (s *PaymentService) MarkPaid(orderID string) (model.Order, error) {
	order, err := s.billing.GetOrderByID(orderID)
	if err != nil {
		return model.Order{}, err
	}
	if order.Status == model.OrderStatusPaid {
		return order, nil // 幂等重放
	}
	if order.Status != model.OrderStatusPending {
		return model.Order{}, ErrOrderNotPending
	}

	updated, changed, err := s.billing.UpdateOrderStatus(orderID, model.OrderStatusPending, model.OrderStatusPaid, s.now())
	if err != nil {
		return model.Order{}, err
	}
	if !changed {
		return s.billing.GetOrderByID(orderID) // 并发已被其他回调处理
	}
	if err := s.fulfill(updated); err != nil {
		return model.Order{}, err
	}
	return updated, nil
}

// fulfill 发货。积分包→永久积分（recharge 流水，幂等键=订单）；
// 会员→开通周期 + 立即发放首期月积分 + 邀请首充奖励。
func (s *PaymentService) fulfill(order model.Order) error {
	now := s.now()
	switch order.OrderType {
	case model.OrderTypeCreditPack:
		pkg, err := s.billing.GetPackageByID(order.PackageID)
		if err != nil {
			return err
		}
		if _, err := s.engine.RechargePermanent(order.UserID, pkg.Credits, order.ID); err != nil {
			return err
		}
	case model.OrderTypeMemberMonthly, model.OrderTypeMemberYearly:
		plan, err := s.memberships.GetPlanByID(order.PlanID)
		if err != nil {
			return err
		}
		periodDays := MembershipMonthlyPeriodDays
		if order.OrderType == model.OrderTypeMemberYearly {
			periodDays = MembershipYearlyPeriodDays
		}
		// Queue future terms without taking away the current membership.
		membership, err := s.memberships.ScheduleMembership(model.UserMembership{
			UserID: order.UserID, PlanID: plan.ID, Status: model.MembershipStatusActive,
			Source: model.MembershipSourcePurchase, OrderID: order.ID,
			CreatedAt: now, UpdatedAt: now,
		}, time.Duration(periodDays)*24*time.Hour, now)
		if err != nil {
			return err
		}
		// 首期月积分立即发放（不必等调度器下个 tick）。
		if _, err := s.engine.GrantMonthlyMembershipCredits(membership, plan); err != nil {
			return err
		}
	}

	// 邀请首充奖励（未绑定邀请的用户此调用为空操作）。
	if s.invites != nil {
		if _, err := s.invites.OnFirstPaidOrder(order.UserID); err != nil {
			return err
		}
	}
	return nil
}

// CancelOrder 用户主动关闭待支付订单。守卫迁移 pending→closed。
func (s *PaymentService) CancelOrder(orderID string, userID string) (model.Order, error) {
	order, err := s.billing.GetOrderByID(orderID)
	if err != nil {
		return model.Order{}, err
	}
	if order.UserID != userID {
		return model.Order{}, repository.ErrOrderNotFound
	}
	if order.Status == model.OrderStatusClosed {
		return order, nil
	}
	if order.Status != model.OrderStatusPending {
		return model.Order{}, ErrOrderNotPending
	}
	updated, _, err := s.billing.UpdateOrderStatus(orderID, model.OrderStatusPending, model.OrderStatusClosed, s.now())
	return updated, err
}
