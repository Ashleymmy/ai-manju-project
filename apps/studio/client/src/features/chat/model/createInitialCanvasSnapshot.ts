import {
  CANVAS_IMAGE_DEFAULT_QUALITY,
  CANVAS_IMAGE_DEFAULT_RESOLUTION,
  CANVAS_IMAGE_DEFAULT_SIZE,
} from "@/features/canvas";

export type ChatCanvasNode = {
  id: string;
  kind: "text" | "image";
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: {
    content: string;
    generationMode?: "image";
    status: "idle";
    size: typeof CANVAS_IMAGE_DEFAULT_SIZE;
    quality: typeof CANVAS_IMAGE_DEFAULT_QUALITY;
    imageResolution: typeof CANVAS_IMAGE_DEFAULT_RESOLUTION;
    count: 1;
  };
};

export type ChatCanvasSnapshot = {
  nodes: [ChatCanvasNode, ChatCanvasNode];
  edges: [{ id: string; from: string; to: string }];
  viewport: { x: 0; y: 0; zoom: 1 };
};

export function createInitialCanvasSnapshot(
  prompt: string,
  createId: () => string = () => crypto.randomUUID()
): ChatCanvasSnapshot {
  const textNodeId = createId();
  const imageNodeId = createId();

  return {
    nodes: [
      {
        id: textNodeId,
        kind: "text",
        title: "创作指令",
        content: prompt,
        x: 160,
        y: 160,
        width: 300,
        height: 170,
        metadata: {
          content: prompt,
          status: "idle",
          size: CANVAS_IMAGE_DEFAULT_SIZE,
          quality: CANVAS_IMAGE_DEFAULT_QUALITY,
          imageResolution: CANVAS_IMAGE_DEFAULT_RESOLUTION,
          count: 1,
        },
      },
      {
        id: imageNodeId,
        kind: "image",
        title: "生成图片",
        content: prompt,
        x: 540,
        y: 160,
        width: 300,
        height: 220,
        metadata: {
          content: prompt,
          generationMode: "image",
          status: "idle",
          size: CANVAS_IMAGE_DEFAULT_SIZE,
          quality: CANVAS_IMAGE_DEFAULT_QUALITY,
          imageResolution: CANVAS_IMAGE_DEFAULT_RESOLUTION,
          count: 1,
        },
      },
    ],
    edges: [
      {
        id: createId(),
        from: textNodeId,
        to: imageNodeId,
      },
    ],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
  };
}
