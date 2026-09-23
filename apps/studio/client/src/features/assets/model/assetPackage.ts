import { createZip } from "./zip";
import { openPackageArchive, readPackageEntry, PACKAGE_MAX_ASSETS, PACKAGE_MAX_METADATA_BYTES, checkPackageCanceled } from "./packageArchive";
import type { Asset } from "@/entities/asset";
import { ASSET_CATEGORIES } from "@/entities/asset/model";
import { z } from "zod";

/**
 * 资产包（zip）导入导出。包结构沿用旧版 app/(user)/assets/asset-transfer.ts：
 * assets.json 清单 + files/<id>.<ext> 二进制，便于两版之间互通。
 */

export const ASSET_PACKAGE_MANIFEST = "assets.json";

export type AssetPackageEntry = {
  assetId: string;
  path: string;
  mimeType: string;
  bytes: number;
};

export type AssetPackageFile = {
  app: string;
  version: number;
  exportedAt: string;
  assets: Asset[];
  files: AssetPackageEntry[];
};

export type AssetPackageItem = {
  asset: Asset & { tag_ids?: string[] };
  file?: File;
  // Retain only the ZIP source and entry descriptor between sequential uploads.
  readFile?: (signal?: AbortSignal, onProgress?: (percent: number) => void) => Promise<File>;
};

export { PACKAGE_MAX_ASSETS } from "./packageArchive";
// Match the API's folder/tag constraints before any mutations.
export const PACKAGE_MAX_FOLDER_DEPTH = 6;
export const PACKAGE_MAX_TAG_DEPTH = 8;
export const PACKAGE_MAX_FOLDER_NAME = 80;
export const PACKAGE_MAX_TAG_NAME = 64;
const PACKAGE_MAX_TAG_DESCRIPTION = 1000;
const PACKAGE_MAX_DEFINITIONS = 20000;
// Metadata should stay small even when the media payload is large.
const CURRENT_PACKAGE_VERSION = 2;
const LEGACY_EXPORT_MANIFEST = "manifest.json";
const textId = z.string().min(1);
const folderSchema = z.object({ id: textId, parent_id: z.string().default(""), name: z.string().trim().min(1).refine(value => Array.from(value).length <= PACKAGE_MAX_FOLDER_NAME), sort_order: z.number().int().default(0) });
const tagSchema = z.object({ id: textId, parent_id: z.string().default(""), name: z.string().trim().min(1).refine(value => Array.from(value).length <= PACKAGE_MAX_TAG_NAME), description: z.string().refine(value => Array.from(value).length <= PACKAGE_MAX_TAG_DESCRIPTION).default(""), inherit_mode: z.enum(["auto", "manual", "never"]).default("auto") });
const assetSchema = z.object({
  id: textId, name: textId, type: z.enum(["image", "video", "audio"]),
  content_type: z.string().optional(), folder_id: z.string().optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  tags: z.array(z.string()).default([]), tag_ids: z.array(textId).optional(), note: z.string().optional(),
});
const manifestSchema = z.object({
  app: z.literal("ai-manju-studio"), version: z.number().int().min(1).max(CURRENT_PACKAGE_VERSION),
  assets: z.array(assetSchema).max(PACKAGE_MAX_ASSETS),
  files: z.array(z.object({ assetId: textId, path: textId, mimeType: z.string(), bytes: z.number().int().nonnegative() })).max(PACKAGE_MAX_ASSETS),
  folders: z.array(folderSchema).max(PACKAGE_MAX_DEFINITIONS).default([]),
  tags: z.array(tagSchema).max(PACKAGE_MAX_DEFINITIONS).default([]),
  failed: z.array(z.string()).default([]),
});

export type PackageFolder = z.infer<typeof folderSchema>;
export type PackageTag = z.infer<typeof tagSchema>;
export type AssetPackageContents = { items: AssetPackageItem[]; folders: PackageFolder[]; tags: PackageTag[]; warnings: string[] };

const PACKAGE_APP = "ai-manju-studio";
const PACKAGE_VERSION = 1;

export async function createAssetPackage(items: Array<{ asset: Asset; blob: Blob | null }>) {
  const files: AssetPackageEntry[] = [];
  const zipFiles: Array<{ name: string; data: BlobPart }> = [];

  items.forEach(({ asset, blob }) => {
    if (!blob?.size) return;
    const path = `files/${safeFileName(asset.id)}${fileExtension(blob.type, asset.name)}`;
    files.push({ assetId: asset.id, path, mimeType: blob.type || asset.content_type || "application/octet-stream", bytes: blob.size });
    zipFiles.push({ name: path, data: blob });
  });

  const manifest: AssetPackageFile = {
    app: PACKAGE_APP,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    assets: items.map((item) => item.asset),
    files,
  };

  return createZip([{ name: ASSET_PACKAGE_MANIFEST, data: JSON.stringify(manifest, null, 2) }, ...zipFiles]);
}

export async function readAssetPackage(file: Blob): Promise<AssetPackageItem[]> {
  // Compatibility helper for callers explicitly requesting materialized files.
  const contents = await readAssetPackageContents(file);
  for (const item of contents.items) if (item.readFile) item.file = await item.readFile();
  return contents.items;
}

function safeArchivePath(path: string) {
  return !path.includes("\\") && !path.includes("\0") && !path.includes(":") && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

export function orderedPackageTree<T extends { id: string; parent_id: string }>(items: T[], maxDepth: number): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length) throw new Error("资产包含有重复的目录或标签标识");
  const ordered: T[] = [];
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (item: T, traversalDepth = 1): number => {
    if (depths.has(item.id)) return depths.get(item.id)!;
    if (visiting.has(item.id) || traversalDepth > maxDepth) throw new Error("资产包目录或标签层级无效");
    visiting.add(item.id);
    const parent = item.parent_id ? byId.get(item.parent_id) : undefined;
    if (item.parent_id && !parent) throw new Error("资产包缺少上级目录或标签");
    const depth = parent ? visit(parent, traversalDepth + 1) + 1 : 1;
    if (depth > maxDepth) throw new Error("资产包目录或标签层级过深");
    visiting.delete(item.id);
    depths.set(item.id, depth);
    ordered.push(item);
    return depth;
  };
  items.forEach(item => visit(item));
  return ordered;
}

function convertLegacyExport(raw: unknown) {
  const parsed = z.object({ version: z.literal(1), assets: z.array(z.object({
    asset_id: textId, name: textId, type: z.enum(["image", "video", "audio"]),
    content_type: z.string(), size: z.number().int().nonnegative(), archive_path: z.string().optional(),
    folder_path: z.string(), category: z.string(), tags: z.array(z.string()), status: z.string(), note: z.string().optional(),
  })).max(PACKAGE_MAX_ASSETS) }).parse(raw);
  const folders = new Map<string, PackageFolder>();
  const successful = parsed.assets.filter(asset => asset.status === "succeeded");
  for (const asset of successful) {
    if (!asset.folder_path) continue;
    if (!safeArchivePath(asset.folder_path)) throw new Error("资产包目录路径无效");
    let parent = "";
    for (const name of asset.folder_path.split("/")) {
      const id = parent ? `${parent}/${name}` : name;
      folders.set(id, { id, parent_id: parent, name, sort_order: 0 });
      parent = id;
    }
  }
  return { app: PACKAGE_APP, version: 1, folders: [...folders.values()],
    assets: successful.map(asset => ({ ...asset, id: asset.asset_id, folder_id: asset.folder_path })),
    files: successful.map(asset => ({ assetId: asset.asset_id, path: asset.archive_path, mimeType: asset.content_type, bytes: asset.size })),
    failed: parsed.assets.filter(asset => asset.status !== "succeeded").map(asset => asset.name),
  };
}

export async function readAssetPackageContents(file: Blob, signal?: AbortSignal): Promise<AssetPackageContents> {
  const zip = await openPackageArchive(file, signal);
  const manifestBlob = zip.get(ASSET_PACKAGE_MANIFEST);
  const legacy = zip.get(LEGACY_EXPORT_MANIFEST);
  if (!manifestBlob && !legacy) throw new Error("资产包缺少 assets.json 或 manifest.json 清单");
  const manifestEntry = (manifestBlob || legacy)!;
  if (manifestEntry.uncompressedSize > PACKAGE_MAX_METADATA_BYTES) throw new Error("资产包清单过大，请分目录导入");
  const manifestData = await readPackageEntry(manifestEntry, "application/json", signal);
  let manifest: z.infer<typeof manifestSchema>;
  try {
    const raw = JSON.parse(await manifestData.text());
    manifest = manifestSchema.parse(manifestBlob ? raw : convertLegacyExport(raw));
  } catch {
    throw new Error("资产包清单无效或版本不支持，请重新导出资产包");
  }
  checkPackageCanceled(signal);
  const folders = orderedPackageTree(manifest.folders, PACKAGE_MAX_FOLDER_DEPTH);
  const tags = orderedPackageTree(manifest.tags, PACKAGE_MAX_TAG_DEPTH);
  const folderIds = new Set(folders.map(folder => folder.id));
  const tagIds = new Set(tags.map(tag => tag.id));
  const entriesByAsset = new Map(manifest.files.map(entry => [entry.assetId, entry]));
  const assetIds = new Set(manifest.assets.map(asset => asset.id));
  if (entriesByAsset.size !== manifest.files.length || assetIds.size !== manifest.assets.length || new Set(manifest.files.map(entry => entry.path)).size !== manifest.files.length) throw new Error("资产包含有重复的文件或资产标识");
  if (manifest.files.some(entry => !assetIds.has(entry.assetId) || !safeArchivePath(entry.path))) throw new Error("资产包文件路径或关联无效");
  const warnings = manifest.failed.map(name => `导出时未能包含：${name || "未知资产"}`);
  const items = manifest.assets.map((asset): AssetPackageItem => {
    if ((manifest.version === CURRENT_PACKAGE_VERSION || folders.length > 0) && asset.folder_id && !folderIds.has(asset.folder_id)) throw new Error("资产包缺少资产所属目录");
    if (asset.tag_ids?.some(id => !tagIds.has(id))) throw new Error("资产包缺少标签定义");
    const entry = entriesByAsset.get(asset.id);
    const source = entry ? zip.get(entry.path) : undefined;
    if (!source || !source.uncompressedSize) {
      if (manifest.version === CURRENT_PACKAGE_VERSION || legacy && !manifestBlob) throw new Error(`资产包缺少文件：${asset.name}`);
      warnings.push(`缺少文件，已跳过：${asset.name}`);
      return { asset };
    }
    if (entry!.bytes !== source.uncompressedSize) throw new Error(`资产包文件大小不符：${asset.name}`);
    const mimeType = entry?.mimeType || asset.content_type || "application/octet-stream";
    const name = `${asset.name || asset.id}${hasExtension(asset.name) ? "" : fileExtension(mimeType, asset.name)}`;
    return { asset, readFile: async (signal, onProgress) => {
      const blob = await readPackageEntry(source, mimeType, signal, onProgress);
      return new File([blob], name, { type: mimeType });
    } };
  });
  if (!items.length && !folders.length) throw new Error("资产包中没有可导入的文件或目录");
  return { items, folders, tags, warnings };
}

/** 从资产包条目还原上传元数据，保留分类、标签与备注。 */
export function assetPackageUploadMetadata(asset: Asset, folderId?: string, tagIds?: string[]) {
  const metadata: Record<string, string> = {
    name: asset.name || asset.id,
    source_type: "manual_upload",
  };
  if (folderId) metadata.folder_id = folderId;
  if (asset.category) metadata.category = asset.category;
  if (tagIds?.length) metadata.tag_ids = JSON.stringify(tagIds);
  else if (asset.tags?.length) metadata.tags = JSON.stringify(asset.tags);
  if (asset.note) metadata.note = asset.note;
  return metadata;
}

function hasExtension(name?: string) {
  return Boolean(name && /\.[a-zA-Z0-9]{1,6}$/.test(name));
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function fileExtension(mimeType: string, fallbackName?: string) {
  const fromName = fallbackName ? /\.[a-zA-Z0-9]{1,6}$/.exec(fallbackName)?.[0] : undefined;
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
  };
  return map[mimeType] || ".bin";
}
