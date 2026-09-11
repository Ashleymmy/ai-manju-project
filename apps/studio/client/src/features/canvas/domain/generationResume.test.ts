import { describe, expect, it } from "vitest";

import type { CanvasNodeData } from "./types";
import {
  applyPendingCanvasJobIds,
  canvasJobSourceNodeId,
  canvasJobSourceProjectId,
  markUnrecoverableCanvasGenerations,
  matchLoadingNodesToJobs,
} from "./generationResume";
import { resetInterruptedCanvasGenerations } from "./batch";

function imageNode(
  id: string,
  metadata: CanvasNodeData["metadata"],
): CanvasNodeData {
  return {
    id,
    kind: "image",
    title: "生成中…",
    content: "风景",
    x: 0,
    y: 0,
    width: 320,
    height: 238,
    metadata,
  };
}

describe("generation resume", () => {
  it("keeps loading image nodes across refresh so jobs can be reattached", () => {
    const nodes = [
      imageNode("img-1", { status: "loading", prompt: "风景" }),
      {
        ...imageNode("text-1", { status: "loading", prompt: "旁白" }),
        kind: "text" as const,
        title: "生成文本中…",
      },
    ];
    const next = resetInterruptedCanvasGenerations(nodes);
    expect(next[0]?.metadata?.status).toBe("loading");
    expect(next[1]?.metadata?.status).toBe("error");
    expect(next[1]?.metadata?.errorDetails).toContain("页面刷新后生成已中断");
  });

  it("matches queued jobs to loading nodes by target then origin", () => {
    const nodes = [
      imageNode("img-1", {
        status: "loading",
        sourceNodeId: "prompt-1",
        prompt: "风景",
      }),
      imageNode("img-2", {
        status: "loading",
        sourceNodeId: "prompt-1",
        prompt: "风景",
      }),
    ];
    const matches = matchLoadingNodesToJobs(
      nodes,
      [
        {
          id: "job-a",
          payload: {
            asset_registration: {
              source_project_id: "proj",
              source_node_id: "img-1",
            },
          },
        },
        {
          id: "job-b",
          payload: {
            asset_registration: {
              source_project_id: "proj",
              source_node_id: "img-2",
            },
          },
        },
      ],
      "proj",
    );
    expect(matches).toEqual([
      { nodeId: "img-1", jobId: "job-a" },
      { nodeId: "img-2", jobId: "job-b" },
    ]);
  });

  it("applies restored job ids without dropping loading status", () => {
    const nodes = [imageNode("img-1", { status: "loading", prompt: "风景" })];
    const next = applyPendingCanvasJobIds(nodes, [
      { nodeId: "img-1", jobId: "job-recover" },
    ]);
    expect(next[0]?.metadata).toMatchObject({
      status: "loading",
      jobId: "job-recover",
    });
  });

  it("marks leftover loading images as unrecoverable after matching", () => {
    const next = markUnrecoverableCanvasGenerations([
      imageNode("img-1", { status: "loading", prompt: "风景" }),
      imageNode("img-2", {
        status: "loading",
        jobId: "job-ok",
        prompt: "风景",
      }),
    ]);
    expect(next[0]?.metadata?.status).toBe("error");
    expect(next[1]?.metadata?.status).toBe("loading");
  });

  it("falls back to a unique origin job when the target id is missing", () => {
    const nodes = [
      imageNode("img-1", {
        status: "loading",
        sourceNodeId: "prompt-1",
        prompt: "风景",
      }),
    ];
    const matches = matchLoadingNodesToJobs(
      nodes,
      [
        {
          id: "job-origin",
          payload: {
            asset_registration: {
              source_project_id: "proj",
              source_node_id: "prompt-1",
            },
          },
        },
      ],
      "proj",
    );
    expect(matches).toEqual([{ nodeId: "img-1", jobId: "job-origin" }]);
  });

  it("reads source node and project from job payload", () => {
    expect(
      canvasJobSourceNodeId({
        id: "job",
        payload: { asset_registration: { source_node_id: "node-9" } },
      }),
    ).toBe("node-9");
    expect(
      canvasJobSourceProjectId({
        id: "job",
        payload: { asset_registration: { source_project_id: "proj-9" } },
      }),
    ).toBe("proj-9");
  });
});
