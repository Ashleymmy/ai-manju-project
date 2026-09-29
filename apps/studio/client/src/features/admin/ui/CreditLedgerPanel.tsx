import { RefreshCcw, RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatCredits, formatDateTime } from "@/features/member";

import type { CreditLedgerController } from "../controllers/useCreditLedgerController";
import {
  ledgerBalanceAfter,
  ledgerUserLabel,
  LEDGER_USER_SEARCH_PAGE_SIZE,
} from "../model/ledgerFilters";
import {
  ADMIN_LEDGER_TYPE_OPTIONS,
  ADMIN_TIME_RANGE_OPTIONS,
  adminLedgerTypeLabel,
} from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";
import "./report-content.css";

/** 流水筛选集中在内容区；统计明确区分全部匹配记录与本页金额。 */
export function CreditLedgerPanel({
  controller,
}: {
  controller: CreditLedgerController;
}) {
  const {
    draft,
    updateDraft,
    userSearch,
    searchUsers,
    selectUser,
    userOptions,
    knownUsers,
    searchingUsers,
    userSearchFailed,
    userSearchTotal,
    retryUserSearch,
    appliedUser,
    appliedSummary,
    hasUnappliedChanges,
    validationError,
    applyFilters,
    resetFilters,
    isFetching,
    isError,
    isPending,
    items,
    ledgerStats,
    page,
    reload,
    setPage,
    total,
    totalPages,
  } = controller;
  const netChange = ledgerStats.increase - ledgerStats.decrease;
  const statsUnavailable = isPending || isError;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / LEDGER</p>
          <h2>积分流水</h2>
          <small>查询积分的来源与去向，核对每笔变动及关联任务、订单。</small>
        </div>
        <div className="monitor-actions">
          <button
            className="outline-button small"
            onClick={() => void reload()}
            disabled={isFetching}
          >
            <RefreshCcw size={14} /> 刷新
          </button>
        </div>
      </div>

      <div className="admin-report-content admin-ledger-content">
        <form
          className="admin-report-filters admin-report-filters--ledger"
          aria-label="积分流水筛选"
          onSubmit={event => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <div className="admin-ledger-filter-heading">
            <h3>
              <SlidersHorizontal size={15} /> 筛选流水
            </h3>
            <span>组合条件后点击查询</span>
          </div>
          <label>
            时间范围
            <select
              aria-label="时间范围"
              value={draft.timeRange}
              onChange={event => updateDraft({ timeRange: event.target.value })}
            >
              {ADMIN_TIME_RANGE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">自定义日期</option>
            </select>
          </label>
          <label>
            流水类型
            <select
              aria-label="流水类型"
              value={draft.entryType}
              onChange={event => updateDraft({ entryType: event.target.value })}
            >
              {ADMIN_LEDGER_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            搜索用户
            <Input
              value={userSearch}
              onChange={event => searchUsers(event.target.value)}
              placeholder="昵称 / 账号 / 用户 ID"
              aria-label="搜索用户"
              aria-describedby="ledger-user-search-status"
            />
          </label>
          <label>
            用户范围
            <select
              aria-label="用户范围"
              value={
                draft.user?.user_id || (userSearch.trim() ? "__choose__" : "")
              }
              onChange={event => selectUser(event.target.value)}
            >
              <option value="">全部用户</option>
              {userSearch.trim() && !draft.user && (
                <option value="__choose__" disabled>
                  {searchingUsers ? "正在查找…" : "请选择匹配用户"}
                </option>
              )}
              {userOptions.map(user => (
                <option key={user.user_id} value={user.user_id}>
                  {ledgerUserLabel(user)} · {user.username || user.user_id}
                </option>
              ))}
            </select>
          </label>
          {draft.timeRange === "custom" && (
            <>
              <label>
                开始日期
                <Input
                  type="date"
                  aria-label="开始日期"
                  value={draft.startDate}
                  onChange={event =>
                    updateDraft({ startDate: event.target.value })
                  }
                />
              </label>
              <label>
                结束日期
                <Input
                  type="date"
                  aria-label="结束日期"
                  value={draft.endDate}
                  onChange={event =>
                    updateDraft({ endDate: event.target.value })
                  }
                />
              </label>
            </>
          )}
          <div className="admin-ledger-filter-footer">
            <div
              id="ledger-user-search-status"
              className="admin-ledger-filter-help"
              aria-live="polite"
            >
              {searchingUsers ? (
                "正在查找用户…"
              ) : userSearchFailed ? (
                <>
                  用户列表读取失败{" "}
                  <button type="button" onClick={retryUserSearch}>
                    重试
                  </button>
                </>
              ) : userSearch.trim() && userSearchTotal === 0 ? (
                "没有找到匹配用户，请更换关键词"
              ) : draft.user ? (
                <>
                  已选：{ledgerUserLabel(draft.user)} · {draft.user.user_id}
                </>
              ) : userSearch.trim() ? (
                `找到 ${userSearchTotal} 位用户，请选择具体用户${userSearchTotal > LEDGER_USER_SEARCH_PAGE_SIZE ? `（仅显示前 ${LEDGER_USER_SEARCH_PAGE_SIZE} 位，请缩小搜索范围）` : ""}`
              ) : (
                "留空查询全部用户；输入关键词可查找指定用户"
              )}
              {draft.timeRange === "custom" && (
                <span>日期按本地时区，包含开始和结束当天。</span>
              )}
            </div>
            <div className="admin-report-filter-actions">
              <button
                type="button"
                className="admin-report-button"
                onClick={resetFilters}
              >
                <RotateCcw size={15} /> 重置
              </button>
              <button
                type="submit"
                className="admin-report-button admin-report-button--primary"
              >
                <Search size={16} /> 查询
              </button>
            </div>
          </div>
          {validationError && (
            <p className="admin-ledger-filter-error" role="alert">
              {validationError}
            </p>
          )}
        </form>
        <div className="admin-ledger-applied" aria-live="polite">
          <span>当前查询</span>
          {appliedSummary.map((label, index) => (
            <span className="admin-ledger-filter-tag" key={index}>
              {label}
            </span>
          ))}
          {hasUnappliedChanges && <small>条件已修改，点击查询生效</small>}
        </div>
        <div className="admin-report-stats">
          <div>
            <span>匹配流水</span>
            <strong>{isPending || isError ? "—" : formatCredits(total)}</strong>
            <small>当前筛选条件下的全部记录</small>
          </div>
          <div>
            <span>本页增加</span>
            <strong className="member-cell-num is-positive">
              {isPending || isError
                ? "—"
                : `+${formatCredits(ledgerStats.increase)}`}
            </strong>
            <small>本页增加的积分</small>
          </div>
          <div>
            <span>本页扣减</span>
            <strong className="member-cell-num is-negative">
              {isPending || isError
                ? "—"
                : `-${formatCredits(ledgerStats.decrease)}`}
            </strong>
            <small>本页扣减的积分</small>
          </div>
          <div>
            <span>本页净变动</span>
            <strong
              className={`member-cell-num ${netChange > 0 ? "is-positive" : netChange < 0 ? "is-negative" : ""}`}
            >
              {statsUnavailable
                ? "—"
                : `${netChange > 0 ? "+" : ""}${formatCredits(netChange)}`}
            </strong>
            <small>本页增加减去扣减</small>
          </div>
        </div>
        <div className="admin-report-listhead">
          <h3>流水记录</h3>
          <span>
            {isPending
              ? "正在读取…"
              : isError
                ? "读取失败"
                : isFetching
                  ? "正在刷新…"
                  : `共 ${formatCredits(total)} 条 · 本页 ${items.length} 条`}
          </span>
        </div>

        <AdminQueryState
          isPending={isPending}
          isError={isError}
          isEmpty={items.length === 0}
          emptyText="暂无流水记录"
          emptyHint="尝试扩大时间范围或重置筛选条件"
          onRetry={() => void reload()}
        >
          <div className="admin-report-table">
            <table>
              <caption className="sr-only">积分流水记录</caption>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>流水类型</th>
                  <th>变动积分</th>
                  <th>积分账户</th>
                  <th>变动后余额</th>
                  <th>关联单号</th>
                </tr>
              </thead>
              <tbody>
                {items.map(entry => {
                  const positive = entry.amount >= 0;
                  const balance = ledgerBalanceAfter(entry);
                  const member =
                    appliedUser?.user_id === entry.user_id
                      ? appliedUser
                      : knownUsers[entry.user_id];
                  return (
                    <tr key={entry.id}>
                      <td>
                        {formatDateTime(entry.created_at)}
                        <small title="流水编号">{entry.id}</small>
                      </td>
                      <td>
                        {member && (
                          <span className="admin-ledger-user-name">
                            {ledgerUserLabel(member)}
                          </span>
                        )}
                        <span
                          className={
                            member ? "admin-ledger-secondary" : undefined
                          }
                        >
                          {entry.user_id}
                        </span>
                      </td>
                      <td>
                        <span className="admin-ledger-type">
                          {adminLedgerTypeLabel(entry.entry_type)}
                        </span>
                      </td>
                      <td
                        className={`member-cell-num ${positive ? "is-positive" : "is-negative"}`}
                      >
                        {positive ? "+" : ""}
                        {formatCredits(entry.amount)}
                      </td>
                      <td>
                        {entry.bucket === "grant"
                          ? "限时积分"
                          : entry.bucket === "permanent"
                            ? "永久积分"
                            : entry.bucket || "—"}
                      </td>
                      <td className="member-cell-num">
                        {balance == null ? "—" : formatCredits(balance)}
                        {entry.bucket === "grant" && <small>该批次剩余</small>}
                      </td>
                      <td>
                        {entry.order_id && (
                          <span className="admin-ledger-reference">
                            订单 · {entry.order_id}
                          </span>
                        )}
                        {entry.job_id && (
                          <span className="admin-ledger-reference">
                            任务 · {entry.job_id}
                          </span>
                        )}
                        {!entry.order_id && !entry.job_id && "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        </AdminQueryState>
      </div>
    </section>
  );
}
