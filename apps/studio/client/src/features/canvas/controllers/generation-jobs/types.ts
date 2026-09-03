import type { Asset } from "@/entities/asset";
import type { AudioGenerationConfig } from "@/services/api/audio";
import type { ResponseInputMessage } from "@/services/api/ai";
import type {
  VideoGenerationConfig,
  VideoGenerationReferences,
  VideoGenerationTask,
  VideoProvider,
} from "@/features/video/services/generationGateway";
import type { CanvasVideoReferenceSnapshot } from "@/features/canvas/domain/video";
import type {
  CanvasEdgeData,
  CanvasImageReferenceSnapshot,
  CanvasNodeData,
  ImageQualityValue,
  ImageSizeValue,
} from "@/features/canvas/domain/types";
import type { CanvasServiceExecutor } from "@/features/canvas/services/contracts";
import type { WorkspaceScope } from "@/shared/config";

export type CanvasGenerationRequest = {
  requestId: string;
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  controller: AbortController;
  jobId?: string;
  provider?: VideoProvider;
};

export type CanvasGenerationPreparation = {
  id: string;
  projectKey: string;
  originNodeId: string;
  targetNodeId?: string;
  referenceNodeIds: string[];
  controller: AbortController;
};

export type CanvasImageTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  model: string;
  size: ImageSizeValue;
  quality: ImageQualityValue;
  referenceFiles: File[];
  maskFile?: File;
  existingJobId?: string;
};

export type CanvasTextTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  model: string;
  messages?: ResponseInputMessage[];
};

export type CanvasVideoTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  config: VideoGenerationConfig;
  references: VideoGenerationReferences;
  referenceInputs?: CanvasVideoReferenceSnapshot;
  existingTask?: VideoGenerationTask;
};

export type CanvasAudioTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  config: AudioGenerationConfig;
};

export type CanvasGenerationBindings = {
  getProjectId(): string;
  getProjectTitle(): string;
  getProjectKey(): string;
  getScope(): WorkspaceScope | null;
  isSwitching(): boolean;
  isLoading(): boolean;
  getNodes(): CanvasNodeData[];
  setNodes(nodes: CanvasNodeData[]): void;
  getEdges(): CanvasEdgeData[];
  setEdges(edges: CanvasEdgeData[]): void;
  getSelectedNodeId(): string;
  getSelectedNodeIds(): Set<string>;
  getCanvasAssets(): Array<Asset & { scope: WorkspaceScope }>;
  mergeCanvasAssets(assets: Asset[], scope: WorkspaceScope): void;
  getImageModel(): string;
  getTextModel(): string;
  getVideoModel(): string;
  getAudioModel(): string;
  isPromptOptimizing(): boolean;
  setPromptOptimizing(value: boolean): void;
  getViewportZoom(): number;
  setRunningNodeIds(ids: Set<string>): void;
  setJobProgressByNode(
    update: Record<string, number> | ((current: Record<string, number>) => Record<string, number>),
  ): void;
  applyNodeSelection(ids: Iterable<string>, primaryId?: string, openInspector?: boolean): void;
  persistSnapshot(
    nodes: CanvasNodeData[],
    edges: CanvasEdgeData[],
    zoom: number,
    options?: { quiet?: boolean; panX?: number; panY?: number },
  ): Promise<boolean>;
  executeGeneration: CanvasServiceExecutor;
  executeAssets: CanvasServiceExecutor;
  onMessage(message: string): void;
  onSuccess(message: string): void;
  onWarning(message: string): void;
  onError(message: string): void;
};

export type CanvasGenerationServices = {
  getAsset: typeof import("@/entities/asset").getAsset;
  getAssetContentObjectUrl: typeof import("@/entities/asset").getAssetContentObjectUrl;
  uploadAsset: typeof import("@/entities/asset").uploadAsset;
  cancelJob: typeof import("@/entities/job").cancelJob;
  generateImages: typeof import("@/features/image/api").generateImages;
  generatedImagesFromJob: typeof import("@/features/image/api").generatedImagesFromJob;
  waitForImageJob: typeof import("@/features/image/api").waitForImageJob;
  requestAiText: typeof import("@/services/api/ai").requestAiText;
  requestAudioGeneration: typeof import("@/services/api/audio").requestAudioGeneration;
  createVideoGenerationTask: typeof import("@/features/video/services/generationGateway").createVideoGenerationTask;
  pollVideoGenerationTask: typeof import("@/features/video/services/generationGateway").pollVideoGenerationTask;
  videoGenerationResultToBlob: typeof import("@/features/video/services/generationGateway").videoGenerationResultToBlob;
  createId(): string;
  createAbortController(): AbortController;
  createFile(parts: BlobPart[], name: string, options?: FilePropertyBag): File;
  fetchBlob(url: string, signal?: AbortSignal, label?: string): Promise<Blob>;
  readFileDataUrl(file: File, signal?: AbortSignal): Promise<string>;
  readImageMetadata(file: File): Promise<{ width: number; height: number }>;
  readVideoMetadata(file: File): Promise<{ width: number; height: number; durationMs: number }>;
  readAudioMetadata(file: File): Promise<{ durationMs: number }>;
  revokeObjectURL(url: string): void;
  waitForPoll(signal: AbortSignal): Promise<void>;
};

export type CanvasPreparedImageReferences = {
  files: File[];
  snapshots: CanvasImageReferenceSnapshot[];
};
