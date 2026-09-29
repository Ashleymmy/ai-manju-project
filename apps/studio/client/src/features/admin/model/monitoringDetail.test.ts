import { expect, it } from "vitest";
import {
  monitoringDetailFields,
  monitoringAdditionalFields,
} from "./monitoringDetail";
import type { MonitoringRow } from "../services/runtimeMonitoringApi";

// The screenshot's fixed fields follow User/Status, rendered by the dialog.
const originalLabels = [
  "操作",
  "模型",
  "错误码",
  "错误信息",
  "诊断详情",
  "处理建议",
  "接口",
  "HTTP 状态",
  "上游状态",
  "请求编号",
  "任务编号",
  "项目编号",
  "节点编号",
  "尝试次数",
  "耗时",
];
const valueOf = (row: MonitoringRow, label: string) =>
  monitoringDetailFields(row).find(field => field.label === label)?.value;

it.each(["api", "client", "ai", "worker", "job"])(
  "retains every original field in the original order for sparse %s records",
  source => {
    const row = { source, duration_ms: 0 } as MonitoringRow;
    const fields = monitoringDetailFields(row);
    expect(fields.map(field => field.label)).toEqual(originalLabels);
    expect(fields.every(field => field.value === "未记录")).toBe(true);
    expect(
      fields.filter(field => field.wide).map(field => field.label)
    ).toEqual(["错误信息", "诊断详情", "处理建议"]);
    expect(monitoringAdditionalFields(row)).toEqual([]);
  }
);

it("keeps the screenshot's 404 error, interface and request ID while retaining empty fields", () => {
  const row = {
    source: "api",
    operation: "GET /api/admin/generation-recovery",
    endpoint: "/api/admin/generation-recovery",
    method: "GET",
    http_status: 404,
    error_code: "http_404",
    message: "Not Found",
    request_id: "actual-request",
    duration_ms: 0,
  } as MonitoringRow;
  expect(valueOf(row, "错误信息")).toBe("Not Found");
  expect(valueOf(row, "HTTP 状态")).toBe(404);
  expect(valueOf(row, "请求编号")).toBe("actual-request");
  expect(valueOf(row, "接口")).toBe("GET /api/admin/generation-recovery");
  for (const label of [
    "模型",
    "诊断详情",
    "处理建议",
    "上游状态",
    "任务编号",
    "项目编号",
    "节点编号",
    "尝试次数",
  ])
    expect(valueOf(row, label)).toBe("未记录");
});

it("distinguishes a measured zero from an unrecorded duration without hiding fields", () => {
  const row = {
    source: "client",
    duration_ms: 0,
    diagnostics: {
      stage: "request_timeout",
      response_received: false,
      timeout_ms: 15000,
      exception_message: "aborted",
    },
    request_id: "original",
  } as MonitoringRow;
  expect(valueOf(row, "HTTP 状态")).toBe("未收到 HTTP 响应");
  expect(valueOf(row, "请求编号")).toBe("original");
  expect(valueOf(row, "节点编号")).toBe("未记录");
  expect(valueOf(row, "耗时")).toBe("0 ms");
  expect(valueOf(row, "诊断详情")).toBe("aborted");
  expect(valueOf({ ...row, diagnostics: undefined }, "耗时")).toBe("未记录");
  const pageError = { ...row, diagnostics: { stage: "client_exception" } };
  expect(monitoringDetailFields(pageError).map(field => field.label)).toEqual(
    originalLabels
  );
  expect(valueOf(pageError, "耗时")).toBe("未记录");
});

it("keeps existing content intact and appends every available upstream observation", () => {
  const row = {
    source: "worker",
    operation: "generate",
    model: "selected-model",
    error_code: "failure",
    message: "original message",
    detail: "original detail",
    suggestion: "original suggestion",
    method: "POST",
    endpoint: "/api/generate",
    http_status: 502,
    provider_status: 422,
    request_id: "original",
    job_id: "job",
    project_id: "project",
    node_id: "node",
    attempt: 2,
    duration_ms: 500,
    diagnostics: {
      stage: "provider_response",
      provider_body: "<script>actual upstream error</script>",
      provider_request_id: "vendor-id",
      exception_message: "actual exception",
    },
  } as MonitoringRow;
  expect(monitoringDetailFields(row).map(field => field.value)).toEqual([
    "generate",
    "selected-model",
    "failure",
    "original message",
    "original detail",
    "original suggestion",
    "POST /api/generate",
    502,
    422,
    "original",
    "job",
    "project",
    "node",
    2,
    "500 ms",
  ]);
  const additional = monitoringAdditionalFields(row);
  expect(
    additional.find(field => field.label === "上游响应摘要（已脱敏）")?.value
  ).toBe("<script>actual upstream error</script>");
  expect(
    additional.find(field => field.label === "原始异常信息（已脱敏）")?.value
  ).toBe("actual exception");
});

it("does not suppress a recorded upstream body just because status or URL is missing", () => {
  const row = {
    diagnostics: { provider_body: "actual rejection" },
  } as MonitoringRow;
  expect(valueOf(row, "诊断详情")).toBe("actual rejection");
  expect(
    monitoringAdditionalFields(row).find(
      field => field.label === "上游响应摘要（已脱敏）"
    )?.value
  ).toBe("actual rejection");
});

it("explains permissions without removing the original fields", () => {
  const row = {
    duration_ms: 20,
    diagnostics_restricted: true,
  } as MonitoringRow;
  expect(monitoringDetailFields(row).map(field => field.label)).toEqual(
    originalLabels
  );
  expect(valueOf(row, "诊断详情")).toBe("详细诊断仅超级管理员可见");
  expect(valueOf(row, "上游状态")).toBe("详细诊断仅超级管理员可见");
});
