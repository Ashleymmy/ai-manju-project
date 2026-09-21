import { Coins, KeyRound, RefreshCcw, Plus, UserCog, BadgeCheck } from "lucide-react";
import { useState } from "react";
import type { AdminUsersController } from "../controllers/useAdminUsersController";
import type { AdminMemberUser } from "../model/memberAdmin";
import { MembershipDialog } from "./MembershipDialog";
import { UsersPanel } from "./UsersPanel";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents, formatCredits, formatDateTime, StatusPill } from "@/features/member";

import type { MemberUsersController } from "../controllers/useMemberUsersController";
import {
  ACCOUNT_STATUS_OPTIONS,
  MEMBER_LEVEL_OPTIONS,
  adminUserStatusLabel,
  adminUserStatusTone,
  memberLevelLabel,
} from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/**
 * 模块1 会员用户列表面板。
 * readOnly（auditor 只读）时隐藏调积分/重置邀请码两个写操作入口。
 */
export function MemberUsersPanel({
  controller,
  readOnly,
  usersController,
  superAdmin = false,
}: {
  controller: MemberUsersController;
  readOnly: boolean;
  usersController?: AdminUsersController;
  superAdmin?: boolean;
}) {
  const [membershipTarget, setMembershipTarget] = useState<AdminMemberUser | null>(null);
  const {
    adjustBusy,
    adjustDraft,
    adjustErrors,
    adjustTarget,
    closeAdjustDialog,
    closeResetDialog,
    confirmResetInvite,
    isError,
    isPending,
    memberLevel,
    openAdjustDialog,
    openResetDialog,
    page,
    reload,
    resetBusy,
    resetError,
    resetTarget,
    rows,
    setAdjustDraft,
    setMemberLevel,
    setPage,
    setStatus,
    status,
    total,
    totalPages,
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">MEMBERS / {total}</p>
          <h2>成员管理</h2>
          <small>统一管理账号、权限、会员与积分；筛选覆盖全部成员。</small>
        </div>
        <div className="monitor-actions">
          {!readOnly && usersController && <button className="vermilion-button" onClick={usersController.openCreateDialog}><Plus size={14} /> 创建成员</button>}
          <select value={memberLevel} onChange={event => setMemberLevel(event.target.value)} aria-label="会员等级">
            {MEMBER_LEVEL_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="账号状态">
            {ACCOUNT_STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button className="outline-button small" onClick={() => void reload()}>
            <RefreshCcw size={14} /> 刷新
          </button>
        </div>
      </div>
      <div className="member-filters admin-filter-bar"><Input aria-label="搜索成员" placeholder="搜索账号、昵称或成员 ID" value={controller.search} onChange={e => controller.setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") controller.applySearch(); }} /><button className="outline-button small" onClick={controller.applySearch}>查询</button></div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={rows.length === 0}
        emptyText="暂无会员用户"
        emptyHint="调整筛选条件或翻页查看"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-member-user-row">
            <span>用户</span>
            <span>会员等级</span>
            <span>会员到期</span>
            <span>角色 / 状态</span>
            <span>永久积分</span>
            <span>限时积分</span>
            <span>注册</span>
            <span>最后登录</span>
            <span>累计充值</span>
            <span />
          </div>
          {rows.map(user => (
            <div className="admin-table-row admin-member-user-row" key={user.user_id}>
              <span className="admin-cell-main">
                <b>{user.display_name || user.username}</b>
                <small>{user.username} · {user.user_id}</small>
              </span>
              <span>{memberLevelLabel(user.member_level)}</span>
              <span>{user.member_expires_at ? formatDateTime(user.member_expires_at) : "—"}</span>
              <span>
                <small>{user.role || "member"}</small>
                <StatusPill tone={adminUserStatusTone(user.status)}>
                  {adminUserStatusLabel(user.status)}
                </StatusPill>
              </span>
              <span className="member-cell-num">{formatCredits(user.permanent_balance)}</span>
              <span className="member-cell-num">{formatCredits(user.limited_balance)}</span>
              <span>{formatDateTime(user.registered_at)}</span>
              <span>{user.last_login_at ? formatDateTime(user.last_login_at) : "—"}</span>
              <span className="member-cell-num">{formatCents(user.total_recharge_cents)}</span>
              {!readOnly ? (
                <span className="admin-row-actions">
                  {usersController && (superAdmin || user.role === "member") && <button type="button" title="编辑账号与权限" aria-label={`编辑账号 ${user.username}`} onClick={() => usersController.openEditDialog({ id: user.user_id, username: user.username, display_name: user.display_name, role: user.role || "member", status: user.status === "active" ? "active" : "disabled" })}><UserCog size={14} /></button>}
                  {superAdmin && <button type="button" title="变更会员等级" aria-label={`变更会员 ${user.username}`} onClick={() => setMembershipTarget(user)}><BadgeCheck size={14} /></button>}
                  <button
                    type="button"
                    title="调积分"
                    onClick={() => openAdjustDialog(user)}
                    disabled={adjustBusy || resetBusy}
                  >
                    <Coins size={14} />
                  </button>
                  <button
                    type="button"
                    title="重置邀请码"
                    onClick={() => openResetDialog(user)}
                    disabled={adjustBusy || resetBusy}
                  >
                    <KeyRound size={14} />
                  </button>
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <AdminPagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </AdminQueryState>

      {/* 调积分弹窗：delta 有符号 + reason + nonce（提交时自动生成 UUID 幂等键） */}
      <Dialog
        open={adjustTarget !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) closeAdjustDialog();
        }}
      >
        <DialogContent className="sm:max-w-[520px]" showCloseButton={!adjustBusy}>
          <DialogHeader>
            <DialogTitle>调整积分</DialogTitle>
            <DialogDescription>
              用户 {adjustTarget?.display_name || adjustTarget?.username}（{adjustTarget?.user_id}）；
              调整记入积分流水（后台调增/调减），提交幂等。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>调整额度（正数调增，负数调减）</span>
              <Input
                type="number"
                step={1}
                value={adjustDraft.delta}
                onChange={event => setAdjustDraft(draft => ({ ...draft, delta: event.target.value }))}
                disabled={adjustBusy}
                placeholder="如 500 或 -200"
              />
              {adjustErrors.delta ? (
                <span className="text-sm text-destructive">{adjustErrors.delta}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span>原因（选填，写入流水备注）</span>
              <Input
                value={adjustDraft.reason}
                onChange={event => setAdjustDraft(draft => ({ ...draft, reason: event.target.value }))}
                disabled={adjustBusy}
                placeholder="如：客服补偿"
              />
            </label>
            {adjustErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {adjustErrors.form}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closeAdjustDialog()} disabled={adjustBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void controller.submitAdjust()} disabled={adjustBusy}>
              {adjustBusy ? "提交中…" : "确认调整"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置邀请码确认弹窗 */}
      <Dialog
        open={resetTarget !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) closeResetDialog();
        }}
      >
        <DialogContent className="sm:max-w-[480px]" showCloseButton={!resetBusy}>
          <DialogHeader>
            <DialogTitle>重置邀请码</DialogTitle>
            <DialogDescription>
              将为用户 {resetTarget?.display_name || resetTarget?.username} 生成新的邀请码，
              旧码立即失效。该操作会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          {resetError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{resetError}</p>
          ) : null}
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closeResetDialog()} disabled={resetBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void confirmResetInvite()} disabled={resetBusy}>
              {resetBusy ? "重置中…" : "确认重置"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {usersController && !readOnly && <UsersPanel controller={usersController} dialogsOnly canAssignRoles={superAdmin} />}
      {membershipTarget && superAdmin && <MembershipDialog key={membershipTarget.user_id} target={membershipTarget} onClose={() => setMembershipTarget(null)} onSaved={reload} />}
    </section>
  );
}
