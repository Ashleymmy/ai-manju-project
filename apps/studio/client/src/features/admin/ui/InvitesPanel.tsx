import { Gift, RefreshCcw } from "lucide-react";

import {
  formatCredits,
  formatDateTime,
  INVITE_REWARD_FIRST_CHARGE,
  INVITE_REWARD_INVITEE,
  INVITE_REWARD_INVITER,
  INVITE_REWARD_TTL_DAYS,
  StatusPill,
} from "@/features/member";

import type { InvitesController } from "../controllers/useInvitesController";
import { inviteRewardStatusLabel, inviteRewardStatusTone } from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/**
 * 模块7 邀请记录面板：全量列表 + 分页 + 奖励规则提示卡。
 * 提示卡数值为兜底默认值；现行规则以后台 billing_configs["invite_rewards"] 为准。
 */
export function InvitesPanel({ controller }: { controller: InvitesController }) {
  const { isError, isPending, items, page, reload, setPage, total, totalPages } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">GROWTH / INVITES</p>
          <h2>邀请记录</h2>
          <small>奖励金额为创建时快照；待发放 = 好友尚未完成首次充值。</small>
        </div>
        <button className="outline-button small" onClick={() => void reload()}>
          <RefreshCcw size={14} /> 刷新
        </button>
      </div>

      <div className="member-card member-rules admin-invite-rules">
        <p className="eyebrow">
          <Gift size={12} /> 奖励规则（默认）
        </p>
        <ul className="member-rule-list">
          <li>邀请人每位好友注册得 {formatCredits(INVITE_REWARD_INVITER)} 积分，被邀请人得 {formatCredits(INVITE_REWARD_INVITEE)} 积分。</li>
          <li>好友完成首次充值，邀请人额外得 {formatCredits(INVITE_REWARD_FIRST_CHARGE)} 积分（未首充前奖励保持「待发放」）。</li>
          <li>奖励积分 {INVITE_REWARD_TTL_DAYS} 天有效；现行数值以后台「套餐配置 → invite_rewards」为准。</li>
        </ul>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={items.length === 0}
        emptyText="暂无邀请记录"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-invite-row">
            <span>邀请人</span>
            <span>被邀请人</span>
            <span>邀请人奖励</span>
            <span>被邀请人奖励</span>
            <span>首充加奖</span>
            <span>状态</span>
            <span>邀请时间</span>
          </div>
          {items.map(record => (
            <div className="admin-table-row admin-invite-row" key={record.id}>
              <span className="admin-cell-ellipsis" title={record.inviter_id}>{record.inviter_id}</span>
              <span className="admin-cell-ellipsis" title={record.invitee_id}>{record.invitee_id}</span>
              <span className="member-cell-num">+{formatCredits(record.inviter_reward)}</span>
              <span className="member-cell-num">+{formatCredits(record.invitee_reward)}</span>
              <span className="member-cell-num">
                {record.reward_status === "granted" ? `+${formatCredits(record.first_charge_bonus)}` : "—"}
              </span>
              <span>
                <StatusPill tone={inviteRewardStatusTone(record.reward_status)}>
                  {inviteRewardStatusLabel(record.reward_status)}
                </StatusPill>
              </span>
              <span>{formatDateTime(record.created_at)}</span>
            </div>
          ))}
        </div>
        <AdminPagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </AdminQueryState>
    </section>
  );
}
