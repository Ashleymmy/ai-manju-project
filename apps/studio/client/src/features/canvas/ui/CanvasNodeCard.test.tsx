// @vitest-environment jsdom

import { act, createRef, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    setNodePinColor: () => undefined,
    setMaterialNodeId: setString,
    registerImageAsSeedanceAsset: resolveNothing,
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
    fitCanvasMediaNodeFrame: () => undefined,
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
    isGrouped: false,
    isConnecting: false,
    connectActiveTarget: false,
    connectActiveSource: false,
    isTitleEditing: false,
    titleDraft: "",
    isInlineEditing: false,
    isRunning: false,
    progress: 0,
    captureBusy: false,
    isCapturingFrame: false,
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

  it("reads original video proportions before selection and reloads them when the source changes", async () => {
    const actions = createActions();
    actions.fitCanvasMediaNodeFrame = vi.fn();
    const node = createNode({ kind: "video", imageSrc: "blob:video" });
    await act(async () => root.render(<CanvasNodeCard {...createProps(node, actions)} />));
    const video = container.querySelector("video")!;
    expect(video.preload).toBe("metadata");
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
    expect(actions.fitCanvasMediaNodeFrame).toHaveBeenCalledWith(node.id, 1920, 1080, "blob:video");
    const next = { ...node, imageSrc: "blob:portrait" };
    await act(async () => root.render(<CanvasNodeCard {...createProps(next, actions)} isSelected />));
    const nextVideo = container.querySelector("video")!;
    expect(nextVideo).not.toBe(video);
    expect(nextVideo.preload).toBe("metadata");
    Object.defineProperties(nextVideo, { videoWidth: { value: 720 }, videoHeight: { value: 1280 } });
    await act(async () => nextVideo.dispatchEvent(new Event("loadedmetadata")));
    expect(actions.fitCanvasMediaNodeFrame).toHaveBeenLastCalledWith(node.id, 720, 1280, "blob:portrait");
    expect(container.querySelector(".node-resize-handle")?.getAttribute("title")).toBe("等比调整尺寸");
  });

  it.each(["image", "video"] as const)("keeps a failed %s prompt out of the preview and retains upload/edit actions", async kind => {
    const actions = createActions();
    actions.applyNodeSelection = vi.fn();
    actions.beginInlineNodeEdit = vi.fn();
    actions.setReplaceImageNodeId = vi.fn();
    const upload = document.createElement("input");
    upload.click = vi.fn();
    actions.replaceImageInputRef = { current: upload };
    actions.replaceMediaInputRef = { current: upload };
    const node = createNode({ kind, imageSrc: undefined, content: "镜号1：镜头缓慢推进。".repeat(80),
      metadata: { status: "error", errorDetails: "生成失败，请重试", composerContent: "@[node:reference] 保持角色一致。".repeat(80) } });
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CanvasNodeCard {...createProps(node, actions)} isHovered isInlineEditing /></QueryClientProvider>));
    expect(container.querySelector(".prompt-body-empty")?.textContent).toContain(kind === "video" ? "尝试上传或生成视频" : "尝试上传或生成图片");
    expect(container.textContent).not.toContain("镜头缓慢推进");
    expect(container.textContent).not.toContain("@[node:reference]");
    expect(container.querySelector(".node-inline-editor")).toBeNull();
    expect(container.querySelector(".node-error-box")?.textContent).toContain("生成失败，请重试");
    await act(async () => container.querySelector<HTMLButtonElement>(".node-upload-pill")!.click());
    expect(upload.click).toHaveBeenCalledOnce();
    if (kind === "video") expect(actions.replaceMediaNodeIdRef.current).toBe(node.id);
    else expect(actions.setReplaceImageNodeId).toHaveBeenCalledWith(node.id);
    await act(async () => container.querySelector(".prompt-body-empty")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(actions.applyNodeSelection).toHaveBeenCalledWith([node.id], node.id, true);
    expect(actions.beginInlineNodeEdit).not.toHaveBeenCalled();
    expect(node.metadata?.composerContent).toContain("@[node:reference]");
  });

  it("still completes a pending connection when the node is in connecting mode", async () => {
    const actions = createActions();
    const chooseNode = vi.fn(() => false);
    actions.chooseNode = chooseNode;
    const node = createNode();

    await act(async () => root.render(
      <CanvasNodeCard {...createProps(node, actions)} isConnecting />,
    ));
    await act(async () => {
      container.querySelector("article")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(chooseNode).toHaveBeenCalledWith("node-image", expect.anything());
  });

  it("removes member connection handles while a node belongs to a group", async () => {
    const node = createNode();
    await act(async () => root.render(<CanvasNodeCard {...createProps(node)} isGrouped />));
    expect(container.querySelectorAll(".canvas-connection-handle")).toHaveLength(0);
  });

  it("keeps title double-clicks out of node dragging and media preview", async () => {
    const actions = createActions();
    actions.startDrag = vi.fn();
    actions.setTitleDraft = vi.fn();
    actions.setTitleEditingNodeId = vi.fn();
    actions.setImagePreviewNodeId = vi.fn();
    const node = createNode();
    await act(async () => root.render(<CanvasNodeCard {...createProps(node, actions)} />));

    const title = container.querySelector(".node-float-label b")!;
    await act(async () => {
      title.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(actions.startDrag).not.toHaveBeenCalled();
    expect(actions.setImagePreviewNodeId).not.toHaveBeenCalled();
    expect(actions.setTitleDraft).toHaveBeenCalledWith(node.title);
    expect(actions.setTitleEditingNodeId).toHaveBeenCalledWith(node.id);
  });

  it("keeps the original comparator semantics and ignores action object identity", () => {
    const node = createNode();
    const previous = createProps(node);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, actions: createActions() })).toBe(true);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, node: { ...node } })).toBe(false);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, seedanceRegistrationState: { phase: "uploading" } })).toBe(false);
    expect(canvasNodeCardPropsEqual(previous, { ...previous, mentionLibrary: { projectId: "project-1", scope: "personal", folders: [], target: "root", query: "", assetIds: [], loading: true, error: "", page: 0, hasMore: false } })).toBe(false);
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
