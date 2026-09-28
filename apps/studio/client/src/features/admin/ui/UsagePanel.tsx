import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshCcw, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCredits, formatDateTime } from "@/features/member";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getUsageReport, getCostRates, exportUsageReport, costMoney, USAGE_PAGE_SIZE, type UsageFilters, type UsageRow } from "../services/adminUsageApi";
import { publicApiError } from "@/shared/api/errors";
import { listAdminMemberUsers } from "../services/adminMemberApi";
import { AdminPagination, AdminQueryState } from "./components/adminBits";
import { UsageCostDialog } from "./UsageCostDialogs";
import { formatUsagePendingState } from "./usagePendingState";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORT_DAYS = 30;
const STATUS_LABELS: Record<string, string> = { succeeded: "成功", failed: "失败", canceled: "取消", queued: "排队", running: "运行中", missing_job: "任务记录缺失" };
const GROUPS = [["day", "按天"], ["hour", "按小时"], ["month", "按月"], ["member", "按成员"], ["project", "按项目"], ["model", "按模型"], ["task", "按任务"]] as const;
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function UsagePanel({ readOnly, superAdmin }: { readOnly: boolean; superAdmin: boolean }) {
  const [draft, setDraft] = useState(() => ({ start: localInput(new Date(Date.now() - DEFAULT_REPORT_DAYS * DAY_MS)), end: localInput(new Date(Date.now() + 60000)), user_id: "", project_id: "", job_id: "", model: "", provider: "", status: "", member_kind: "", task_type: "" }));
  const [filters, setFilters] = useState<UsageFilters>(() => ({ ...draft, start: new Date(draft.start).toISOString(), end: new Date(draft.end).toISOString(), group_by: "day", timezone_offset: -new Date().getTimezoneOffset(), page: 1, page_size: USAGE_PAGE_SIZE }));
  const [inputError, setInputError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [section, setSection] = useState<"usage" | "rates">("usage");
  const [detail, setDetail] = useState<UsageRow | null>(null);
  const [costDialog, setCostDialog] = useState<UsageRow | "rate" | null>(null);
  const query = useQuery({ queryKey: ["admin", "usage-report", filters], queryFn: () => getUsageReport(filters) });
  const rates = useQuery({ queryKey: ["admin", "cost-rates"], queryFn: getCostRates, enabled: section === "rates" });
  const members = useQuery({ queryKey: ["admin", "usage-members", memberSearch], queryFn: () => listAdminMemberUsers(1, 200, { search: memberSearch }) });
  const apply = () => {
    if (!draft.start || !draft.end || !Number.isFinite(Date.parse(draft.start)) || !Number.isFinite(Date.parse(draft.end)) || Date.parse(draft.end) <= Date.parse(draft.start)) { setInputError("请选择有效的开始和结束时间，结束时间须晚于开始时间"); return; }
    setInputError(""); setFilters(current => ({ ...current, ...draft, start: new Date(draft.start).toISOString(), end: new Date(draft.end).toISOString(), page: 1 }));
  };
  const drill = (key: string) => {
    const field = filters.group_by === "member" ? "user_id" : filters.group_by === "project" ? "project_id" : filters.group_by === "task" ? "job_id" : null;
    if (!field) return;
    const value = field === "project_id" && !key ? "unassigned" : key;
    setDraft(current => ({ ...current, [field]: value })); setFilters(current => ({ ...current, [field]: value, group_by: "day", page: 1 }));
  };
  const totals = query.data?.stats;
  const groups = query.data?.groups || [];
  const maxCredits = useMemo(() => Math.max(1, ...groups.map(group => group.credits_settled)), [groups]);
  const successRate = totals && totals.succeeded + totals.failed > 0 ? `${(totals.succeeded / (totals.succeeded + totals.failed) * 100).toFixed(1)}%` : "—";
  const reload = async () => { await query.refetch(); if (section === "rates") await rates.refetch(); };
  const afterCostSaved = async () => { await query.refetch(); await rates.refetch(); };
  const setDraftField = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const exportCSV = async () => {
    if (exporting) return;
    setExporting(true); setInputError("");
    try { const result = await exportUsageReport(filters); const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `消耗与成本-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (err) { setInputError(publicApiError(err, "导出失败，请缩小时间范围后重试")); }
    finally { setExporting(false); }
  };

  return <section className="real-admin-section usage-panel">
    <div className="admin-panel-head"><div><p className="eyebrow">USAGE / PLATFORM COST</p><h2>消耗与成本</h2><small>追溯成员、项目与任务。用户积分、模型成本估算和账单实际费用分别统计。</small></div><button className="outline-button small" onClick={() => void reload()} disabled={query.isFetching}><RefreshCcw size={14} /> 刷新</button></div>
    <div className="usage-tabs" role="tablist" aria-label="消耗与成本视图"><button role="tab" aria-selected={section === "usage"} onClick={() => setSection("usage")}>消耗明细与统计</button><button role="tab" aria-selected={section === "rates"} onClick={() => setSection("rates")}>模型成本单价</button></div>
    {section === "usage" ? <>
      <form className="usage-filters" onSubmit={e => { e.preventDefault(); apply(); }}>
        <label>开始时间<Input type="datetime-local" value={draft.start} onChange={e => setDraftField("start", e.target.value)} onBlur={e => setDraftField("start", e.target.value)} /></label><label>结束时间（不含）<Input type="datetime-local" value={draft.end} onChange={e => setDraftField("end", e.target.value)} onBlur={e => setDraftField("end", e.target.value)} /></label>
        <label>查找成员<Input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="账号、昵称或成员 ID" /></label>
        <label>成员<select value={draft.user_id} onChange={e => setDraftField("user_id", e.target.value)}><option value="">全部成员</option>{draft.user_id && !members.data?.items.some(m => m.user_id === draft.user_id) && <option value={draft.user_id}>{draft.user_id}</option>}{members.data?.items.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || member.username} · {member.username}</option>)}</select></label>
        <label>项目 ID<Input value={draft.project_id} onChange={e => setDraftField("project_id", e.target.value)} placeholder="全部；也可点击项目汇总筛选" /></label>
        <label>任务 ID<Input value={draft.job_id} onChange={e => setDraftField("job_id", e.target.value)} placeholder="支持部分任务 ID" /></label>
        <label>模型<Input value={draft.model} onChange={e => setDraftField("model", e.target.value)} placeholder="全部模型" /></label><label>供应商标识<Input value={draft.provider} onChange={e => setDraftField("provider", e.target.value)} placeholder="全部供应商" /></label>
        <label>任务状态<select value={draft.status} onChange={e => setDraftField("status", e.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>成员类型（任务发生时）<select value={draft.member_kind} onChange={e => setDraftField("member_kind", e.target.value)}><option value="">全部</option><option value="external">正式成员</option><option value="internal">内部测试成员</option></select></label>
        <button className="vermilion-button" type="submit">查询</button>
        <button className="outline-button small" type="button" disabled={exporting || query.isPending || query.isError} onClick={() => void exportCSV()}>{exporting ? "导出中…" : "导出筛选结果（全部页）"}</button>
      </form>
      {members.isError && <p role="alert" className="usage-note">成员选项加载失败。<button onClick={() => void members.refetch()}>重试</button></p>}
      {inputError && <p role="alert" className="text-destructive">{inputError}</p>}
      <p className="usage-note">时间筛选按任务创建时间，显示为本地时间；汇总覆盖筛选结果全部页。异步生成任务与同步文本调用分别记录，提交日志不重复计数。</p>
      <AdminQueryState isPending={query.isPending} isError={query.isError} isEmpty={false} onRetry={() => void query.refetch()} emptyText="暂无数据">
        <div className="usage-kpis">
          <div><span>已扣积分</span><strong>{totals ? formatCredits(totals.credits_settled) : "—"}</strong><small>冻结 {formatCredits(totals?.credits_frozen ?? 0)} 积分</small></div>
          <div><span>任务数 / 终态成功率</span><strong>{totals?.tasks ?? "—"} / {successRate}</strong><small>成功 {totals?.succeeded ?? 0} · 失败或取消 {totals?.failed ?? 0}</small></div>
          <div><span>成本估算</span><strong>{costMoney(totals?.estimated_cost_micros)}</strong><small>{totals?.estimated_count ?? 0} 条有单价与用量依据</small></div>
          <div><span>账单实际费用</span><strong>{costMoney(totals?.actual_cost_micros)}</strong><small>已核对 {totals?.actual_count ?? 0} / {totals?.tasks ?? 0} 条</small></div>
          <div><span>已知成本合计</span><strong>{costMoney(totals?.accounted_cost_micros)}</strong><small>实际优先，其余采用估算；缺失 {totals?.unknown_cost_count ?? 0} 条</small></div>
        </div>
        <p className="usage-note">待核对不代表免费。失败、取消、重试也可能产生供应商费用；估算按任务数量计算，最终以账单核对为准。费用缺失时，已知成本合计不是全部支出。</p>
        <div className="usage-group-head"><h3>分组统计</h3><select aria-label="统计维度" value={filters.group_by} onChange={e => setFilters(current => ({ ...current, group_by: e.target.value, page: 1 }))}>{GROUPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="usage-table-scroll usage-groups"><table><caption className="sr-only">筛选范围内的全部分组统计</caption><thead><tr><th>分组</th><th>任务</th><th>积分消耗</th><th>成本估算</th><th>实际费用</th><th>费用缺失</th></tr></thead><tbody>{groups.map(group => <tr key={group.key}><td>{["member", "project", "task"].includes(filters.group_by) ? <button className="usage-drill" onClick={() => drill(group.key)}>{group.label || group.key || "未记录"}</button> : group.label || "未记录"}<small>{["member", "project", "model"].includes(filters.group_by) ? group.key : ""}</small></td><td>{group.tasks}</td><td><span>{formatCredits(group.credits_settled)}</span><div className="usage-bar" aria-hidden="true"><i style={{ width: `${group.credits_settled / maxCredits * 100}%` }} /></div></td><td>{costMoney(group.estimated_cost_micros)}</td><td>{costMoney(group.actual_cost_micros)}</td><td>{group.unknown_cost_count}</td></tr>)}</tbody></table>{!groups.length && <p className="usage-note">当前筛选条件下暂无记录。</p>}</div>
        <h3 className="usage-detail-heading">任务明细 <small>{query.data?.total ?? 0} 条</small></h3>
        <div className="usage-table-scroll"><table><caption className="sr-only">成员项目任务消耗明细</caption><thead><tr><th>创建时间 / 任务</th><th>成员</th><th>项目</th><th>模型 / 供应商</th><th>状态</th><th>积分</th><th>估算费用</th><th>实际费用</th><th>操作</th></tr></thead><tbody>{query.data?.items.map(row => <tr key={row.job_id}><td>{formatDateTime(row.created_at)}<small>{row.job_id}</small></td><td>{row.display_name || row.username || row.user_id}<small>{row.internal ? "内部测试" : "正式成员"} · {row.username}</small></td><td>{row.project_name || row.project_id || "未关联项目"}<small>{row.project_name ? row.project_id : ""}</small></td><td>{row.model || "未记录模型"}<small>{row.provider || "供应商未记录"}</small></td><td><span>{STATUS_LABELS[row.status] || row.status}</span><UsagePendingStatus row={row} /></td><td>{row.credit_status === "untracked" ? "未计费记录" : row.credit_status === "reserved" ? `${formatCredits(row.credits_quoted)}（冻结）` : formatCredits(row.credits_settled)}</td><td>{costMoney(row.estimated_cost_micros)}</td><td>{costMoney(row.actual_cost_micros)}</td><td><button className="usage-drill" onClick={() => setDetail(row)}>详情</button>{!readOnly && <button className="usage-drill" onClick={() => setCostDialog(row)}>核对费用</button>}</td></tr>)}</tbody></table></div>
        <AdminPagination page={filters.page} totalPages={Math.max(1, Math.ceil((query.data?.total || 0) / USAGE_PAGE_SIZE))} total={query.data?.total || 0} onPageChange={page => setFilters(current => ({ ...current, page }))} />
      </AdminQueryState>
    </> : <>
      <div className="usage-group-head"><h3>模型成本单价</h3>{superAdmin && <button className="vermilion-button" onClick={() => setCostDialog("rate")}><Plus size={14} /> 新增单价</button>}</div>
      <p className="usage-note">币种为人民币。按任务创建时的生效单价估算；供应商专属单价优先于模型默认单价。记录保留历史版本，不改动模型接入配置。</p>
      <AdminQueryState isPending={rates.isPending} isError={rates.isError} isEmpty={!rates.data?.length} emptyText="尚未配置模型成本单价" emptyHint="配置单价后可计算对应任务的估算成本；也可直接核对实际费用。" onRetry={() => void rates.refetch()}><div className="usage-table-scroll"><table><thead><tr><th>模型</th><th>供应商</th><th>单位</th><th>人民币单价</th><th>生效时间</th></tr></thead><tbody>{rates.data?.map(rate => <tr key={rate.id}><td>{rate.model}</td><td>{rate.provider || "模型默认"}</td><td>{{ task: "任务 / 调用", image: "张", second: "秒" }[rate.unit] || rate.unit}</td><td>{costMoney(rate.unit_cost_micros)}</td><td>{formatDateTime(rate.effective_at)}</td></tr>)}</tbody></table></div></AdminQueryState>
    </>}
    {costDialog && <UsageCostDialog task={costDialog === "rate" ? undefined : costDialog} onClose={() => setCostDialog(null)} onSaved={afterCostSaved} />}
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="sm:max-w-[700px]"><DialogHeader><DialogTitle>任务消耗详情</DialogTitle><DialogDescription>{detail?.job_id}</DialogDescription></DialogHeader>{detail && <dl className="usage-detail">{Object.entries({ 成员: `${detail.display_name || detail.username} (${detail.user_id})`, 项目: detail.project_name || detail.project_id || "未关联项目", 工作区: detail.workspace_id || "未记录", 任务类型: detail.task_type, 模型: detail.model || "未记录", 供应商: detail.provider || "未记录", 创建时间: formatDateTime(detail.created_at), 开始时间: detail.started_at ? formatDateTime(detail.started_at) : "—", 完成时间: detail.finished_at ? formatDateTime(detail.finished_at) : "—", 结算时间: detail.settled_at ? formatDateTime(detail.settled_at) : "—", 分辨率: detail.resolution || "未记录", 视频秒数: detail.duration_seconds || "—", 图片或输出数量: detail.output_count || "—", 执行次数: detail.attempts || "未记录", 待处理: formatUsagePendingState(detail) || "—", 积分冻结报价: detail.credits_quoted, 已扣积分: detail.credits_settled, 成本估算: costMoney(detail.estimated_cost_micros), 估算依据: detail.rate_id ? `${detail.cost_quantity} ${detail.cost_unit} · ${detail.rate_id}` : "无可用单价或用量", 实际费用: costMoney(detail.actual_cost_micros), 核对依据: detail.cost_reference || "尚未核对" }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</DialogContent></Dialog>
  </section>;
}

function UsagePendingStatus({ row }: { row: UsageRow }) {
  const label = formatUsagePendingState(row);
  return label ? <small>待处理：{label}</small> : null;
}
