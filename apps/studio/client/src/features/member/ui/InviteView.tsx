import { Check, Copy, Gift, Users } from "lucide-react";

import {
  INVITE_REWARD_FIRST_CHARGE,
  INVITE_REWARD_INVITEE,
  INVITE_REWARD_INVITER,
  INVITE_REWARD_TTL_DAYS,
} from "../model/constants";
import { formatCredits, formatDateTime } from "../model/format";
import type { InviteController } from "../controllers/useInviteController";
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from "./components/memberBits";

/** 邀请有礼页（/member/invite）：邀请码 + 奖励规则 + 邀请记录。 */
export function InviteView({ controller }: { controller: InviteController }) {
  if (controller.isPending) return <LoadingBlock text="正在读取邀请数据…" />;
  if (controller.isError) return <ErrorBlock onRetry={controller.reload} />;
  const overview = controller.overview;
  if (!overview) return <EmptyBlock text="暂无邀请数据" />;

  return (
    <div className="member-stack">
      {/* 我的邀请码 */}
      <section className="member-card member-invite-hero">
        <div>
          <p className="eyebrow">我的邀请码</p>
          <h2>{overview.invite_code}</h2>
          <p className="member-invite-url">{overview.invite_url}</p>
        </div>
        <button type="button" className="create-button" onClick={() => void controller.copyInviteUrl()}>
          {controller.copied ? <Check size={15} /> : <Copy size={15} />} 复制邀请链接
        </button>
      </section>

      {/* 汇总 */}
      <section className="member-stat-grid">
        <div className="member-card member-stat">
          <Users size={16} />
          <small>已邀请人数</small>
          <b>{formatCredits(overview.invited_count)} 人</b>
        </div>
        <div className="member-card member-stat">
          <Gift size={16} />
          <small>累计获得积分</small>
          <b>{formatCredits(overview.total_reward_earned)}</b>
        </div>
      </section>

      {/* 奖励规则 */}
      <section className="member-card member-rules">
        <p className="eyebrow">奖励规则</p>
        <ul>
          <li>好友通过你的邀请码注册，你获得 {formatCredits(INVITE_REWARD_INVITER)} 积分，好友获得 {formatCredits(INVITE_REWARD_INVITEE)} 积分。</li>
          <li>好友完成首次充值，你额外获得 {formatCredits(INVITE_REWARD_FIRST_CHARGE)} 积分（未首充前奖励保持「待发放」）。</li>
          <li>奖励积分 {INVITE_REWARD_TTL_DAYS} 天内有效，过期自动清零。</li>
        </ul>
      </section>

      {/* 邀请记录 */}
      <section>
        <div className="member-section-head">
          <h3>邀请记录</h3>
        </div>
        {overview.records.length === 0 ? (
          <EmptyBlock text="暂无邀请记录" hint="复制上方邀请链接分享给好友" />
        ) : (
          <div className="member-table">
            <div className="member-table-head member-invite-row">
              <span>被邀请人</span>
              <span>注册时间</span>
              <span>是否首充</span>
              <span>奖励积分</span>
              <span>奖励状态</span>
            </div>
            {overview.records.map(record => {
              const granted = record.reward_status === "granted";
              const firstCharged = granted || record.reward_status === "expired";
              return (
                <div key={record.id} className="member-table-row member-invite-row">
                  <span className="member-cell-main">
                    <b>用户 {record.invitee_id}</b>
                  </span>
                  <span>{formatDateTime(record.created_at)}</span>
                  <span>{firstCharged ? "已首充" : "待首充"}</span>
                  <span className="member-cell-num">+{formatCredits(record.inviter_reward + (granted ? record.first_charge_bonus : 0))}</span>
                  <span>
                    {granted ? (
                      <StatusPill tone="green">已发放</StatusPill>
                    ) : record.reward_status === "expired" ? (
                      <StatusPill tone="gray">已过期</StatusPill>
                    ) : (
                      <StatusPill tone="gray">待发放</StatusPill>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
