import { RefreshCcw } from "lucide-react";

import type { MonitoringController } from "../controllers/useMonitoringController";
import { formatDuration, formatTime } from "../model/format";

export function MonitoringPanel({
  controller,
}: {
  controller: MonitoringController;
}) {
  const {
    averageDuration,
    errorRate,
    hours,
    latestErrors,
    monitoring,
    refresh,
    refreshing,
    setHours,
    successRate,
    summary,
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">MONITORING / LIVE</p>
          <h2>系统运行监控</h2>
          <small>
            {monitoring?.generated_at
              ? `更新于 ${formatTime(monitoring.generated_at)}`
              : "等待监控数据"} {" "}
            · {refreshing ? "后台刷新中" : "15 秒自动刷新"}
          </small>
        </div>
        <div className="monitor-actions">
          <select
            value={hours}
            onChange={event => setHours(Number(event.target.value))}
          >
            <option value={1}>最近 1 小时</option>
            <option value={24}>最近 24 小时</option>
            <option value={168}>最近 7 天</option>
            <option value={720}>最近 30 天</option>
          </select>
          <button
            className="outline-button small"
            onClick={() => void refresh()}
          >
            <RefreshCcw className={refreshing ? "spin" : ""} size={15} /> 刷新
          </button>
        </div>
      </div>
      <div className="monitor-grid">
        <div>
          <span>数据库</span>
          <b>{monitoring?.health.db || "-"}</b>
          <em className={monitoring?.health.db_ok ? "healthy" : "watch"}>
            {monitoring?.health.db_ok ? "正常" : "异常"}
          </em>
        </div>
        <div>
          <span>请求总数</span>
          <b>{summary?.total_requests.toLocaleString("zh-CN") || 0}</b>
          <em className="healthy">{hours}h</em>
        </div>
        <div>
          <span>成功率</span>
          <b>{successRate.toFixed(1)}%</b>
          <em className={successRate >= 95 ? "healthy" : "watch"}>success</em>
        </div>
        <div>
          <span>失败率</span>
          <b>{errorRate.toFixed(1)}%</b>
          <em className={errorRate > 5 ? "watch" : "healthy"}>errors</em>
        </div>
        <div>
          <span>平均耗时</span>
          <b>{formatDuration(averageDuration)}</b>
          <em className="healthy">latency</em>
        </div>
        <div>
          <span>产物数</span>
          <b>{summary?.total_output_count.toLocaleString("zh-CN") || 0}</b>
          <em className="healthy">outputs</em>
        </div>
        <div>
          <span>消耗单位</span>
          <b>{summary?.total_units.toLocaleString("zh-CN") || 0}</b>
          <em className="healthy">units</em>
        </div>
        <div>
          <span>最近请求</span>
          <b>
            {summary?.latest_request_time
              ? formatTime(summary.latest_request_time)
              : "-"}
          </b>
          <em className="healthy">latest</em>
        </div>
      </div>
      <div className="monitor-storage-grid">
        <span>
          用户 <b>{monitoring?.storage_stats.users || 0}</b>
        </span>
        <span>
          画布 <b>{monitoring?.storage_stats.projects || 0}</b>
        </span>
        <span>
          快照 <b>{monitoring?.storage_stats.snapshots || 0}</b>
        </span>
        <span>
          素材 <b>{monitoring?.storage_stats.assets || 0}</b>
        </span>
        <span>
          AI 记录 <b>{monitoring?.storage_stats.ai_requests || 0}</b>
        </span>
      </div>
      <div className="monitor-detail-grid">
        <div className="monitor-data-panel">
          <p className="eyebrow">MEMBER USAGE</p>
          {monitoring?.users.length ? (
            monitoring.users.map(item => (
              <div key={item.user_id || item.username}>
                <span>
                  <b>{item.user_display_name || item.username || "未知用户"}</b>
                  <small>
                    {item.last_request_at
                      ? formatTime(item.last_request_at)
                      : "暂无最近请求"}
                  </small>
                </span>
                <em>
                  {item.requests || 0} 请求 · {item.outputs || 0} 产物 · {item.errors || 0} 错误
                </em>
              </div>
            ))
          ) : (
            <small>暂无成员使用数据</small>
          )}
        </div>
        <div className="monitor-data-panel">
          <p className="eyebrow">MODEL USAGE</p>
          {monitoring?.models.length ? (
            monitoring.models.map(item => (
              <div key={`${item.model}-${item.operation}`}>
                <span>
                  <b>{item.model || "未指定模型"}</b>
                  <small>
                    {item.operation || "unknown"} · {formatDuration(item.avg_duration_ms || 0)}
                  </small>
                </span>
                <em>
                  {item.requests || 0} 请求 · {item.outputs || 0} 产物 · {item.errors || 0} 错误
                </em>
              </div>
            ))
          ) : (
            <small>暂无模型统计</small>
          )}
        </div>
        <div className="monitor-data-panel">
          <p className="eyebrow">RECENT FAILURES</p>
          {latestErrors.length ? (
            latestErrors.map(item => (
              <div key={item.id}>
                <span>
                  <b>
                    {item.operation} · {item.model}
                  </b>
                  <small>
                    {item.error_message || `HTTP ${item.http_status || 0}`}
                  </small>
                </span>
                <em>{formatTime(item.created_at)}</em>
              </div>
            ))
          ) : (
            <small>当前窗口没有失败请求</small>
          )}
        </div>
        <div className="monitor-data-panel monitor-log-tail">
          <p className="eyebrow">BACKEND LOG TAIL</p>
          {monitoring?.logs.length ? (
            monitoring.logs.slice(-60).map((item, index) => (
              <div key={`${item.source}-${index}`}>
                <code>{item.source}</code>
                <small>{item.line}</small>
              </div>
            ))
          ) : (
            <small>暂无日志尾部数据</small>
          )}
        </div>
      </div>
    </section>
  );
}
