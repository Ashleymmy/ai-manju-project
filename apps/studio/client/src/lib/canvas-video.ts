import type { Asset } from "../services/api/assets";
import type { WorkspaceScope } from "../services/api/projects";
import type {
  VideoGenerationAudioReference,
  VideoGenerationImageReference,
  VideoGenerationReferences,
  VideoGenerationResult,
  VideoGenerationVideoReference,
} from "../services/api/video";
import type { CanvasGenerationInput } from "./canvas-connections";

type MediaInput = CanvasGenerationInput & { type: "image" | "video" | "audio" };
type MediaKind = MediaInput["type"];

export type CanvasVideoReferenceSnapshotItem =
  | {
      nodeId: string;
      type: "text";
      title: string;
      source: "node";
      text: string;
    }
  | {
      nodeId: string;
      type: MediaKind;
      title: string;
      source: "asset" | "node";
      assetId?: string;
      scope: WorkspaceScope;
      name: string;
      mime: string;
      bytes: number;
      width?: number;
      height?: number;
      durationMs?: number;
    };

export type CanvasVideoReferenceSnapshot = {
  items: CanvasVideoReferenceSnapshotItem[];
};

export type CanvasVideoReferenceHydrators = {
  scope: WorkspaceScope;
  resolveAssetBlob: (
    input: MediaInput & { assetId: string }
  ) => Promise<Blob | null | undefined>;
  resolveNodeBlob: (
    input: MediaInput & { content: string }
  ) => Promise<Blob | null | undefined>;
  readImageMetadata: (file: File) => Promise<{ width: number; height: number }>;
  readVideoMetadata: (
    file: File
  ) => Promise<{ width: number; height: number; durationMs: number }>;
  readAudioMetadata: (file: File) => Promise<{ durationMs: number }>;
};

export type CanvasVideoReferenceHydrationResult = {
  references: VideoGenerationReferences;
  snapshot: CanvasVideoReferenceSnapshot;
};

export type CanvasSeedanceMaterialReference = {
  id: string;
  name?: string;
};

export type CanvasSeedanceVolcanoReference = {
  id: string;
  volcanoAssetId: string;
  name?: string;
  assetType?: string;
};

export type ArchivedVideoAsset = Pick<
  Asset,
  "id" | "name" | "content_type" | "size"
> & {
  scope?: WorkspaceScope;
};

export type PersistentVideoResultMetadata = {
  assetId?: string;
  scope?: WorkspaceScope;
  mimeType?: string;
  bytes?: number;
  fileName?: string;
};

export function canvasSeedanceVideoReferences(
  materialAssets: readonly CanvasSeedanceMaterialReference[] = [],
  volcanoAssets: readonly CanvasSeedanceVolcanoReference[] = []
): VideoGenerationReferences {
  const images: VideoGenerationImageReference[] = [];
  const videos: VideoGenerationVideoReference[] = [];

  for (const asset of materialAssets) {
    const assetId = asset.id.trim();
    if (!assetId) continue;
    images.push(assetImageReference(`seedance-material-${assetId}`, assetId, asset.name));
  }
  for (const asset of volcanoAssets) {
    const assetId = (asset.volcanoAssetId || asset.id).trim();
    if (!assetId) continue;
    if ((asset.assetType || "").trim().toLowerCase() === "video") {
      videos.push({
        id: `seedance-volcano-asset-${assetId}`,
        kind: "video",
        url: `asset://${assetId}`,
        name: asset.name || assetId,
        mime: "video/mp4",
        bytes: 0,
        width: 0,
        height: 0,
        durationMs: 0,
      });
    } else {
      images.push(assetImageReference(`seedance-volcano-asset-${assetId}`, assetId, asset.name));
    }
  }

  return {
    images: uniqueReferences(images),
    videos: uniqueReferences(videos),
    audios: [],
  };
}

export function mergeCanvasVideoReferences(
  ...sources: readonly VideoGenerationReferences[]
): VideoGenerationReferences {
  return {
    images: uniqueReferences(sources.flatMap((source) => source.images || [])),
    videos: uniqueReferences(sources.flatMap((source) => source.videos || [])),
    audios: uniqueReferences(sources.flatMap((source) => source.audios || [])),
  };
}

export async function hydrateCanvasVideoReferences(
  inputs: readonly CanvasGenerationInput[],
  hydrators: CanvasVideoReferenceHydrators
): Promise<CanvasVideoReferenceHydrationResult> {
  const references: VideoGenerationReferences = {
    images: [],
    videos: [],
    audios: [],
  };
  const snapshot: CanvasVideoReferenceSnapshot = { items: [] };

  for (const input of uniqueGenerationInputs(inputs)) {
    if (input.type === "text") {
      snapshot.items.push({
        nodeId: input.nodeId,
        type: "text",
        title: input.title,
        source: "node",
        text: input.text || "",
      });
      continue;
    }

    const hydrated = await hydrateMediaInput(input as MediaInput, hydrators);
    snapshot.items.push(hydrated.snapshot);
    if (hydrated.reference.kind === "image")
      references.images.push(hydrated.reference);
    if (hydrated.reference.kind === "video")
      references.videos.push(hydrated.reference);
    if (hydrated.reference.kind === "audio")
      references.audios.push(hydrated.reference);
  }

  return { references, snapshot };
}

export function videoResultPersistentMetadata(
  result: VideoGenerationResult,
  archivedAsset?: ArchivedVideoAsset | null
): PersistentVideoResultMetadata {
  return definedFields({
    assetId: archivedAsset?.id || result.assetId,
    scope: archivedAsset?.scope || result.scope,
    mimeType: archivedAsset?.content_type || result.mimeType,
    bytes: positiveNumber(archivedAsset?.size),
    fileName: archivedAsset?.name || result.fileName,
  });
}

async function hydrateMediaInput(
  input: MediaInput,
  hydrators: CanvasVideoReferenceHydrators
): Promise<{
  reference:
    | VideoGenerationImageReference
    | VideoGenerationVideoReference
    | VideoGenerationAudioReference;
  snapshot: Extract<CanvasVideoReferenceSnapshotItem, { type: MediaKind }>;
}> {
  const assetId = input.assetId?.trim();
  const content = input.content?.trim();
  if (!assetId && !content)
    throw new Error(`引用“${input.title}”缺少可读取的媒体内容`);

  const source: "asset" | "node" = assetId ? "asset" : "node";
  const blob = assetId
    ? await hydrators.resolveAssetBlob({ ...input, assetId })
    : await hydrators.resolveNodeBlob({ ...input, content: content! });
  if (!blob) {
    throw new Error(
      source === "asset"
        ? `引用“${input.title}”的资产内容不存在`
        : `引用“${input.title}”的节点媒体不存在`
    );
  }
  if (blob.size <= 0) throw new Error(`引用“${input.title}”的媒体内容为空`);

  const mime = blob.type.trim().toLowerCase();
  assertMediaKind(input, mime);
  const name = input.title.trim() || `${input.type}-${input.nodeId}`;
  const file = new File([blob], name, { type: mime });
  const common = {
    id: input.nodeId,
    file,
    name: file.name,
    mime: file.type,
    bytes: file.size,
  };
  const snapshotCommon = {
    nodeId: input.nodeId,
    type: input.type,
    title: input.title,
    source,
    ...(assetId ? { assetId } : {}),
    scope: input.assetScope || hydrators.scope,
    name: file.name,
    mime: file.type,
    bytes: file.size,
  };

  if (input.type === "image") {
    const metadata = await hydrators.readImageMetadata(file);
    assertPositiveMetadata(input, "width", metadata.width);
    assertPositiveMetadata(input, "height", metadata.height);
    return {
      reference: {
        ...common,
        kind: "image",
        width: metadata.width,
        height: metadata.height,
      },
      snapshot: {
        ...snapshotCommon,
        type: "image",
        width: metadata.width,
        height: metadata.height,
      },
    };
  }

  if (input.type === "video") {
    const metadata = await hydrators.readVideoMetadata(file);
    assertPositiveMetadata(input, "width", metadata.width);
    assertPositiveMetadata(input, "height", metadata.height);
    assertPositiveMetadata(input, "durationMs", metadata.durationMs);
    return {
      reference: {
        ...common,
        kind: "video",
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
      },
      snapshot: {
        ...snapshotCommon,
        type: "video",
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
      },
    };
  }

  const metadata = await hydrators.readAudioMetadata(file);
  assertPositiveMetadata(input, "durationMs", metadata.durationMs);
  return {
    reference: { ...common, kind: "audio", durationMs: metadata.durationMs },
    snapshot: {
      ...snapshotCommon,
      type: "audio",
      durationMs: metadata.durationMs,
    },
  };
}

function uniqueGenerationInputs(inputs: readonly CanvasGenerationInput[]) {
  const seen = new Set<string>();
  return inputs.filter(input => {
    const assetId = input.assetId?.trim();
    const key = assetId ? `asset:${assetId}` : `node:${input.nodeId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertMediaKind(input: MediaInput, mime: string) {
  const expectedPrefix = `${input.type}/`;
  if (mime.startsWith(expectedPrefix)) return;
  const expectedLabel =
    input.type === "image" ? "图片" : input.type === "video" ? "视频" : "音频";
  throw new Error(
    `引用“${input.title}”的媒体类型不匹配：期望${expectedLabel}，实际${mime || "未知类型"}`
  );
}

function assertPositiveMetadata(
  input: MediaInput,
  field: "width" | "height" | "durationMs",
  value: number
) {
  if (Number.isFinite(value) && value > 0) return;
  const label =
    field === "width" ? "宽度" : field === "height" ? "高度" : "时长";
  throw new Error(`引用“${input.title}”的${label}读取失败`);
}

function positiveNumber(value: number | undefined) {
  return Number.isFinite(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function assetImageReference(id: string, assetId: string, name?: string): VideoGenerationImageReference {
  return {
    id,
    kind: "image",
    url: `asset://${assetId}`,
    name: name || assetId,
    mime: "image/png",
    bytes: 0,
    width: 0,
    height: 0,
  };
}

function uniqueReferences<T extends { id: string; url?: string }>(references: readonly T[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = reference.url?.trim() || reference.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function definedFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== ""
    )
  ) as T;
}
