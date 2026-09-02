import { describe, expect, it, vi } from "vitest";

import { createChatProjectFlow } from "./createChatProjectFlow";
import { createInitialCanvasSnapshot } from "./model/createInitialCanvasSnapshot";

describe("Chat project flow", () => {
  it("builds the initial Canvas snapshot without changing its wire shape", () => {
    const ids = ["text-node", "image-node", "text-image-edge"];
    const createId = vi.fn(() => ids.shift() ?? "unexpected-id");

    expect(createInitialCanvasSnapshot("雨夜追逐", createId)).toEqual({
      nodes: [
        {
          id: "text-node",
          kind: "text",
          title: "创作指令",
          content: "雨夜追逐",
          x: 160,
          y: 160,
          width: 300,
          height: 170,
          metadata: {
            content: "雨夜追逐",
            status: "idle",
            size: "auto",
            quality: "auto",
            count: 1,
          },
        },
        {
          id: "image-node",
          kind: "image",
          title: "生成图片",
          content: "雨夜追逐",
          x: 540,
          y: 160,
          width: 300,
          height: 220,
          metadata: {
            content: "雨夜追逐",
            generationMode: "image",
            status: "idle",
            size: "auto",
            quality: "auto",
            count: 1,
          },
        },
      ],
      edges: [
        {
          id: "text-image-edge",
          from: "text-node",
          to: "image-node",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(createId).toHaveBeenCalledTimes(3);
  });

  it("creates, bootstraps, then navigates in the existing order", async () => {
    const events: string[] = [];
    const ids = ["text-node", "image-node", "text-image-edge"];
    const createProject = vi.fn(async () => {
      events.push("create");
      return { id: "project/一" };
    });
    const setCanvasBootstrap = vi.fn(() => events.push("bootstrap"));
    const navigate = vi.fn(() => events.push("navigate"));
    const flow = createChatProjectFlow({
      createProject,
      setCanvasBootstrap,
      navigate,
      createId: () => ids.shift() ?? "unexpected-id",
    });
    const prompt = `${"长".repeat(55)} 结尾`;

    await flow(`  ${prompt}  `);

    expect(events).toEqual(["create", "bootstrap", "navigate"]);
    expect(createProject).toHaveBeenCalledWith({
      title: "长".repeat(50),
      scope: "personal",
      data: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ content: prompt }),
        ]),
        edges: [
          {
            id: "text-image-edge",
            from: "text-node",
            to: "image-node",
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    });
    expect(setCanvasBootstrap).toHaveBeenCalledWith("project/一", prompt);
    expect(navigate).toHaveBeenCalledWith(
      "/canvas/project%2F%E4%B8%80?scope=personal"
    );
  });

  it("does not bootstrap or navigate when project creation fails", async () => {
    const failure = new Error("create failed");
    const setCanvasBootstrap = vi.fn();
    const navigate = vi.fn();
    const flow = createChatProjectFlow({
      createProject: vi.fn().mockRejectedValue(failure),
      setCanvasBootstrap,
      navigate,
      createId: () => "id",
    });

    await expect(flow("失败场景")).rejects.toBe(failure);
    expect(setCanvasBootstrap).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
