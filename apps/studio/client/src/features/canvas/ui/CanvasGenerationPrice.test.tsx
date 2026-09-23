// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasGenerationPrice, CanvasPricingContext } from "./CanvasGenerationPrice";
import { buildCanvasMentionReferences } from "../domain/mentions";
import type { CanvasNodeData, CanvasEdgeData } from "../domain/types";
import type { GenerationPriceProps } from "@/features/member/ui/GenerationPrice";

vi.mock("@/features/member", () => ({ GenerationPrice: (props: GenerationPriceProps) => <output>{JSON.stringify(props)}</output> }));
afterEach(() => vi.unstubAllGlobals());

it("quotes the same connected references as submission, including changes and retry fallback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); const root = createRoot(container);
  const media = (id: string, kind: CanvasNodeData["kind"]): CanvasNodeData => ({ id, kind, title: id, content: `https://example.com/${id}`, x: 0, y: 0, width: 200, height: 200, metadata: { assetId: id, canvasOrigin: "imported" } });
  let target: CanvasNodeData = { ...media("target", "video"), content: "", metadata: { generationMode: "video", model: "seedance-2.5", seconds: "10", resolution: "720p", prompt: "生成视频" } };
  let nodes = [media("video", "video"), media("image", "image"), media("audio", "audio"), target];
  const edge = (from: string, to = "target"): CanvasEdgeData => ({ id: `${from}-${to}`, from, to });
  const render = async (edges: CanvasEdgeData[]) => {
    nodes = nodes.map(n => n.id === "target" ? target : n);
    await act(async () => root.render(<CanvasPricingContext.Provider value={{ imageModel: "", videoModel: "seedance-2.5", nodes, edges, references: id => buildCanvasMentionReferences(id, nodes, edges, [], "personal") }}><CanvasGenerationPrice node={target} /></CanvasPricingContext.Provider>));
    return JSON.parse(container.textContent!) as GenerationPriceProps;
  };
  expect((await render([edge("video")])).referenceVideos).toBe(1);
  expect((await render([edge("image"), edge("audio")])).referenceVideos).toBe(0);
  // A video feeding an image is not itself submitted to the next video node.
  expect((await render([edge("video", "image"), edge("image")])).referenceVideos).toBe(0);
  target = { ...target, metadata: { ...target.metadata, prompt: "参考 @[node:video]" } };
  expect((await render([])).referenceVideos).toBe(1);
  target = { ...target, metadata: { ...target.metadata, status: "error", prompt: "重试", videoReferenceInputs: { items: [{ nodeId: "removed", type: "video", title: "video", source: "node", scope: "personal", name: "ref.mp4", mime: "video/mp4", bytes: 100 }] } } };
  expect((await render([])).referenceVideos).toBe(1);
  // Current image inputs replace the stale video snapshot on retry.
  expect((await render([edge("image")])).referenceVideos).toBe(0);
  // A standalone retry must not count the node's existing output as its own
  // video reference when there is no incoming edge or snapshot.
  target = { ...target, metadata: { ...target.metadata, status: "error", prompt: "重试", content: "asset://previous-video", videoReferenceInputs: { items: [] } } };
  expect((await render([])).referenceVideos).toBe(0);
  // The same rule applies to snapshots written by the pre-fix build.
  target = { ...target, metadata: { ...target.metadata, videoReferenceInputs: { items: [{ nodeId: "target", type: "video", title: "旧输出", source: "node", scope: "personal", name: "old.mp4", mime: "video/mp4", bytes: 100 }] } } };
  expect((await render([])).referenceVideos).toBe(0);
  target = { ...target, metadata: { ...target.metadata, status: "idle", seedanceVolcanoAssets: [{ id: "registered", volcanoAssetId: "registered", assetType: "Video" }] } };
  expect((await render([edge("image")])).referenceVideos).toBe(1);
  await act(async () => root.unmount());
});
