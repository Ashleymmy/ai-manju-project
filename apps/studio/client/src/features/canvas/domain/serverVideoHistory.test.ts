import { expect, it } from "vitest";
import { collectCanvasGenerationHistory, cloneCanvasNodeFromGenerationHistory } from "./generationHistory";
import { mergeCanvasGenerationHistory, serverVideoHistoryNodes } from "./serverVideoHistory";
import type { Asset } from "@/entities/asset";

const asset: Asset = { id: "saved-video", type: "video", name: "结果", source_job_id: "job-success",
  created_at: "2026-09-20T09:00:00Z", source_metadata: { prompt: "原始镜头", model: "official::seedance-2.5", seconds: 12, size: "16:9" } };
it("restores a generated video without any surviving node and supports adding it to the canvas", () => {
  const nodes = serverVideoHistoryNodes([asset, { ...asset, id: "upload", source_job_id: undefined },
    { ...asset, id: "trash", trashed_at: "2026-09-20" }], "team");
  const history = collectCanvasGenerationHistory(nodes);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ assetId: asset.id, prompt: "原始镜头", seconds: "12", model: "official::seedance-2.5" });
  expect(history[0].previewUrl).toContain("scope=team");
  const restored = cloneCanvasNodeFromGenerationHistory(nodes[0], { id: "new-node", x: 12, y: 34 });
  expect(restored).toMatchObject({ id: "new-node", imageAssetId: asset.id, metadata: { assetScope: "team", appliedFromHistory: true, status: "success" } });
});
it("deduplicates current/revision/server records by asset and preserves original parameters after node edits", () => {
  const server = collectCanvasGenerationHistory(serverVideoHistoryNodes([asset], "personal"));
  const edited = { ...server[0], nodeId: "current", prompt: "下一次提示词", generatedAt: "2026-09-21T00:00:00Z" };
  const items = mergeCanvasGenerationHistory([edited, { ...edited, nodeId: "node::rev::old" }], server);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ nodeId: server[0].nodeId, prompt: "原始镜头", generatedAt: asset.created_at });
});
