import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRight, Crown, Image as ImageIcon, Info, Sparkles, Video, Wallet } from "lucide-react";
import { Link } from "wouter";

import { MEMBER_GRANT_TTL_DAYS } from "../model/constants";
import { daysUntil, formatCredits, formatDate } from "../model/format";
import type { MemberOverview } from "../model/types";
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from "./components/memberBits";

/** 会员首页（/member）：当前会员 + 双余额 + 本月消耗 + 快速入口。 */
export function MemberHomeView({ overviewQuery }: { overviewQuery: UseQueryResult<MemberOverview, Error> }) {
  if (overviewQuery.isPending) return <LoadingBlock text="正在读取会员数据…" />;
  if (overviewQuery.isError) return <ErrorBlock onRetry={() => void overviewQuery.refetch()} />;
  const overview = overviewQuery.data;
  if (!overview) return <EmptyBlock text="暂无会员数据" />;

  const membership = overview.membership;
  const expiryDays = daysUntil(overview.next_expiry_at);
  const usage = overview.monthly_usage;

  return (
    <div className="member-stack">
      {/* 当前会员 */}
      <section className="member-card member-hero">
        <div className="member-hero-main">
          <p className="eyebrow">当前会员</p>
          <h2>
            <Crown size={20} />
            {membership ? membership.plan_name : "免费版"}
          </h2>
          {membership ? (
            <p className="member-hero-sub">有效期至 {formatDate(membership.expires_at)}</p>
          ) : (
            <p className="member-hero-sub">开通会员享每月积分、更高并发与购积分折扣</p>
          )}
        </div>
        <div className="member-hero-actions">
          <StatusPill tone={membership ? "green" : "gray"}>{membership ? "生效中" : "非会员"}</StatusPill>
          <Link href="/member/plans" className="create-button member-link-button">
            <Sparkles size={15} /> {membership ? "续费 / 升级" : "开通会员"}
          </Link>
        </div>
      </section>

      {/* 双余额 */}
      <section className="member-balance-grid">
        <div className="member-card member-balance">
          <p className="eyebrow">限时积分</p>
          <b className="member-balance-value">{formatCredits(overview.limited_available)}</b>
          <small>
            {overview.next_expiry_at
              ? `${formatDate(overview.next_expiry_at)} 到期 · ${expiryDays} 天后清零`
              : `会员赠送积分 ${MEMBER_GRANT_TTL_DAYS} 天有效期`}
          </small>
          {overview.limited_frozen > 0 ? <small>冻结中 {formatCredits(overview.limited_frozen)}</small> : null}
        </div>
        <div className="member-card member-balance">
          <p className="eyebrow">永久积分</p>
          <b className="member-balance-value">{formatCredits(overview.permanent_available)}</b>
          <small>现金购买，永久有效，不清零</small>
          {overview.permanent_frozen > 0 ? <small>冻结中 {formatCredits(overview.permanent_frozen)}</small> : null}
        </div>
      </section>

      <p className="member-tip">
        <Info size={13} /> 扣费时优先扣除限时积分，限时积分耗尽后再扣永久积分；只有生成成功才扣费，失败/取消不扣费。
      </p>

      {/* 本月消耗统计 */}
      <section>
        <div className="member-section-head">
          <h3>本月消耗</h3>
          <Link href="/member/usage" className="member-text-link">
            查看明细 <ArrowRight size={12} />
          </Link>
        </div>
        <div className="member-stat-grid">
          <div className="member-card member-stat">
            <ImageIcon size={16} />
            <small>图片生成</small>
            <b>{formatCredits(usage?.image_count ?? 0)} 次</b>
          </div>
          <div className="member-card member-stat">
            <Video size={16} />
            <small>视频渲染</small>
            <b>{formatCredits(usage?.video_seconds ?? 0)} 秒</b>
          </div>
          <div className="member-card member-stat">
            <Wallet size={16} />
            <small>共消耗积分</small>
            <b>{formatCredits(usage?.total_credits ?? 0)}</b>
          </div>
        </div>
      </section>

      {/* 快速入口 */}
      <section className="member-quick-actions">
        <Link href="/member/plans" className="create-button member-link-button">
          <Wallet size={15} /> 充值积分
        </Link>
        <Link href="/member/plans" className="outline-button member-link-button">
          <Crown size={15} /> 订阅会员
        </Link>
        <Link href="/member/invite" className="outline-button member-link-button">
          <Sparkles size={15} /> 邀请有礼
        </Link>
      </section>
    </div>
  );
}
