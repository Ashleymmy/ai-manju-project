import { RefreshCcw, Search, ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatDateTime, StatusPill } from "@/features/member";

import type { AuditLogsController } from "../controllers/useAuditLogsController";
import { ADMIN_AUDIT_ACTION_OPTIONS, auditActionLabel, formatAuditDetail } from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/**
 * 模块8 审计日志面板：操作人/操作类型筛选 + 分页。
 * 日志追加式留痕（应用层无删改入口，数据库层 REVOKE UPDATE/DELETE）——只读，不可删除。
 */
export function AuditLogsPanel({ controller }: { controller: AuditLogsController }) {
  const {
    action,
    adminId,
    applyAction,
    applyAdminId,
    isError,
    isPending,
    items,
    page,
    reload,
    setAdminId,
    setPage,
    total,
    totalPages,
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">SECURITY / AUDIT</p>
          <h2>审计日志</h2>
          <small>后台写操作全量留痕；日志不可删除（数据库层已禁 UPDATE/DELETE）。</small>
        </div>
        <div className="monitor-actions">
          <select value={action} onChange={event => applyAction(event.target.value)} aria-label="操作类型">
            {ADMIN_AUDIT_ACTION_OPTIONS.map(option => (
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
          value={adminId}
          onChange={event => setAdminId(event.target.value)}
          placeholder="按操作人 ID 筛选，回车确认"
          aria-label="操作人 ID"
          onKeyDown={event => {
            if (event.key === "Enter") applyAdminId();
          }}
        />
        <button type="button" className="outline-button small" onClick={applyAdminId}>
          <Search size={13} /> 查询
        </button>
        <StatusPill tone="blue">
          <ShieldCheck size={11} /> 只读 · 不可删除
        </StatusPill>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={items.length === 0}
        emptyText="暂无审计日志"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-audit-row">
            <span>时间</span>
            <span>操作人</span>
            <span>操作类型</span>
            <span>对象</span>
            <span>内容</span>
            <span>IP</span>
          </div>
          {items.map(log => (
            <div className="admin-table-row admin-audit-row" key={log.id}>
              <span>{formatDateTime(log.created_at)}</span>
              <span className="admin-cell-ellipsis" title={log.admin_id}>{log.admin_id}</span>
              <span>
                <StatusPill tone="gray">{auditActionLabel(log.action)}</StatusPill>
              </span>
              <span className="admin-cell-ellipsis" title={`${log.target_type || ""} ${log.target_id || ""}`}>
                {log.target_type ? `${log.target_type}${log.target_id ? `:${log.target_id}` : ""}` : log.target_id || "—"}
              </span>
              <span className="admin-cell-ellipsis" title={formatAuditDetail(log.detail)}>
                {formatAuditDetail(log.detail)}
              </span>
              <span className="admin-cell-ellipsis">{log.ip || "—"}</span>
            </div>
          ))}
        </div>
        <AdminPagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </AdminQueryState>
    </section>
  );
}
