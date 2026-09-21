package service

import (
	"errors"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// SeedMembershipDefaults 启动播种（WP-M1 数据初始化）：两个已定稿付费档 +
// 计费配置默认值。仅插入缺失项，不覆盖运营已保存的配置。
//
// 注意：¥1980 档的权益数值（月积分/并发/折扣）是待运营确认的占位种子，
// 以「套餐配置管理」后台为最终事实源——文档要求定价运行时可配、严禁硬编码，
// 这里的种子只是首次启动的初值。
func SeedMembershipDefaults(memberships repository.MembershipRepository, billing repository.BillingRepository) error {
	plans := []model.MembershipPlan{
		{Code: model.PlanCodeInternal, Name: "内部成员（测试用户）", MonthlyCredits: 0,
			ImageConcurrency: model.FreeImageConcurrency, VideoConcurrency: model.FreeVideoConcurrency,
			CreditDiscountBps: 10000, Features: model.JSONB(`{}`), Enabled: false},
		{
			Code: model.PlanCodeMember198, Name: "198 会员",
			PriceMonthCents: 19800, PriceYearCents: 198000, // 年付 = 10 个月价（运营可调）
			MonthlyCredits:   19800,
			ImageConcurrency: 4, VideoConcurrency: 2, CreditDiscountBps: 8000, PriorityRank: 1,
			Features: model.JSONB(`{"remove_watermark":true,"commercial":true,"agent_free":true}`),
			Enabled:  true,
		},
		{
			Code: model.PlanCodeMember1980, Name: "1980 会员",
			PriceMonthCents: 198000, PriceYearCents: 1980000, // 年付 = 10 个月价
			MonthlyCredits:   198000, // 按 1 元=100 积分平价；权益待运营录入调整
			ImageConcurrency: 12, VideoConcurrency: 8, CreditDiscountBps: 7000, PriorityRank: 2,
			Features: model.JSONB(`{"remove_watermark":true,"commercial":true,"agent_free":true,"priority_queue":true}`),
			Enabled:  true,
		},
	}
	if err := memberships.SeedPlans(plans); err != nil {
		return err
	}

	packages := []model.CreditPackage{
		{ID: "pkg_600", Name: "小额体验包", Credits: 600, PriceCents: 600, SortOrder: 1, Enabled: true},
		{ID: "pkg_3000", Name: "小套餐", Credits: 3000, PriceCents: 3000, SortOrder: 2, Enabled: true},
		{ID: "pkg_9800", Name: "标准包", Credits: 9800, PriceCents: 9800, SortOrder: 3, Enabled: true},
		{ID: "pkg_19800", Name: "进阶包", Credits: 19800, PriceCents: 19800, SortOrder: 4, Enabled: true},
		{ID: "pkg_32800", Name: "大套餐", Credits: 32800, PriceCents: 32800, SortOrder: 5, Enabled: true},
		{ID: "pkg_64800", Name: "企业大包", Credits: 64800, PriceCents: 64800, SortOrder: 6, Enabled: true},
	}
	for _, pkg := range packages {
		if _, err := billing.GetPackageByID(pkg.ID); err == nil {
			continue
		} else if !errors.Is(err, repository.ErrPackageNotFound) {
			return err
		}
		if _, err := billing.UpsertPackage(pkg); err != nil {
			return err
		}
	}

	now := time.Now().UTC()
	// pricing_rules 种子：价格档位（与定价器默认值一致）+ 定价规则页展示行
	// （display_rows 仅供前端渲染，定价器读取时忽略未知键，互不影响）。
	defaults := map[string]model.JSONB{
		model.BillingConfigKeyRegisterBonus:    model.JSONB(`1000`),
		model.BillingConfigKeyRegisterBonusTTL: model.JSONB(`31`),
		model.BillingConfigKeyInviteRewards:    model.JSONB(`{"inviter":2000,"invitee":500,"first_charge_bonus":1000}`),
		model.BillingConfigKeyInviteRewardTTL:  model.JSONB(`30`),
		model.BillingConfigKeyActivity:         model.JSONB(`{"enabled":false,"discount_bps":10000,"applies_to":[]}`),
		model.BillingConfigKeyGiftPacks:        model.JSONB(`[]`), // WP-M15 礼包超市：默认空货架，内容运营后定
		model.BillingConfigKeyPricingRules: model.JSONB(`{
			"image": {"small_512":20, "standard_1024":50, "large":80},
			"video_fast": {"per_second": 8},
			"video_standard": {"per_second": 12},
			"agent_skill": {"per_call": 30},
			"display_rows": {
				"image": [
					{"name":"普通漫剧图","spec":"512×512","credits":20},
					{"name":"高清漫剧图","spec":"1024×1024","credits":50},
					{"name":"角色多视角图","spec":"1024×1024","credits":80},
					{"name":"风格迁移","spec":"1024×1024","credits":40}
				],
				"video": [
					{"name":"漫剧 Fast 快速渲染","spec":"720P/1080P","credits_per_second":8},
					{"name":"漫剧标准版","spec":"720P/1080P","credits_per_second":12}
				],
				"agent": [
					{"name":"智能剧本创作","credits":0,"note":"免费使用"},
					{"name":"漫剧导演 Agent 生成分镜节点树","credits":30},
					{"name":"剧本直出美术资产提示词","credits":20},
					{"name":"角色音色定制","credits":15,"note":"每个角色"},
					{"name":"一键导入剪映/剪映精剪/成品输出","credits":0,"note":"免费使用"}
				]
			}
		}`),
	}
	for key, value := range defaults {
		// 只在缺省时播种，不覆盖运营已改的配置。
		if _, err := billing.GetConfig(key); err == nil {
			continue
		}
		if err := billing.UpsertConfig(key, value, "system", now); err != nil {
			return err
		}
	}
	return nil
}
