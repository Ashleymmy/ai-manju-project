// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetExportBatch } from "@/entities/asset";
import { AssetTransferStatus } from "./AssetTransferStatus";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderFailure(error: AssetExportBatch["error"]) {
  const batch: AssetExportBatch = { id: "failed-export", status: "failed", selection_mode: "folder", total: 35, succeeded: 32, failed: 3, size: 0, error };
  await act(async () => root.render(<AssetTransferStatus batches={[batch]} progress={null} warnings={[]} importing={false} canPause={false} canRetry={false} onRetry={vi.fn()} onPause={vi.fn()} onDismiss={vi.fn()} onDownload={vi.fn()} onCancel={vi.fn()} />));
  return container.querySelector('[role="status"]')?.textContent;
}

it("explains the API's structured disk-full failure instead of hiding it", async () => {
  expect(await renderFailure({ message: "write /tmp/ai-manju-asset-export-123.zip: no space left on device" })).toContain("打包临时空间不足");
  expect(container.textContent).toContain("3 项失败");
  expect(container.textContent).not.toContain("/tmp/");
});

it("retains useful legacy string errors and handles missing details", async () => {
  expect(await renderFailure("素材存储暂不可用")).toBe("素材存储暂不可用");
  expect(await renderFailure({})).toContain("服务未返回详细原因");
});

it("distinguishes upload limits from transfer timeouts", async () => {
  expect(await renderFailure({ message: "Storage request failed (HTTP 413)" })).toContain("存储服务的大小限制");
  expect(await renderFailure({ message: "context deadline exceeded" })).toContain("素材传输超时");
});
