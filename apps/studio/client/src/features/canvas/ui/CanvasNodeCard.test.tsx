// @vitest-environment jsdom

import { act, createRef, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/features/canvas/domain/types";

import {
  CanvasNodeCard,
  canvasNodeCardPropsEqual,
  type CanvasNodeCardActions,
  type CanvasNodeCardProps,
} from "./CanvasNodeCard";

const setString: Dispatch<SetStateAction<string>> = () => undefined;
const resolveNothing = async () => undefined;

function createActions(): CanvasNodeCardActions {
  return {
    chooseNode: () => true,
    openNodeContextMenu: () => undefined,
    toggleCanvasBatch: () => undefined,
    openDirectorNode: resolveNothing,
    applyNodeSelection: () => undefined,
    beginInlineNodeEdit: () => undefined,
    handleNodeHoverStart: () => undefined,
    handleNodeHoverEnd: () => undefined,
    startDrag: () => undefined,
    moveDrag: () => undefined,
    endDrag: () => undefined,
    registerConnectionHandle: () => undefined,
    beginConnection: () => undefined,
    commitNodeTitle: () => undefined,
    setTitleDraft: setString,
    setTitleEditingNodeId: setString,
    setReplaceImageNodeId: setString,
    setImagePreviewNodeId: setString,
    setEditingInlineNodeId: setString,
    setPinnedToolbarNodeId: setString,
    setMaterialNodeId: setString,
    setImageAnnotationNodeId: setString,
    setImageMaskNodeId: setString,
    setImageToolError: setString,
    setStoryboardNodeId: setString,
    replaceMediaNodeIdRef: { current: "" },
    replaceMediaInputRef: createRef<HTMLInputElement>(),
    replaceImageInputRef: createRef<HTMLInputElement>(),
    toggleCanvasNodeFavorite: resolveNothing,
    detachBatchChildToCanvas: () => undefined,
    downloadNodeMedia: resolveNothing,
    setBatchPrimaryNode: () => undefined,
    captureVideoFrameNode: resolveNothing,
    updateNodeTextContent: () => undefined,
    updateNodePrompt: () => undefined,
    mentionReferencesForNode: () => [],
    queueMentionAssetSearch: () => undefined,
    mentionThumbnailFor: () => "",
    previewMentionReference: () => undefined,
    locateMentionReference: () => undefined,
    startResize: () => undefined,
    moveResize: () => undefined,
    endResize: () => undefined,
    stopGenerationByNodeId: () => undefined,
    duplicateSelectedNode: resolveNothing,
    adjustNodeFontSize: () => undefined,
    openImageToolDialog: () => undefined,
    flipCanvasImageNode: resolveNothing,
    generatePanoramaCanvasImage: resolveNothing,
    createImageReversePromptNodes: resolveNothing,
    generateImageFromTextNode: resolveNothing,
    archiveCanvasMediaNode: resolveNothing,
    archiveCanvasTextNode: resolveNothing,
    retryImageNode: resolveNothing,
    retryTextNode: resolveNothing,
    retryAudioNode: resolveNothing,
    retryVideoNode: resolveNothing,
    removeNode: () => undefined,
  };
}

function createNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "node-image",
    kind: "image",
    title: "测试图片",
    content: "",
    x: 120,
    y: 80,
    width: 320,
    height: 240,
    imageSrc: "blob:canvas-node-media",
    ...overrides,
  };
}

function createProps(node: CanvasNodeData, actions = createActions()): CanvasNodeCardProps {
  return {
    node,
    previews: {},
    isSelected: false,
    isSelectedSingle: false,
    isHovered: false,
    isConnectionTarget: false,
    isConnecting: false,
    connectActiveTarget: false,
    connectActiveSource: false,
    isTitleEditing: false,
    titleDraft: "",
    isInlineEditing: false,
    isRunning: false,
    progress: 0,
    isPinned: false,
    captureBusy: false,
    isCapturingFrame: false,
    showImageInfo: false,
    imageToolBusy: false,
    storyboardBusy: false,
    actions,
  };
}

describe("CanvasNodeCard render boundary", () => {
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

  it("keeps the original comparator semantics and ignores action object identity", () => {
    const node = createNode();
    const previous = createProps(node);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, actions: createActions() })).toBe(true);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, node: { ...node } })).toBe(false);
  });

  it("preserves the media element and source when only node position changes", async () => {
    const actions = createActions();
    const node = createNode();

    await act(async () => root.render(<CanvasNodeCard {...createProps(node, actions)} />));
    const originalImage = container.querySelector("img");
    expect(originalImage?.getAttribute("src")).toBe("blob:canvas-node-media");

    await act(async () => root.render(
      <CanvasNodeCard {...createProps({ ...node, x: 180, y: 140 }, actions)} />
    ));

    const movedImage = container.querySelector("img");
    expect(movedImage).toBe(originalImage);
    expect(movedImage?.getAttribute("src")).toBe("blob:canvas-node-media");
    expect(container.querySelector("article")?.getAttribute("data-node-id")).toBe("node-image");
  });

  it.each(["video", "audio"] as const)(
    "preserves the %s element, source, and playback state when only node position changes",
    async (kind) => {
      const actions = createActions();
      const source = `blob:canvas-node-${kind}`;
      const node = createNode({
        id: `node-${kind}`,
        kind,
        title: kind === "video" ? "测试视频" : "测试音频",
        imageSrc: source,
      });

      await act(async () => root.render(<CanvasNodeCard {...createProps(node, actions)} />));
      const originalMedia = container.querySelector<HTMLMediaElement>(kind);
      expect(originalMedia?.getAttribute("src")).toBe(source);

      originalMedia!.currentTime = 12.5;
      Object.defineProperty(originalMedia, "paused", {
        configurable: true,
        value: false,
      });

      await act(async () => root.render(
        <CanvasNodeCard {...createProps({ ...node, x: 180, y: 140 }, actions)} />
      ));

      const movedMedia = container.querySelector<HTMLMediaElement>(kind);
      expect(movedMedia).toBe(originalMedia);
      expect(movedMedia?.getAttribute("src")).toBe(source);
      expect(movedMedia?.currentTime).toBe(12.5);
      expect(movedMedia?.paused).toBe(false);
      expect(container.querySelector("article")?.getAttribute("data-node-id")).toBe(`node-${kind}`);
    },
  );
});
