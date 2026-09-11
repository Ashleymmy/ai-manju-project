import type { Asset, AssetCategory } from "@/entities/asset";
import type { CanvasMentionReference } from "@/features/canvas/domain/mentions";
import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
import type { CanvasTextAsset } from "@/features/canvas/repositories/textAssetsRepository";
import type { CanvasServiceExecutor } from "@/features/canvas/services/contracts";
import type { WorkspaceScope } from "@/shared/config";

export type CanvasAssetPickerMediaType = "text" | "image" | "video" | "audio";

export type CanvasAssetPickerKind = "all" | "favorite" | CanvasAssetPickerMediaType;

export type CanvasAssetPickerFolderOption = {
  id: string;
  label: string;
};

export type CanvasAssetPickerItem = {
  id: string;
  type: CanvasAssetPickerMediaType;
  name: string;
  scope: WorkspaceScope;
  source: "server" | "local-text";
  serverAsset?: Asset;
  textAsset?: CanvasTextAsset;
  category?: string;
  size?: number;
  contentType?: string;
};

export type CanvasAssetPickerState = {
  open: boolean;
  insertBusy: boolean;
  scope: WorkspaceScope;
  loading: boolean;
  query: string;
  kind: CanvasAssetPickerKind;
  folderId: string;
  folders: CanvasAssetPickerFolderOption[];
  error: string;
  items: CanvasAssetPickerItem[];
  selectedIds: string[];
  thumbnails: Record<string, string>;
};

export type CanvasMentionMediaPreview = {
  url: string;
  title: string;
  kind: "image" | "video" | "audio";
};

export type ScopedCanvasAsset = Asset & { scope: WorkspaceScope };

export type CanvasAssetsMentionsSnapshot = {
  assets: ScopedCanvasAsset[];
  previews: Record<string, string>;
  picker: CanvasAssetPickerState;
  mentionPreview: CanvasMentionMediaPreview | null;
};

export type CanvasAssetsMentionsBindings = {
  getUserId(): string;
  getProjectId(): string;
  getCanonicalScope(): WorkspaceScope | null;
  getFallbackScope(): WorkspaceScope;
  getMentionScope(): WorkspaceScope;
  getNodes(): CanvasNodeData[];
  getEdges(): CanvasEdgeData[];
  setNodes(nodes: CanvasNodeData[]): void;
  applyNodeSelection(ids: Iterable<string>, primaryId?: string, openInspector?: boolean): void;
  getCanvasCenter(): { x: number; y: number };
  setImagePreviewNodeId(nodeId: string): void;
  toggleCanvasBatch(nodeId: string): void;
  focusNodeInViewport(nodeId: string): void;
  executeAssets: CanvasServiceExecutor;
  onSuccess(message: string): void;
  onError(message: string): void;
};

export type CanvasAssetsMentionsServices = {
  getAssetLibrary: typeof import("@/entities/asset").getAssetLibrary;
  getAssetFolders: typeof import("@/entities/asset").getAssetFolders;
  getAssetContentObjectUrl: typeof import("@/entities/asset").getAssetContentObjectUrl;
  listCanvasTextAssets: typeof import("@/features/canvas/repositories/textAssetsRepository").listCanvasTextAssets;
  createId(): string;
  confirm(message: string): boolean;
  schedule(callback: () => void, delayMs: number): number;
  cancelSchedule(timer: number): void;
  revokeObjectURL(url: string): void;
  warn(message: string, error: unknown): void;
};

export type CanvasPreviewSyncInput = {
  projectId: string;
  canonicalScope: WorkspaceScope | null;
  fallbackScope: WorkspaceScope;
};

export type CanvasMentionCommands = {
  mentionReferencesForNode(nodeId: string): CanvasMentionReference[];
  queueMentionAssetSearch(query: string, category?: AssetCategory | ""): void;
  mentionThumbnailFor(reference: CanvasMentionReference): string;
  previewMentionReference(reference: CanvasMentionReference): void;
  locateMentionReference(reference: CanvasMentionReference): void;
};
