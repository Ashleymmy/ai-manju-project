import { createZip, readZip } from "./zip";
import type { Asset } from "@/entities/asset";

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
  asset: Asset;
  file?: File;
};

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
  const zip = await readZip(file);
  const manifestBlob = zip.get(ASSET_PACKAGE_MANIFEST);
  if (!manifestBlob) throw new Error("资产包缺少 assets.json 清单");

  const manifest = JSON.parse(await manifestBlob.text()) as AssetPackageFile;
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const entriesByAsset = new Map((manifest.files || []).map((entry) => [entry.assetId, entry]));

  return assets.map((asset) => {
    const entry = entriesByAsset.get(asset.id);
    const blob = entry ? zip.get(entry.path) : undefined;
    if (!blob) return { asset };
    const mimeType = entry?.mimeType || asset.content_type || "application/octet-stream";
    const name = `${asset.name || asset.id}${hasExtension(asset.name) ? "" : fileExtension(mimeType, asset.name)}`;
    return { asset, file: new File([blob], name, { type: mimeType }) };
  });
}

/** 从资产包条目还原上传元数据，保留分类、标签与备注。 */
export function assetPackageUploadMetadata(asset: Asset, folderId?: string) {
  const metadata: Record<string, string> = {
    name: asset.name || asset.id,
    source_type: asset.source_type || "manual_upload",
  };
  if (folderId) metadata.folder_id = folderId;
  if (asset.category) metadata.category = asset.category;
  if (asset.tags?.length) metadata.tag_ids = asset.tags.join(",");
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
