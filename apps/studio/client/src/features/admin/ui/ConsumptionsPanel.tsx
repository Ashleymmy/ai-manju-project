import { RefreshCcw, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatCredits, formatDateTime, StatusPill } from "@/features/member";

import type { ConsumptionsController } from "../controllers/useConsumptionsController";
import {
  ADMIN_CONSUMPTION_STATUS_OPTIONS,
  ADMIN_TASK_TYPE_OPTIONS,
  ADMIN_TIME_RANGE_OPTIONS,
  adminConsumptionStatusLabel,
  adminConsumptionStatusTone,
  adminTaskTypeLabel,
} from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/** 模块4 任务消耗面板：顶部统计卡（响应 stats）+ 类型/状态/用户/时间筛选 + 分页。 */
export function ConsumptionsPanel({ controller }: { controller: ConsumptionsController }) {
  const {
    applyStatus,
    applyTaskType,
    applyTimeRange,
    applyUserId,
    isError,
    isPending,
    items,
    page,
    reload,
    setPage,
    setUserId,
    stats,
    status,
    successRate,
    taskType,
    timeRangeDays,
    total,
    totalPages,
    userId,
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / CONSUMPTIONS</p>
          <h2>任务消耗</h2>
          <small>成功才扣费，失败/取消释放冻结不扣费；统计为全平台口径（可按用户过滤列表）。</small>
        </div>
        <div className="monitor-actions">
          <select value={taskType} onChange={event => applyTaskType(event.target.value)} aria-label="任务类型">
            {ADMIN_TASK_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={status} onChange={event => applyStatus(event.target.value)} aria-label="任务状态">
            {ADMIN_CONSUMPTION_STATUS_OPTIONS.map(option => (
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
          <span>总消耗积分</span>
          <b>{formatCredits(stats?.total_credits_settled ?? 0)}</b>
          <em className="healthy">settled</em>
        </div>
        <div>
          <span>成功任务</span>
          <b>{formatCredits(stats?.success_count ?? 0)}</b>
          <em className="healthy">success</em>
        </div>
        <div>
          <span>失败/取消</span>
          <b>{formatCredits(stats?.released_count ?? 0)}</b>
          <em className={stats && stats.released_count > 0 ? "watch" : "healthy"}>released</em>
        </div>
        <div>
          <span>成功率</span>
          <b>{successRate.toFixed(1)}%</b>
          <em className={successRate >= 95 ? "healthy" : "watch"}>rate</em>
        </div>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={items.length === 0}
        emptyText="暂无消耗记录"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-consumption-row">
            <span>时间</span>
            <span>用户</span>
            <span>任务类型</span>
            <span>模型</span>
            <span>消耗积分</span>
            <span>状态</span>
          </div>
          {items.map(item => {
            const charged = item.status === "settled";
            const reserved = item.status === "reserved";
            return (
              <div className="admin-table-row admin-consumption-row" key={item.id}>
                <span>{formatDateTime(item.created_at)}</span>
                <span className="admin-cell-ellipsis" title={item.user_id}>{item.user_id}</span>
                <span>{adminTaskTypeLabel(item.task_type)}</span>
                <span className="admin-cell-ellipsis" title={item.model || ""}>{item.model || "—"}</span>
                <span className="member-cell-num">
                  {charged
                    ? formatCredits(item.credits_settled ?? item.credits_quoted)
                    : reserved
                      ? `${formatCredits(item.credits_quoted)}（冻结）`
                      : "0（未扣费）"}
                </span>
                <span>
                  <StatusPill tone={adminConsumptionStatusTone(item.status)}>
                    {adminConsumptionStatusLabel(item.status)}
                  </StatusPill>
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
