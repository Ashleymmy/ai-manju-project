import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  RefreshCcw,
  Search,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { publicApiError } from "@/shared/api/errors";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import type { MonitoringController } from "../controllers/useMonitoringController";
import {
  exportMonitoring,
  type MonitoringRow,
} from "../services/runtimeMonitoringApi";
import { formatDuration, formatTime } from "../model/format";
import "./monitoring.css";

export const MONITOR_SOURCES: Record<string, string> = {
  api: "接口异常",
  ai: "AI 调用",
  job: "任务结果",
  worker: "生成尝试",
  client: "页面异常",
};
export const MONITOR_STATUSES: Record<string, string> = {
  error: "失败",
  success: "成功",
  queued: "排队中",
  running: "处理中",
  canceled: "已取消",
};
// Revoke downloads after the browser has consumed the object URL.
const DOWNLOAD_RELEASE_MS = 1000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const localDateInput = (date: string) => {
  const value = new Date(date);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export function MonitoringPanel({
  controller: c,
}: {
  controller: MonitoringController;
}) {
  const [detail, setDetail] = useState<MonitoringRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [start, setStart] = useState(() => localDateInput(c.filters.start));
  const [end, setEnd] = useState(() => localDateInput(c.filters.end));
  const scope = `${c.canViewAll}:${c.filters.user_id}`;
  useEffect(() => setDetail(null), [scope]);
  const report = c.monitoring;
  const stats = report?.stats;
  const pages = Math.max(
    1,
    Math.ceil((report?.total || 0) / c.filters.page_size)
  );
  const exportCSV = async () => {
    setExporting(true);
    try {
      const result = await exportMonitoring(c.filters);
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `运行监控-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_RELEASE_MS);
      toast.success(`已导出 ${result.total} 条记录`);
    } catch (error) {
      toast.error(publicApiError(error, "导出失败"));
    } finally {
      setExporting(false);
    }
  };
  const copyDetail = async () => {
    const result = await copyTextToClipboard(JSON.stringify(detail, null, 2));
    if (result === "copied") toast.success("已复制诊断信息");
    else toast.error("复制失败");
  };
  return (
    <section className="runtime-monitor">
      <header className="runtime-monitor-head">
        <div>
          <h2>运行监控</h2>
          <small>
            {c.canViewAll && !c.filters.user_id ? "全局记录" : "用户记录"} ·{" "}
            {report ? `更新于 ${formatTime(report.generated_at)}` : "等待数据"}
          </small>
        </div>
        <div className="runtime-monitor-actions">
          <label className="runtime-monitor-toggle">
            <input
              type="checkbox"
              checked={c.autoRefresh}
              onChange={e => c.setAutoRefresh(e.target.checked)}
            />
            自动刷新
          </label>
          <button
            title="刷新"
            aria-label="刷新监控"
            disabled={c.refreshing}
            onClick={() => void c.refresh()}
          >
            <RefreshCcw size={17} className={c.refreshing ? "spin" : ""} />
          </button>
          <button
            title="导出全部筛选记录"
            aria-label="导出全部筛选记录"
            disabled={!report || !!c.error || exporting}
            onClick={() => void exportCSV()}
          >
            {exporting ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Download size={17} />
            )}
          </button>
        </div>
      </header>
      <form
        className="runtime-monitor-filters"
        onSubmit={e => {
          e.preventDefault();
          if (c.hours === 0) {
            const duration = Date.parse(end) - Date.parse(start);
            if (
              !Number.isFinite(duration) ||
              duration <= 0 ||
              duration > MAX_WINDOW_MS
            ) {
              toast.error("请选择有效时间，单次查询不超过 30 天");
              return;
            }
            c.updateFilters({
              q: search.trim(),
              model: model.trim(),
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
            });
          } else c.updateFilters({ q: search.trim(), model: model.trim() });
        }}
      >
        <label>
          时间范围
          <select
            value={c.hours}
            onChange={e => c.setHours(Number(e.target.value))}
          >
            {[
              [1, "最近 1 小时"],
              [24, "最近 24 小时"],
              [168, "最近 7 天"],
              [720, "最近 30 天"],
              [0, "自定义时间"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {c.hours === 0 && (
          <>
            <label>
              开始时间
              <input
                type="datetime-local"
                value={start}
                onChange={e => setStart(e.target.value)}
                required
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={end}
                onChange={e => setEnd(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {c.canViewAll && (
          <label>
            用户
            <select
              value={c.filters.user_id}
              onChange={e => c.updateFilters({ user_id: e.target.value })}
            >
              <option value="">全部用户</option>
              {c.users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.username} ({user.username})
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          来源
          <select
            value={c.filters.source}
            onChange={e =>
              c.updateFilters({ source: e.target.value, code: "" })
            }
          >
            <option value="">全部来源</option>
            {Object.entries(MONITOR_SOURCES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            value={c.filters.status}
            onChange={e => c.updateFilters({ status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(MONITOR_STATUSES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          错误码
          <select
            value={c.filters.code}
            onChange={e => c.updateFilters({ code: e.target.value })}
          >
            <option value="">全部错误码</option>
            {c.filters.code &&
              !report?.codes.some(item => item.key === c.filters.code) && (
                <option>{c.filters.code}</option>
              )}
            {report?.codes.map(item => (
              <option key={item.key} value={item.key}>
                {item.key} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          模型
          <input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="全部模型"
            maxLength={256}
          />
        </label>
        <label className="runtime-monitor-search">
          关键词
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="错误、请求 / 任务编号"
            maxLength={512}
          />
        </label>
        <button type="submit" title="查询" aria-label="查询监控">
          <Search size={17} />
        </button>
      </form>
      {c.usersError && (
        <p role="alert">
          用户列表加载失败{" "}
          <button onClick={() => void c.reloadUsers()}>重试</button>
        </p>
      )}
      {c.error ? (
        <div role="alert" className="runtime-monitor-empty">
          {publicApiError(c.error, "监控数据读取失败")}
          <button onClick={() => void c.refresh()}>重试</button>
        </div>
      ) : c.isPending ? (
        <div role="status" className="runtime-monitor-empty">
          <Loader2 size={22} className="spin" />
          正在读取监控记录
        </div>
      ) : (
        report && (
          <>
            <div className="runtime-monitor-stats">
              <div>
                <span>错误记录</span>
                <strong className="runtime-monitor-red">
                  {stats?.errors.toLocaleString()}
                </strong>
              </div>
              <div>
                <span>成功记录</span>
                <strong>{stats?.successes.toLocaleString()}</strong>
              </div>
              <div>
                <span>排队 / 处理中</span>
                <strong>{stats?.pending.toLocaleString()}</strong>
              </div>
              <div>
                <span>已取消</span>
                <strong>{stats?.canceled.toLocaleString()}</strong>
              </div>
              {c.canViewAll && (
                <div>
                  <span>受影响用户</span>
                  <strong>{stats?.affected_users.toLocaleString()}</strong>
                </div>
              )}
              <div>
                <span>平均耗时</span>
                <strong>
                  {formatDuration(stats?.average_duration_ms || 0)}
                </strong>
              </div>
            </div>
            <div className="runtime-monitor-charts">
              <div className="runtime-monitor-trend">
                <h3>错误趋势</h3>
                <div className="runtime-monitor-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={report.buckets}
                      margin={{ top: 10, right: 10, bottom: 0, left: -20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        minTickGap={36}
                        tickFormatter={value =>
                          new Date(value).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        }
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip
                        labelFormatter={value => formatTime(String(value))}
                      />
                      <Area
                        type="monotone"
                        dataKey="errors"
                        name="错误记录"
                        stroke="#dc5656"
                        fill="#dc5656"
                        fillOpacity={0.12}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="runtime-monitor-distribution">
                <h3>错误来源</h3>
                {report.sources.length ? (
                  report.sources.map(item => (
                    <div key={item.key}>
                      <span>{MONITOR_SOURCES[item.key] || item.key}</span>
                      <strong>{item.count}</strong>
                      <progress
                        max={Math.max(1, stats?.errors || 0)}
                        value={item.count}
                      />
                    </div>
                  ))
                ) : (
                  <p>当前范围没有错误</p>
                )}
              </div>
            </div>
            <div className="runtime-monitor-listhead">
              <h3>
                运行明细 <small>{report.total.toLocaleString()} 条</small>
              </h3>
              <span>
                {formatTime(report.start)} 至 {formatTime(report.end)}
              </span>
            </div>
            <div className="runtime-monitor-table">
              <table>
                <thead>
                  <tr>
                    <th>时间 / 来源</th>
                    {c.canViewAll && <th>用户</th>}
                    <th>操作 / 模型</th>
                    <th>状态</th>
                    <th>错误信息</th>
                    <th>耗时 / 尝试</th>
                    <th>
                      <span className="sr-only">详情</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map(row => (
                    <tr key={`${row.source}:${row.id}`}>
                      <td>
                        <time>{formatTime(row.created_at)}</time>
                        <small>
                          {MONITOR_SOURCES[row.source] || row.source}
                        </small>
                      </td>
                      {c.canViewAll && (
                        <td>
                          {row.display_name || row.username || row.user_id || "未登录 / 系统"}
                          <small>{row.username}</small>
                        </td>
                      )}
                      <td>
                        {row.operation || "未记录"}
                        <small>{row.model || "未指定模型"}</small>
                      </td>
                      <td>
                        <span
                          className={`runtime-monitor-status status-${row.status}`}
                        >
                          {MONITOR_STATUSES[row.status] || row.status}
                        </span>
                        {row.http_status > 0 && (
                          <small>HTTP {row.http_status}</small>
                        )}
                      </td>
                      <td className="runtime-monitor-message">
                        <span title={row.message}>
                          {row.message ||
                            (row.status === "error"
                              ? "未记录错误详情"
                              : "无错误")}
                        </span>
                        <small>
                          {row.error_code ||
                            row.job_id ||
                            row.request_id ||
                            "-"}
                        </small>
                      </td>
                      <td>
                        {formatDuration(row.duration_ms)}
                        <small>
                          {row.attempt > 0 ? `第 ${row.attempt} 次` : "-"}
                        </small>
                      </td>
                      <td>
                        <button
                          onClick={() => setDetail(row)}
                          aria-label={`查看详情 ${row.id}`}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.items.length && (
                <div className="runtime-monitor-empty">
                  当前筛选条件下没有记录
                </div>
              )}
            </div>
            <footer className="runtime-monitor-pagination">
              <span>
                第 {c.filters.page} / {pages} 页
              </span>
              <button
                title="上一页"
                aria-label="上一页"
                disabled={c.filters.page <= 1 || c.refreshing}
                onClick={() => c.setPage(c.filters.page - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                title="下一页"
                aria-label="下一页"
                disabled={c.filters.page >= pages || c.refreshing}
                onClick={() => c.setPage(c.filters.page + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </footer>
          </>
        )
      )}
      <Dialog
        open={!!detail}
        onOpenChange={open => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="runtime-monitor-dialog">
          <DialogHeader>
            <DialogTitle>运行记录详情</DialogTitle>
            <DialogDescription>
              {detail
                ? `${formatTime(detail.created_at)} · ${MONITOR_SOURCES[detail.source] || detail.source}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <dl>
                {Object.entries({
                  用户:
                    detail.display_name ||
                    detail.username ||
                    detail.user_id ||
                    "未登录 / 系统",
                  状态: MONITOR_STATUSES[detail.status] || detail.status,
                  操作: detail.operation,
                  模型: detail.model,
                  错误码: detail.error_code,
                  错误信息: detail.message,
                  诊断详情: detail.detail,
                  处理建议: detail.suggestion,
                  接口: `${detail.method || ""} ${detail.endpoint || ""}`.trim(),
                  "HTTP 状态": detail.http_status || "",
                  上游状态: detail.provider_status || "",
                  请求编号: detail.request_id,
                  任务编号: detail.job_id,
                  项目编号: detail.project_id,
                  节点编号: detail.node_id,
                  尝试次数: detail.attempt || "",
                  耗时: formatDuration(detail.duration_ms),
                }).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value || "未记录"}</dd>
                  </div>
                ))}
              </dl>
              <button
                className="outline-button"
                onClick={() => void copyDetail()}
              >
                <Copy size={16} />
                复制诊断信息
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
