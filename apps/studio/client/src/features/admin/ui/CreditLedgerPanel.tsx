import { RefreshCcw, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatCredits, formatDateTime } from "@/features/member";

import type { CreditLedgerController } from "../controllers/useCreditLedgerController";
import { ADMIN_LEDGER_TYPE_OPTIONS, ADMIN_TIME_RANGE_OPTIONS, adminLedgerTypeLabel } from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/** 模块2 积分流水面板：类型/用户/时间范围筛选 + 分页 + 顶部统计卡。 */
export function CreditLedgerPanel({ controller }: { controller: CreditLedgerController }) {
  const {
    applyEntryType,
    applyTimeRange,
    applyUserId,
    entryType,
    isError,
    isPending,
    items,
    ledgerStats,
    page,
    reload,
    setPage,
    setUserId,
    timeRangeDays,
    total,
    totalPages,
    userId,
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / LEDGER</p>
          <h2>积分流水</h2>
          <small>7 类流水全量可查；统计卡的累计增加/扣减为当前页聚合。</small>
        </div>
        <div className="monitor-actions">
          <select value={entryType} onChange={event => applyEntryType(event.target.value)} aria-label="流水类型">
            {ADMIN_LEDGER_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={timeRangeDays}
            onChange={event => applyTimeRange(Number(event.target.value))}
            aria-label="时间范围"
          >
            {ADMIN_TIME_RANGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button className="outline-button small" onClick={() => void reload()}>
            <RefreshCcw size={14} /> 刷新
          </button>
        </div>
      </div>

      <div className="member-filters admin-filter-bar">
        <Input
          value={userId}
          onChange={event => setUserId(event.target.value)}
          placeholder="按用户 ID 筛选，回车确认"
          aria-label="用户 ID"
          onKeyDown={event => {
            if (event.key === "Enter") applyUserId();
          }}
        />
        <button type="button" className="outline-button small" onClick={applyUserId}>
          <Search size={13} /> 查询
        </button>
      </div>

      <div className="monitor-grid admin-stat-grid">
        <div>
          <span>总条数</span>
          <b>{formatCredits(total)}</b>
          <em className="healthy">total</em>
        </div>
        <div>
          <span>累计增加（本页）</span>
          <b className="member-cell-num is-positive">+{formatCredits(ledgerStats.increase)}</b>
          <em className="healthy">credit</em>
        </div>
        <div>
          <span>累计扣减（本页）</span>
          <b className="member-cell-num is-negative">-{formatCredits(ledgerStats.decrease)}</b>
          <em className="watch">debit</em>
        </div>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={items.length === 0}
        emptyText="暂无流水记录"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-ledger-row">
            <span>时间</span>
            <span>用户</span>
            <span>流水类型</span>
            <span>变动积分</span>
            <span>积分账户</span>
            <span>变动后余额</span>
            <span>关联单号</span>
          </div>
          {items.map(entry => {
            const positive = entry.amount >= 0;
            return (
              <div className="admin-table-row admin-ledger-row" key={entry.id}>
                <span>{formatDateTime(entry.created_at)}</span>
                <span className="admin-cell-ellipsis" title={entry.user_id}>{entry.user_id}</span>
                <span>{adminLedgerTypeLabel(entry.entry_type)}</span>
                <span className={`member-cell-num ${positive ? "is-positive" : "is-negative"}`}>
                  {positive ? "+" : ""}
                  {formatCredits(entry.amount)}
                </span>
                <span>{entry.bucket === "grant" ? "限时积分" : "永久积分"}</span>
                <span className="member-cell-num">{formatCredits(entry.permanent_after)}</span>
                <span className="admin-cell-ellipsis" title={entry.order_id || entry.job_id || ""}>
                  {entry.order_id || entry.job_id || "—"}
                </span>
              </div>
            );
          })}
        </div>
        <AdminPagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </AdminQueryState>
    </section>
  );
}
