import type { MonitoringRow } from "../services/runtimeMonitoringApi";
import { formatDuration } from "./format";

const STAGES: Record<string, string> = {
  client_exception: "页面执行异常",
  request_timeout: "浏览器等待请求超时",
  request_transport: "浏览器连接失败",
  response_read: "浏览器读取响应失败",
  gateway_response: "网关 / 服务返回错误",
  api_response: "API 返回错误",
  provider_call: "模型调用异常",
  provider_transport: "连接上游服务失败",
  provider_response: "已收到上游响应",
  bridge_response: "已收到视频服务响应",
  worker_execution: "后台任务执行异常",
};
export type DiagnosticField = {
  label: string;
  value: string | number;
  wide?: boolean;
};

export function monitoringDetailFields(row: MonitoringRow): DiagnosticField[] {
  const d = row.diagnostics || {};
  const missing = "未记录";
  const restricted = "详细诊断仅超级管理员可见";
  const detail =
    row.detail ||
    d.exception_message ||
    d.provider_body ||
    d.response_body ||
    d.stack;
  // Keep every original field and its order, including fields without values.
  // Missing observations must be explained, never hidden or invented.
  return [
    { label: "操作", value: row.operation || missing },
    { label: "模型", value: row.model || missing },
    { label: "错误码", value: row.error_code || missing },
    { label: "错误信息", value: row.message || missing, wide: true },
    {
      label: "诊断详情",
      value: detail || (row.diagnostics_restricted ? restricted : missing),
      wide: true,
    },
    { label: "处理建议", value: row.suggestion || missing, wide: true },
    {
      label: "接口",
      value: `${row.method || ""} ${row.endpoint || ""}`.trim() || missing,
    },
    {
      label: "HTTP 状态",
      value:
        row.http_status ||
        (d.response_received === false ? "未收到 HTTP 响应" : missing),
    },
    {
      label: "上游状态",
      value:
        row.provider_status ||
        (row.diagnostics_restricted
          ? restricted
          : d.provider_response_received === false
            ? "未收到上游响应"
            : missing),
    },
    { label: "请求编号", value: row.request_id || missing },
    { label: "任务编号", value: row.job_id || missing },
    { label: "项目编号", value: row.project_id || missing },
    { label: "节点编号", value: row.node_id || missing },
    { label: "尝试次数", value: row.attempt || missing },
    {
      label: "耗时",
      value:
        Number.isFinite(row.duration_ms) &&
        (row.duration_ms > 0 ||
          (row.duration_ms === 0 &&
            Boolean(d.stage) &&
            d.stage !== "client_exception"))
          ? formatDuration(row.duration_ms)
          : missing,
    },
  ];
}

// Additional observations follow the unchanged original details. They never
// replace the baseline fields, even for old records or permission restrictions.
export function monitoringAdditionalFields(
  row: MonitoringRow
): DiagnosticField[] {
  const d = row.diagnostics || {};
  const fields: DiagnosticField[] = [];
  const add = (
    label: string,
    value: string | number | undefined,
    wide = false
  ) => {
    if (value !== undefined && value !== "")
      fields.push({ label, value, wide });
  };
  if (d.stage || row.diagnostics_restricted)
    add(
      "采集阶段",
      row.diagnostics_restricted
        ? "详细诊断仅超级管理员可见"
        : d.stage
          ? STAGES[d.stage] || d.stage
          : "未记录"
    );
  add("发生页面", d.page_path);
  if (d.timeout_ms) add("请求超时设置", formatDuration(d.timeout_ms));
  if (d.online !== undefined)
    add(
      "浏览器网络状态",
      d.online ? "浏览器报告在线（不代表服务可达）" : "浏览器报告离线",
      true
    );
  add("原始异常类型", d.exception_name);
  add("原始异常信息（已脱敏）", d.exception_message, true);
  add("接口响应摘要（已脱敏）", d.response_body, true);
  if (
    d.provider_response_received !== undefined ||
    row.provider_status ||
    d.provider_url ||
    d.provider_method ||
    d.provider_code ||
    d.provider_request_id ||
    d.provider_body
  ) {
    add(
      "上游接口",
      `${d.provider_method || ""} ${d.provider_url || ""}`.trim(),
      true
    );
    add("上游错误码", d.provider_code);
    add("上游请求编号", d.provider_request_id || "上游未提供或未采集");
    add(
      "上游响应摘要（已脱敏）",
      d.provider_body ||
        (d.provider_response_received === false
          ? "连接阶段失败，没有上游响应内容"
          : "未采集到可保留的错误响应内容"),
      true
    );
  }
  add("日志上报编号", d.report_request_id);
  add("异常堆栈（已脱敏）", d.stack, true);
  return fields;
}
