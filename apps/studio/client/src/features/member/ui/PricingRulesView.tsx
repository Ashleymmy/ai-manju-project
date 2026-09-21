import { ModelPricingTable } from "./ModelPricingTable";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  DEFAULT_PRICING,
  FREE_TIER,
  MEMBER_GRANT_TTL_DAYS,
  REGISTER_BONUS_CREDITS,
} from "../model/constants";
import { discountLabel, formatCents, formatCredits } from "../model/format";
import type { MemberPricing } from "../model/types";
import { ErrorBlock, LoadingBlock } from "./components/memberBits";

/** 基础积分规则（image18/19 权威口径 + 2026-09-17 定稿：新用户赠 1000）。 */
const BASE_RULES = [
  "1 元 = 100 积分",
  `会员赠送积分每月发放，${MEMBER_GRANT_TTL_DAYS} 天有效期，到期自动清零`,
  "现金直购积分永久有效，不清零，可叠加",
  `新用户注册即赠 ${formatCredits(REGISTER_BONUS_CREDITS)} 体验积分`,
  "活动赠送积分有效期由活动配置决定（如 30、90 天）",
  "只有生成成功才扣积分，失败/报错/取消不扣费；扣费时优先扣除限时积分，耗尽后扣永久积分",
] as const;

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="member-card member-rules">
      <p className="eyebrow">{title}</p>
      {children}
    </section>
  );
}

/** 定价规则页（/member/pricing）：规则 6 条 + 单价表 + 套餐对比表。 */
export function PricingRulesView({ pricingQuery }: { pricingQuery: UseQueryResult<MemberPricing, Error> }) {
  if (pricingQuery.isPending) return <LoadingBlock text="正在读取定价规则…" />;
  if (pricingQuery.isError) return <ErrorBlock onRetry={() => void pricingQuery.refetch()} />;
  const pricing = pricingQuery.data;
  if (!pricing) return <LoadingBlock />;

  const plans = (pricing.plans || []).filter(plan => plan.enabled);
  const creditsPerYuan = pricing.credits_per_yuan || 100;

  return (
    <div className="member-stack">
      <RuleSection title="基础积分规则">
        <ol className="member-rule-list">
          {BASE_RULES.map(rule => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </RuleSection>

      <RuleSection title="模型积分价目表">
        <ModelPricingTable prices={pricing.model_prices} />
      </RuleSection>

      <RuleSection title="Agent / 技能调用（按次计费）">
        <div className="member-table">
          <div className="member-table-head member-price-row">
            <span>技能功能</span>
            <span>说明</span>
            <span>消耗</span>
          </div>
          {[
            ["智能剧本创作", "剧本生成与润色", "免费使用"],
            ["漫剧导演 Agent 生成分镜节点树", "每次调用", "免费"],
            ["剧本直出美术资产提示词", "每次调用", "免费"],
            ["角色音色定制", "每个角色", `${formatCredits(DEFAULT_PRICING.agentVoice)} / 次`],
            ["一键导入剪映 / 剪映精剪 / 成品输出", "导出能力", "免费使用"],
          ].map(([name, spec, price]) => (
            <div key={String(name)} className="member-table-row member-price-row">
              <span>{name}</span>
              <span>{spec}</span>
              <span className="member-cell-num">{price}</span>
            </div>
          ))}
        </div>
      </RuleSection>

      <RuleSection title="会员订阅套餐对比">
        <div className="member-table member-compare-table" role="table">
          <div
            className="member-table-head member-compare-row"
            style={{ gridTemplateColumns: `minmax(90px, 1fr) repeat(${plans.length + 1}, minmax(110px, 1fr))` }}
          >
            <span>权益</span>
            <span>{FREE_TIER.name}</span>
            {plans.map(plan => (
              <span key={plan.id}>{plan.name}</span>
            ))}
          </div>
          {(
            [
              ["月付价格", "免费", ...plans.map(plan => formatCents(plan.price_month_cents))],
              [
                "年付价格",
                "免费",
                ...plans.map(plan => (plan.price_year_cents > 0 ? formatCents(plan.price_year_cents) : "未开通")),
              ],
              ["每月赠送积分", "—", ...plans.map(plan => formatCredits(plan.monthly_credits))],
              ["积分有效期", "—", ...plans.map(() => `${MEMBER_GRANT_TTL_DAYS} 天`)],
              ["图片并发数", String(FREE_TIER.imageConcurrency), ...plans.map(plan => String(plan.image_concurrency))],
              ["视频并发数", String(FREE_TIER.videoConcurrency), ...plans.map(plan => String(plan.video_concurrency))],
              ["购积分折扣", "无", ...plans.map(plan => discountLabel(plan.credit_discount_bps))],
            ] as string[][]
          ).map(row => (
            <div
              key={row[0]}
              className="member-table-row member-compare-row"
              style={{ gridTemplateColumns: `minmax(90px, 1fr) repeat(${plans.length + 1}, minmax(110px, 1fr))` }}
            >
              {row.map((cell, index) => (
                <span key={index}>{cell}</span>
              ))}
            </div>
          ))}
        </div>
        <p className="member-tip">直购积分基准汇率：1 元 = {formatCredits(creditsPerYuan)} 积分，会员购积分按套餐折扣实时计算。</p>
      </RuleSection>
    </div>
  );
}
