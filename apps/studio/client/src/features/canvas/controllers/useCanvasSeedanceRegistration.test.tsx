// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getUserSeedanceAsset, uploadUserSeedanceAsset, type SeedanceAsset } from "@/entities/asset";
import type { CanvasNodeData } from "../domain/types";
import { seedanceRegistrationKey } from "../services/seedanceRegistration";
import { useCanvasSeedanceRegistration } from "./useCanvasSeedanceRegistration";

vi.mock("@/entities/asset", () => ({ getUserSeedanceAsset: vi.fn(), uploadUserSeedanceAsset: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(() => "notice"), success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const active: SeedanceAsset = { id: "record", name: "角色", volcano_asset_id: "remote", status: "Active", asset_type: "Image" };
const pending = { ...active, volcano_asset_id: "", status: "Processing" };
const node: CanvasNodeData = { id: "image", kind: "image", title: "角色", content: "", x: 0, y: 0, width: 200, height: 200, imageAssetId: "source" };
const second = { ...node, id: "second", title: "角色二" };
const key = seedanceRegistrationKey("project", node);
let context: { projectKey: string; scope: "personal"; switching: boolean; nodes: CanvasNodeData[] };
let root: ReturnType<typeof createRoot>;
let current: ReturnType<typeof useCanvasSeedanceRegistration>;
let container: HTMLDivElement;
let task: Promise<void>;
const onUpdate = vi.fn(async (source: CanvasNodeData, asset: SeedanceAsset, providerId?: string) => {
  context.nodes = context.nodes.map(item => item.id === source.id ? {
    ...item, metadata: { ...item.metadata, seedanceVolcanoAssets: [{ id: asset.id, providerId, volcanoAssetId: asset.volcano_asset_id, status: asset.status }] },
  } : item);
});
const loadFile = vi.fn(async () => new File(["image"], "hero.png", { type: "image/png" }));
function Probe() {
  current = useCanvasSeedanceRegistration({ getContext: () => context, onUpdate, loadFile });
  return current.target ? <div role="dialog"><button onClick={() => { task = current.submit(); }}>后台注册</button></div> : <button>继续创作</button>;
}
async function open(nodeId = node.id) {
  await act(async () => current.setTarget({ nodeId, model: "official::seedance", projectKey: context.projectKey }));
}
async function submit() {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  context = { projectKey: "project", scope: "personal", switching: false, nodes: [node, second] };
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("closes immediately while the upload is unresolved, prevents duplicate submits, then notifies success", async () => {
  const upload = deferred<SeedanceAsset>();
  vi.mocked(uploadUserSeedanceAsset).mockReturnValue(upload.promise);
  vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
  await open();
  const submitAgain = current.submit;
  await submit();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toBe("继续创作");
  expect(current.states[key].phase).toBe("uploading");
  await act(async () => { await submitAgain(); });
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => upload.resolve(pending));
  expect(current.states[key].phase).toBe("processing");
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await task; });
  expect(current.states[key].phase).toBe("success");
  expect(context.nodes[0].metadata?.seedanceVolcanoAssets?.[0].volcanoAssetId).toBe("remote");
  expect(toast.success).toHaveBeenCalledWith("拟真人素材注册成功", expect.objectContaining({ description: expect.stringContaining("角色") }));
  expect(current.isRegistering("project", node)).toBe(false);
});

it("leaves a subsequently opened dialog alone when an earlier task fails and allows a retry", async () => {
  const upload = deferred<SeedanceAsset>();
  vi.mocked(uploadUserSeedanceAsset).mockReturnValueOnce(upload.promise).mockResolvedValue(active);
  await open(); await submit();
  await open(second.id);
  await act(async () => { upload.reject(new Error("network unavailable")); await task; });
  expect(current.target?.nodeId).toBe(second.id);
  expect(current.states[key].phase).toBe("error");
  expect(toast.error).toHaveBeenCalledOnce();
  expect(current.isRegistering("project", node)).toBe(false);
  await open(); await submit();
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(2);
  expect(current.states[key].phase).toBe("success");
});

it("permits two different nodes to register and keeps the second dialog open when the first finishes", async () => {
  const upload = deferred<SeedanceAsset>();
  vi.mocked(uploadUserSeedanceAsset).mockReturnValueOnce(upload.promise).mockResolvedValue(active);
  await open(); await submit();
  const firstTask = task;
  await open(second.id); await submit();
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(2);
  expect(current.isRegistering("project", node)).toBe(true);
  expect(current.isRegistering("project", second)).toBe(false);
  await open(second.id);
  await act(async () => { upload.resolve(active); await firstTask; });
  expect(current.target?.nodeId).toBe(second.id);
});

it.each(["project switch", "image replacement", "node deletion", "unmount"])("continues notifying in the background without writing stale node data after %s", async change => {
  const upload = deferred<SeedanceAsset>();
  vi.mocked(uploadUserSeedanceAsset).mockReturnValue(upload.promise);
  vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
  await open(); await submit();
  if (change === "project switch") context.projectKey = "other-project";
  if (change === "image replacement") context.nodes = [{ ...node, imageAssetId: "replacement" }];
  if (change === "node deletion") context.nodes = [];
  if (change === "unmount") await act(async () => root.render(null));
  await act(async () => upload.resolve(pending));
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await task; });
  expect(onUpdate).not.toHaveBeenCalled();
  expect(getUserSeedanceAsset).toHaveBeenCalledWith(active.id, "personal", "official");
  expect(toast.success).toHaveBeenCalledOnce();
  if (change !== "unmount") expect(current.states[key]).toBeUndefined();
});

it("keeps monitoring a slow registration beyond thirty seconds and resumes a saved record instead of uploading", async () => {
  context.nodes = [{ ...node, metadata: { seedanceVolcanoAssets: [{ id: pending.id, providerId: "official", volcanoAssetId: "", status: "Processing" }] } }];
  vi.mocked(getUserSeedanceAsset).mockResolvedValue(pending);
  await open(); await submit();
  await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
  expect(current.states[key].phase).toBe("processing");
  vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await task; });
  expect(toast.success).toHaveBeenCalledOnce();
  expect(uploadUserSeedanceAsset).not.toHaveBeenCalled();
});

it.each([false, true])("locks the full batch, limits concurrency and completes queued work after switching=%s", async switching => {
  context.nodes = Array.from({ length: 5 }, (_, index) => ({ ...node, id: `batch-${index}` }));
  const upload = deferred<SeedanceAsset>();
  vi.mocked(uploadUserSeedanceAsset).mockReturnValue(upload.promise);
  await act(async () => current.setTarget({ nodeId: context.nodes[0].id, nodeIds: context.nodes.map(item => item.id), model: "official::seedance", projectKey: "project" }));
  const submitAgain = current.submit;
  await submit();
  expect(current.target).toBeNull();
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(3);
  expect(context.nodes.every(item => current.isRegistering("project", item))).toBe(true);
  expect(current.states[seedanceRegistrationKey("project", context.nodes[4])].phase).toBe("queued");
  await act(async () => { await submitAgain(); });
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(3);
  if (switching) context.projectKey = "other-project";
  await act(async () => { upload.resolve(active); await task; });
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(5);
  expect(onUpdate).toHaveBeenCalledTimes(switching ? 0 : 5);
  expect(context.nodes.every(item => !current.isRegistering("project", item))).toBe(true);
  expect(toast.success).toHaveBeenCalledWith("拟真人素材批量注册完成", expect.objectContaining({ description: expect.stringContaining("成功 5 张") }));
});

it("continues after one failure, skips registrations on the same provider and retries only the failed image", async () => {
  const registered = { ...node, id: "registered", metadata: { seedanceVolcanoAssets: [{ id: active.id, providerId: "official", volcanoAssetId: "remote", status: "Active" }] } };
  context.nodes.push(registered);
  vi.mocked(uploadUserSeedanceAsset).mockRejectedValueOnce(new Error("upload failed")).mockResolvedValue(active);
  const batchTarget = { nodeId: node.id, nodeIds: context.nodes.map(item => item.id), model: "official::seedance", projectKey: "project", skippedCount: 2 };
  await act(async () => current.setTarget(batchTarget));
  await submit();
  await act(async () => { await task; });
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(2);
  expect(current.states[key].phase).toBe("error");
  expect(current.states[seedanceRegistrationKey("project", second)].phase).toBe("success");
  expect(toast.warning).toHaveBeenCalledWith("拟真人素材批量注册完成", expect.objectContaining({ description: expect.stringContaining("成功 1 张，处理中 0 张，失败 1 张，跳过 3 项") }));
  await act(async () => current.setTarget(batchTarget));
  await submit();
  await act(async () => { await task; });
  expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(3);
  expect(current.states[key].phase).toBe("success");
});
