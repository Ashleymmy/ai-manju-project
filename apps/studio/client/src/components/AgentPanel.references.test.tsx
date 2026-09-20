// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas-agent";

const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn(), getAssetContentBlob: vi.fn() }));
vi.mock("@/services/api/ai", () => ({ fetchAiModels: mocks.fetchAiModels, requestAiText: mocks.requestAiText }));
vi.mock("@/entities/asset", () => ({ getAssetContentBlob: mocks.getAssetContentBlob, getAssetMediaUrl: (id: string) => `/api/assets/${id}/content` }));
import AgentPanel from "./AgentPanel";

const snapshot: CanvasAgentSnapshot = {
  projectId: "references-project", title: "References", connections: [], viewport: { x: 0, y: 0, k: 1 }, selectedNodeIds: ["a"],
  nodes: ["a", "b"].map(id => ({ id, type: "image", title: `Image ${id}`, imageAssetId: `asset-${id}`, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { assetScope: "team" } })),
};
const toolReply = { content: "Generate", toolCalls: [{ id: "call-1", type: "function", function: { name: "canvas_generate_image", arguments: JSON.stringify({ prompt: "New scene" }) } }] };

describe("AgentPanel selected references", () => {
  let root: Root;
  let container: HTMLDivElement;
  let onApplyOps: ReturnType<typeof vi.fn>;
  let referenceSelection: { projectId: string; nodeIds: string[] } | undefined;
  const draft = () => container.querySelector('[aria-label="本次引用"]');
  async function render(current = snapshot, selectedIds?: string[], open = true) {
    if (selectedIds) referenceSelection = { projectId: current.projectId, nodeIds: selectedIds };
    await act(async () => root.render(<AgentPanel projectId={current.projectId} snapshot={current} referenceSelection={referenceSelection} open={open} onClose={vi.fn()} canUndoOps={false} onApplyOps={onApplyOps} onExecuteWorkspaceTool={vi.fn()} onUndoOps={vi.fn()} />));
  }
  async function click(selector: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
  }
  async function send(text = "Use this image") {
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[aria-label="发送"]');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    referenceSelection = undefined;
    mocks.fetchAiModels.mockReset().mockResolvedValue({ agentTextModels: ["provider::gpt-5.5"], defaultTextModel: "provider::gpt-5.5", modelLabels: {}, modelProviderNames: {} });
    mocks.requestAiText.mockReset().mockResolvedValue({ content: "Done", toolCalls: [] });
    mocks.getAssetContentBlob.mockReset().mockResolvedValue(new Blob(["reference-image"], { type: "image/png" }));
    onApplyOps = vi.fn(async ops => ({ snapshot: applyCanvasAgentOps(snapshot, ops), generationResults: [] }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("retains accumulated references after deselection and re-adds a removed node on click", async () => {
    await render({ ...snapshot, selectedNodeIds: ["a", "b", "a"] });
    expect(draft()?.querySelectorAll("img")).toHaveLength(2);
    await click('[aria-label="移除引用：Image a"]');
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    await render({ ...snapshot, selectedNodeIds: [] });
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    await render(snapshot, ["a"]);
    expect([...draft()!.querySelectorAll("img")].map(image => image.alt)).toEqual(["Image b", "Image a"]);
    await render({ ...snapshot, nodes: [] });
    expect(draft()).toBeNull();
  });

  it("accumulates ordinary clicks in order, deduplicates and hides image/video names", async () => {
    const mixed = { ...snapshot, nodes: [...snapshot.nodes, { ...snapshot.nodes[0], id: "video", type: "video", title: "Video clip", imageAssetId: "video-asset" }] };
    await render({ ...mixed, selectedNodeIds: [] });
    await render({ ...mixed, selectedNodeIds: ["b"] }, ["b"]);
    await render(mixed, ["a"]);
    await render({ ...mixed, selectedNodeIds: ["video"] }, ["video"]);
    await render(mixed, ["a"]);
    expect([...draft()!.querySelectorAll(".agent-reference")].map(element => element.getAttribute("data-reference-node"))).toEqual(["b", "a", "video"]);
    expect(draft()?.querySelectorAll(".agent-reference-title")).toHaveLength(0);
    expect(draft()?.textContent).toBe("");
    expect(draft()?.querySelector('[data-reference-node="video"] img')?.getAttribute("src")).toContain("poster=1");
    await send();
    expect(mocks.getAssetContentBlob.mock.calls.map(call => call[0])).toEqual(["asset-b", "asset-a"]);
    expect(JSON.stringify(mocks.requestAiText.mock.calls[0][0].messages.at(-1).content)).toContain("@[node:video]");
  });

  it("does not accumulate programmatic output selection, deleted nodes or hidden-panel clicks", async () => {
    await render();
    await render({ ...snapshot, selectedNodeIds: ["b"] });
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    await render({ ...snapshot, selectedNodeIds: ["b"] }, ["b"], false);
    await render(snapshot, undefined, true);
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    await render({ ...snapshot, nodes: [snapshot.nodes[1]], selectedNodeIds: [] });
    expect(draft()).toBeNull();
  });

  it("sends image bytes with the node ID and freezes references through tool confirmation", async () => {
    mocks.requestAiText.mockResolvedValueOnce(toolReply);
    await render();
    await send();
    expect(mocks.getAssetContentBlob).toHaveBeenCalledWith("asset-a", "team", 640, expect.any(AbortSignal));
    const content = mocks.requestAiText.mock.calls[0][0].messages.at(-1).content;
    expect(content).toContainEqual({ type: "image_url", image_url: { url: "data:image/png;base64,cmVmZXJlbmNlLWltYWdl" } });
    expect(JSON.stringify(content)).toContain("@[node:a]");
    expect(container.querySelector('[aria-label="消息引用"] img')).not.toBeNull();
    await render({ ...snapshot, selectedNodeIds: ["b"] }, ["b"]);
    await click(".agent-pending-actions .vermilion-button");
    const run = onApplyOps.mock.calls[0][0].find((op: any) => op.type === "run_generation");
    expect(run.prompt).toContain("@[node:a]");
    expect(run.prompt).not.toContain("@[node:b]");
    expect(draft()?.querySelectorAll("img")).toHaveLength(2);
    expect(localStorage.getItem("canvas-agent-conversations:references-project")).not.toContain("data:image");
  });

  it("does not send a removed reference", async () => {
    await render();
    await click('[aria-label="移除引用：Image a"]');
    await send();
    expect(mocks.getAssetContentBlob).not.toHaveBeenCalled();
    expect(mocks.requestAiText.mock.calls[0][0].messages.at(-1).content).not.toContain("本次引用");
  });

  it("adds real references through the canvas picker without duplicate text tokens", async () => {
    await render();
    for (let index = 0; index < 2; index++) {
      await click('[title="上传文件或引用画布内节点"]');
      await click(".agent-plus-item");
      await click(".agent-ref-item");
    }
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("textarea")?.value).toBe("");
    await render({ ...snapshot, selectedNodeIds: [] });
    expect(draft()?.querySelectorAll("img")).toHaveLength(1);
    await click('[title="切换对话"]');
    await click(".agent-thread-new");
    expect(draft()).toBeNull();
  });

  it("reports unavailable images without silently sending an unreferenced request", async () => {
    mocks.getAssetContentBlob.mockRejectedValue(new Error("Unavailable"));
    await render();
    await send();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(container.textContent).toContain("无法读取引用图片");
    expect(container.querySelector(".agent-stop-btn")).toBeNull();
  });

  it("ignores a late image read after interruption or project switch", async () => {
    let resolve!: (blob: Blob) => void;
    mocks.getAssetContentBlob.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
    await render();
    await send();
    await click(".agent-stop-btn");
    await render({ ...snapshot, projectId: "other", nodes: [], selectedNodeIds: [] });
    await act(async () => resolve(new Blob(["image"], { type: "image/png" })));
    expect(mocks.getAssetContentBlob.mock.calls[0][3].aborted).toBe(true);
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(draft()).toBeNull();
  });
});
