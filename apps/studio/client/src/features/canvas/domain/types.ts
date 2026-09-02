import type { WorkspaceScope } from "@/shared/config/workspace";

import type { CanvasGroupData } from "./groups";
import type { CanvasHistoryEntry } from "./history";
import type { CanvasVideoReferenceSnapshot } from "./video";

export type CanvasNodeKind =
  | "prompt"
  | "image"
  | "note"
  | "text"
  | "config"
  | "video"
  | "audio"
  | "director";

export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasNodeStatus = "idle" | "loading" | "success" | "error";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";
export type ImageSizeValue = "auto" | "1:1" | "16:9" | "9:16" | "2:1";
export type ImageQualityValue = "auto" | "low" | "medium" | "high";

export type CanvasImageReferenceSnapshot = {
  nodeId: string;
  title: string;
  assetId: string;
  assetScope?: WorkspaceScope;
  name: string;
  contentType: string;
};

export type CanvasNodeMetadata = Record<string, unknown> & {
  content?: string;
  prompt?: string;
  composerContent?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  generationMode?: CanvasGenerationMode;
  jobId?: string;
  jobProgress?: number;
  model?: string;
  videoProvider?: "openai" | "seedance";
  size?: string;
  resolution?: string;
  seconds?: string;
  videoSubMode?: string;
  storyboardScenes?: Array<Record<string, unknown>>;
  imageResolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  quality?: string;
  count?: number;
  assetId?: string;
  assetScope?: WorkspaceScope;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  captureTimeSeconds?: number;
  promptPanelWidth?: number;
  promptEditorHeight?: number;
  generationType?: "generation" | "edit";
  sourceNodeId?: string;
  referenceInputs?: CanvasImageReferenceSnapshot[];
  videoReferenceInputs?: CanvasVideoReferenceSnapshot;
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: string;
  audioInstructions?: string;
  isBatchRoot?: boolean;
  batchChildIds?: string[];
  batchRootId?: string;
  /** 根节点自身生成第 1 张；旧数据无此标记，加载时自动迁移。 */
  batchModelV2?: boolean;
  primaryImageId?: string;
  ownAssetId?: string;
  ownImageSrc?: string;
  imageBatchExpanded?: boolean;
  fontSize?: number;
  seedanceMaterialAssets?: Array<{
    id: string;
    name?: string;
    status?: string;
    raw?: Record<string, unknown>;
  }>;
  seedanceVolcanoAssets?: Array<{
    id: string;
    volcanoAssetId: string;
    name?: string;
    status?: string;
    assetType?: string;
  }>;
};

/** Canonical Canvas node. Extra snapshot fields remain attached for lossless writes. */
export type CanvasNodeData = Record<string, unknown> & {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageAssetId?: string;
  imageSrc?: string;
  metadata?: CanvasNodeMetadata;
};

/** Canonical Canvas edge. */
export type CanvasEdgeData = Record<string, unknown> & {
  id: string;
  from: string;
  to: string;
};

export type CanvasSnapshotData = {
  nodes?: CanvasNodeData[];
  edges?: CanvasEdgeData[];
  groups?: CanvasGroupData[];
  zoom?: number;
  panX?: number;
  panY?: number;
  backgroundMode?: CanvasBackgroundMode;
  showImageInfo?: boolean;
};

export type CanvasSnapshotState = CanvasHistoryEntry<
  CanvasNodeData,
  CanvasEdgeData
> & {
  groups: CanvasGroupData[];
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
};
