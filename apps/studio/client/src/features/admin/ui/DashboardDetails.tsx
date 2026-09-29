import { Coins, Receipt, RotateCcw, Search, Users } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCredits } from "@/features/member";

import type { DashboardDetailsController } from "../controllers/useDashboardDetailsController";
import {
  DASHBOARD_DETAIL_VIEWS,
  type DashboardDetailKind,
} from "../model/dashboardDetails";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/** Icons are decorative; each category is also labelled for keyboard/screen readers. */
const DETAIL_ICONS = { users: Users, orders: Receipt, consumptions: Coins };

export function DashboardDetails({
  controller,
}: {
  controller: DashboardDetailsController;
}) {
  const {
    kind,
    selectKind,
    draft,
    setDraft,
    filters,
    apply,
    reset,
    rows,
    total,
    totalPages,
    setPage,
    detail,
    setDetail,
    isPending,
    isError,
    isFetching,
    reload,
    hasUnappliedChanges,
  } = controller;
  const view = DASHBOARD_DETAIL_VIEWS[kind];
  return (
    <section className="admin-dashboard-details" aria-label="运营明细">
      <div className="admin-report-listhead">
        <h3>运营明细</h3>
        <span>
          {isPending
            ? "正在读取…"
            : isError
              ? "读取失败"
              : `共 ${formatCredits(total)} 条`}
          {!isPending && !isError && isFetching ? " · 刷新中…" : ""}
        </span>
      </div>
      <div
        className="admin-dashboard-detail-tabs"
        role="group"
        aria-label="明细分类"
      >
        {(Object.keys(DASHBOARD_DETAIL_VIEWS) as DashboardDetailKind[]).map(
          key => {
            const Icon = DETAIL_ICONS[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === kind}
                onClick={() => selectKind(key)}
              >
                <Icon size={15} aria-hidden="true" />
                {DASHBOARD_DETAIL_VIEWS[key].label}
              </button>
            );
          }
        )}
      </div>
      <form
        className="admin-report-filters admin-dashboard-detail-filters"
        aria-label="运营明细筛选"
        onSubmit={event => {
          event.preventDefault();
          apply();
        }}
      >
        <label>
          {kind === "users" ? "搜索用户" : "用户 ID"}
          <input
            aria-label={kind === "users" ? "搜索用户" : "用户 ID"}
            value={draft.search}
            onChange={event =>
              setDraft(previous => ({
                ...previous,
                search: event.target.value,
              }))
            }
            placeholder={
              kind === "users"
                ? "昵称 / 账号 / 用户 ID"
                : "输入完整用户 ID；留空查询全部"
            }
          />
        </label>
        <label>
          {view.statusLabel}
          <select
            aria-label={view.statusLabel}
            value={draft.status}
            onChange={event =>
              setDraft(previous => ({
                ...previous,
                status: event.target.value,
              }))
            }
          >
            {view.statuses.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-report-filter-actions">
          <button type="submit" className="admin-report-button">
            <Search size={15} /> 查询
          </button>
          <button type="button" className="admin-report-button" onClick={reset}>
            <RotateCcw size={15} /> 重置
          </button>
        </div>
      </form>
      <div className="admin-dashboard-detail-scope" aria-live="polite">
        <span>
          {view.label} · 全部时间 ·{" "}
          {filters.search
            ? `${kind === "users" ? "用户关键词" : "用户 ID"}：${filters.search}`
            : "全部用户"}{" "}
          ·{" "}
          {view.statuses.find(option => option.value === filters.status)
            ?.label || "全部状态"}
        </span>
        {hasUnappliedChanges && <span>条件已修改，点击查询生效</span>}
      </div>
      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={rows.length === 0}
        emptyText={`暂无${view.label}`}
        emptyHint="可调整筛选条件或稍后刷新"
        onRetry={() => void reload()}
      >
        <div className="admin-report-table admin-dashboard-detail-table">
          <table>
            <caption className="sr-only">{view.label}</caption>
            <thead>
              <tr>
                {view.columns.map(column => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td key={index}>
                      <span
                        className={
                          cell.tone
                            ? `admin-dashboard-detail-${cell.tone}`
                            : undefined
                        }
                      >
                        {cell.text}
                      </span>
                      {cell.secondary && <small>{cell.secondary}</small>}
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="admin-report-button"
                      aria-label={`查看${view.title} ${row.id}`}
                      onClick={() => setDetail(row)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AdminPagination
          page={filters.page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </AdminQueryState>
      <Dialog
        open={detail !== null}
        onOpenChange={open => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="admin-dashboard-detail-dialog sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {detail ? DASHBOARD_DETAIL_VIEWS[detail.kind].title : "运营详情"}
            </DialogTitle>
            <DialogDescription>记录编号：{detail?.id}</DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <dl className="admin-dashboard-detail-fields">
                {detail.fields.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {detail.parameters && (
                <div className="admin-dashboard-detail-parameters">
                  <h4>任务参数</h4>
                  <pre>{detail.parameters}</pre>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
