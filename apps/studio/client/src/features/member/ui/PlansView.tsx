import { BadgeCheck, CreditCard, Crown, Flame, Loader2 } from "lucide-react";
import { Link } from "wouter";

import {
  DISCOUNT_BPS_FULL,
  FREE_TIER,
  PAY_CHANNELS,
  RECHARGE_PRESETS,
  RECHARGE_SLIDER_MAX,
  RECHARGE_SLIDER_MIN,
  RECHARGE_SLIDER_STEP,
} from "../model/constants";
import {
  discountLabel,
  discountedCents,
  effectiveCreditsPerYuan,
  formatCents,
  formatCredits,
} from "../model/format";
import type { PlansController } from "../controllers/usePlansController";
import { CountdownBanner, EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from "./components/memberBits";

/** 套餐购买页（/member/plans）：订阅 + 直购积分 + 活动倒计时。 */
export function PlansView({ controller }: { controller: PlansController }) {
  if (controller.isPending) return <LoadingBlock text="正在读取套餐与定价…" />;
  if (controller.isError) return <ErrorBlock onRetry={controller.reload} />;

  const memberDiscounted = controller.memberDiscountBps < DISCOUNT_BPS_FULL;
  const effectiveRate = effectiveCreditsPerYuan(controller.creditsPerYuan, controller.memberDiscountBps);
  const anyChannelEnabled = PAY_CHANNELS.some(item => item.enabled);

  return (
    <div className="member-stack">
      <CountdownBanner activity={controller.activity} nowMs={controller.nowMs} />

      {/* 订阅套餐 */}
      <section>
        <div className="member-section-head">
          <h3>订阅套餐</h3>
          <div className="segmented">
            <button
              type="button"
              className={controller.period === "month" ? "selected" : ""}
              onClick={() => controller.setPeriod("month")}
            >
              月付
            </button>
            <button
              type="button"
              className={controller.period === "year" ? "selected" : ""}
              onClick={() => controller.setPeriod("year")}
            >
              年付
            </button>
          </div>
        </div>
        {controller.plans.length === 0 ? (
          <EmptyBlock text="暂无可订阅套餐" hint="运营尚未上架会员档位" />
        ) : (
          <div className="member-plan-grid">
            {/* 免费态说明卡（不可购买） */}
            <article className="member-card member-plan is-free">
              <p className="eyebrow">{FREE_TIER.name}</p>
              <h4>¥0</h4>
              <ul>
                <li>图片并发 ×{FREE_TIER.imageConcurrency} · 视频并发 ×{FREE_TIER.videoConcurrency}</li>
                <li>基础模型可用，带水印</li>
                <li>购积分无折扣</li>
              </ul>
              <StatusPill tone="gray">当前默认</StatusPill>
            </article>
            {controller.plans.map((plan, index) => {
              const priceCents = controller.period === "year" ? plan.price_year_cents : plan.price_month_cents;
              const periodDisabled = controller.period === "year" && plan.price_year_cents <= 0;
              const isCurrent = controller.membership?.plan_code === plan.code;
              return (
                <article key={plan.id} className={`member-card member-plan ${index === 0 ? "is-hot" : ""}`}>
                  {index === 0 ? <span className="member-plan-badge"><Flame size={11} /> 最受欢迎</span> : null}
                  <p className="eyebrow">{plan.name}</p>
                  <h4>
                    {periodDisabled ? "未开通年付" : formatCents(priceCents)}
                    {!periodDisabled ? <small> / {controller.period === "year" ? "年" : "月"}</small> : null}
                  </h4>
                  <ul>
                    <li>每月赠送 {formatCredits(plan.monthly_credits)} 积分（31 天有效）</li>
                    <li>图片并发 ×{plan.image_concurrency} · 视频并发 ×{plan.video_concurrency}</li>
                    <li>购积分 {discountLabel(plan.credit_discount_bps)}</li>
                  </ul>
                  {isCurrent ? (
                    <StatusPill tone="green">
                      <BadgeCheck size={11} /> 当前会员
                    </StatusPill>
                  ) : null}
                  <button
                    type="button"
                    className="create-button member-plan-cta"
                    disabled={controller.busy || periodDisabled || !anyChannelEnabled}
                    onClick={() => void controller.placeOrder({ kind: "plan", plan })}
                  >
                    {controller.busy ? <Loader2 className="spin" size={14} /> : <Crown size={14} />}
                    {isCurrent ? "续费" : "立即订阅"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 直购积分 */}
      <section>
        <div className="member-section-head">
          <h3>直购积分</h3>
          <span className="member-text-link">1 元 = {formatCredits(controller.creditsPerYuan)} 积分 · 永久有效{memberDiscounted ? ` · 会员再享${discountLabel(controller.memberDiscountBps)}` : ""}</span>
        </div>
        {controller.packages.length > 0 ? (
          <div className="member-pack-grid">
            {controller.packages.map(pkg => {
              const payCents = discountedCents(pkg.price_cents, controller.memberDiscountBps);
              const selected = controller.credits === pkg.credits;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  className={`member-card member-pack ${selected ? "selected" : ""}`}
                  onClick={() => controller.setCredits(pkg.credits)}
                >
                  <b>{formatCredits(pkg.credits)} 积分</b>
                  <span>{pkg.name}</span>
                  <span className="member-pack-price">
                    {memberDiscounted ? <s>{formatCents(pkg.price_cents)}</s> : null}
                    {formatCents(payCents)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="member-recharge-layout">
          <div className="member-card member-recharge">
            <p className="eyebrow">自选额度</p>
            <b className="member-recharge-value">{formatCredits(controller.credits)} 积分</b>
            <input
              type="range"
              min={RECHARGE_SLIDER_MIN}
              max={RECHARGE_SLIDER_MAX}
              step={RECHARGE_SLIDER_STEP}
              value={controller.credits}
              onChange={event => controller.setCredits(Number(event.target.value))}
              aria-label="选择充值积分数量"
            />
            <div className="member-presets">
              {RECHARGE_PRESETS.map(value => (
                <button
                  key={value}
                  type="button"
                  className={controller.credits === value ? "selected" : ""}
                  onClick={() => controller.setCredits(value)}
                >
                  {formatCredits(value)}
                </button>
              ))}
            </div>
            <p className="member-field-label">支付方式</p>
            <div className="member-channels">
              {PAY_CHANNELS.map(item => (
                <button
                  key={item.value}
                  type="button"
                  disabled={!item.enabled}
                  className={controller.channel === item.value ? "selected" : ""}
                  onClick={() => item.enabled && controller.setChannel(item.value)}
                  title={item.enabled ? item.label : `${item.label}（${item.note}）`}
                >
                  <CreditCard size={13} /> {item.label}
                  {!item.enabled ? <small>{item.note}</small> : null}
                </button>
              ))}
            </div>
          </div>
          {/* 实时结算卡 */}
          <aside className="member-card member-checkout">
            <p className="eyebrow">实时结算</p>
            <dl>
              <div>
                <dt>获得积分</dt>
                <dd>{formatCredits(controller.credits)}</dd>
              </div>
              <div>
                <dt>当前汇率</dt>
                <dd>约 {formatCredits(effectiveRate)} 积分/元</dd>
              </div>
              {memberDiscounted ? (
                <div>
                  <dt>会员折扣</dt>
                  <dd>{controller.activePlan?.name} · {discountLabel(controller.memberDiscountBps)}</dd>
                </div>
              ) : null}
              <div className="member-checkout-total">
                <dt>需支付</dt>
                <dd>{formatCents(controller.rechargePayCents)}</dd>
              </div>
              {memberDiscounted ? (
                <div>
                  <dt>原价</dt>
                  <dd><s>{formatCents(controller.rechargeBaseCents)}</s></dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              className="create-button member-plan-cta"
              disabled={controller.busy || !anyChannelEnabled || !controller.matchedPackage}
              onClick={() => void controller.placeOrder({ kind: "credits" })}
            >
              {controller.busy ? <Loader2 className="spin" size={14} /> : null} 立即充值
            </button>
            {!controller.matchedPackage ? (
              <small className="member-checkout-hint">滑杆为预估，下单请点选已上架积分包档位</small>
            ) : null}
            {!anyChannelEnabled ? (
              <small className="member-checkout-hint">支付渠道暂未开放，敬请期待</small>
            ) : null}
          </aside>
        </div>
      </section>

      {/* 待支付订单（mock 闭环） */}
      {controller.pendingOrder ? (
        <section className="member-card member-pending-order">
          <p className="eyebrow">待支付订单</p>
          <p>
            订单 {controller.pendingOrder.id} · 应付 {formatCents(controller.pendingOrder.amount_cents)}
          </p>
          <div className="member-quick-actions">
            <button type="button" className="create-button" disabled={controller.busy} onClick={() => void controller.payPendingOrder()}>
              {controller.busy ? <Loader2 className="spin" size={14} /> : null} 模拟支付完成（开发）
            </button>
            <button type="button" className="outline-button" disabled={controller.busy} onClick={() => void controller.cancelPendingOrder()}>
              取消订单
            </button>
          </div>
        </section>
      ) : null}

      <p className="member-tip">
        积分不可兑换会员、不可转赠、不可提现，不支持退款或反向兑为人民币。价格口径详见
        <Link href="/member/pricing" className="member-text-link"> 定价规则</Link>。
      </p>
    </div>
  );
}
