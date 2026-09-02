import { getAssetContentObjectUrl, getAssetLibrary, type Asset } from "@/entities/asset";
import { getProjects, getProjectSnapshot, type CanvasProject } from "@/entities/project";
import type { WorkspaceScope } from "@/shared/config";
import { loadStoredVideoHistory, loadStoredVideoMedia } from "@/services/video-history";
import { uploadWebdavFile, WEBDAV_MANIFEST_FILE_NAME } from "./webdavSync";
import type { WebdavSyncConfig } from "../model/webdavConfig";

/**
 * 离线备份引擎：把工作区数据导出到用户自有的 WebDAV 存储。
 *
 * 与旧版（本地优先架构下的跨设备同步）的差别：画布与资产现已由服务端持久化，
 * 服务端本身就是同步source of truth，因此这里从服务端 API 读取并单向写入 WebDAV，
 * 语义是「离线备份」；视频历史仍在浏览器 IndexedDB，是唯一的本地专有域。
 */

export type AppSyncDomainKey = "canvas" | "assets" | "video-workbench";

export const APP_SYNC_DOMAIN_LABELS: Record<AppSyncDomainKey, string> = {
  canvas: "画布项目",
  assets: "资产库",
  "video-workbench": "视频生成历史",
};

export type AppSyncDomainResult = {
  domain: AppSyncDomainKey;
  records: number;
  files: number;
  skipped: number;
  error?: string;
};

export type AppSyncResult = {
  startedAt: string;
  finishedAt: string;
  domains: AppSyncDomainResult[];
  ok: boolean;
};

export type AppSyncProgressEvent = {
  domain: AppSyncDomainKey;
  phase: "reading" | "uploading-files" | "uploading-manifest" | "done" | "failed";
  completed: number;
  total: number;
  message?: string;
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

export type AppSyncOptions = {
  scope?: WorkspaceScope;
  domains?: AppSyncDomainKey[];
  onProgress?: AppSyncProgress;
};

type DomainManifest = {
  app: string;
  version: number;
  domain: AppSyncDomainKey;
  exportedAt: string;
  scope: WorkspaceScope;
  data: unknown;
  files: Array<{ path: string; sourceId: string; mimeType: string; bytes: number }>;
};

const MANIFEST_APP = "ai-manju-studio";
const MANIFEST_VERSION = 1;
const MAX_ASSET_FILES = 500;

export async function backupAppDataToWebdav(config: WebdavSyncConfig, options: AppSyncOptions = {}): Promise<AppSyncResult> {
  const scope = options.scope || "personal";
  const domains = options.domains?.length ? options.domains : (["canvas", "assets", "video-workbench"] as AppSyncDomainKey[]);
  const startedAt = new Date().toISOString();
  const results: AppSyncDomainResult[] = [];

  for (const domain of domains) {
    try {
      if (domain === "canvas") results.push(await backupCanvasDomain(config, scope, options.onProgress));
      else if (domain === "assets") results.push(await backupAssetDomain(config, scope, options.onProgress));
      else results.push(await backupVideoHistoryDomain(config, scope, options.onProgress));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onProgress?.({ domain, phase: "failed", completed: 0, total: 0, message });
      results.push({ domain, records: 0, files: 0, skipped: 0, error: message });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    domains: results,
    ok: results.every((item) => !item.error),
  };
}

async function backupCanvasDomain(config: WebdavSyncConfig, scope: WorkspaceScope, onProgress?: AppSyncProgress): Promise<AppSyncDomainResult> {
  onProgress?.({ domain: "canvas", phase: "reading", completed: 0, total: 0 });
  const response = await getProjects(scope);
  const projects: CanvasProject[] = Array.isArray(response) ? response : response.items || [];
  const snapshots: Array<{ project: CanvasProject; data: unknown }> = [];
  let skipped = 0;

  for (const [index, project] of projects.entries()) {
    onProgress?.({ domain: "canvas", phase: "reading", completed: index, total: projects.length, message: project.title });
    try {
      const snapshot = await getProjectSnapshot(project.id, scope);
      snapshots.push({ project, data: snapshot.data });
    } catch {
      skipped += 1;
    }
  }

  await writeManifest(config, {
    app: MANIFEST_APP,
    version: MANIFEST_VERSION,
    domain: "canvas",
    exportedAt: new Date().toISOString(),
    scope,
    data: { projects: snapshots },
    files: [],
  }, onProgress);

  return { domain: "canvas", records: snapshots.length, files: 0, skipped };
}

async function backupAssetDomain(config: WebdavSyncConfig, scope: WorkspaceScope, onProgress?: AppSyncProgress): Promise<AppSyncDomainResult> {
  onProgress?.({ domain: "assets", phase: "reading", completed: 0, total: 0 });
  const assets: Asset[] = [];
  for (let page = 1; assets.length < MAX_ASSET_FILES; page += 1) {
    const result = await getAssetLibrary(scope, { page, pageSize: 100, sort: "created_at_desc" });
    const items = result.items || [];
    assets.push(...items);
    onProgress?.({ domain: "assets", phase: "reading", completed: assets.length, total: result.total || assets.length });
    if (!items.length || assets.length >= (result.total || 0)) break;
  }

  const files: DomainManifest["files"] = [];
  let skipped = 0;
  for (const [index, asset] of assets.entries()) {
    onProgress?.({ domain: "assets", phase: "uploading-files", completed: index, total: assets.length, message: asset.name });
    let objectUrl = "";
    try {
      objectUrl = await getAssetContentObjectUrl(asset.id, scope);
      const blob = await fetch(objectUrl).then((response) => response.blob());
      if (!blob.size) {
        skipped += 1;
        continue;
      }
      const path = `assets/files/${safeFileName(asset.id)}${fileExtension(blob.type, asset.name)}`;
      await uploadWebdavFile(config, path, blob, blob.type || "application/octet-stream");
      files.push({ path, sourceId: asset.id, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
    } catch {
      skipped += 1;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  await writeManifest(config, {
    app: MANIFEST_APP,
    version: MANIFEST_VERSION,
    domain: "assets",
    exportedAt: new Date().toISOString(),
    scope,
    data: { assets },
    files,
  }, onProgress);

  return { domain: "assets", records: assets.length, files: files.length, skipped };
}

async function backupVideoHistoryDomain(config: WebdavSyncConfig, scope: WorkspaceScope, onProgress?: AppSyncProgress): Promise<AppSyncDomainResult> {
  onProgress?.({ domain: "video-workbench", phase: "reading", completed: 0, total: 0 });
  const history = await loadStoredVideoHistory();
  const files: DomainManifest["files"] = [];
  let skipped = 0;

  for (const [index, item] of history.entries()) {
    onProgress?.({ domain: "video-workbench", phase: "uploading-files", completed: index, total: history.length, message: item.prompt?.slice(0, 24) });
    const storageKey = item.resultStorageKey;
    if (!storageKey) continue;
    try {
      const entry = await loadStoredVideoMedia(storageKey);
      if (!entry.blob.size) {
        skipped += 1;
        continue;
      }
      const path = `video-workbench/files/${safeFileName(storageKey)}${fileExtension(entry.mime || entry.blob.type, entry.name || storageKey)}`;
      await uploadWebdavFile(config, path, entry.blob, entry.mime || entry.blob.type || "video/mp4");
      files.push({ path, sourceId: storageKey, mimeType: entry.mime || entry.blob.type || "video/mp4", bytes: entry.blob.size });
    } catch {
      skipped += 1;
    }
  }

  await writeManifest(config, {
    app: MANIFEST_APP,
    version: MANIFEST_VERSION,
    domain: "video-workbench",
    exportedAt: new Date().toISOString(),
    scope,
    data: { history },
    files,
  }, onProgress);

  return { domain: "video-workbench", records: history.length, files: files.length, skipped };
}

async function writeManifest(config: WebdavSyncConfig, manifest: DomainManifest, onProgress?: AppSyncProgress) {
  onProgress?.({ domain: manifest.domain, phase: "uploading-manifest", completed: 0, total: 1 });
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  await uploadWebdavFile(config, `${manifest.domain}/${WEBDAV_MANIFEST_FILE_NAME}`, blob, "application/json");
  onProgress?.({ domain: manifest.domain, phase: "done", completed: 1, total: 1 });
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function fileExtension(mimeType: string, fallbackName: string) {
  const fromName = /\.([a-zA-Z0-9]{1,6})$/.exec(fallbackName)?.[0];
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
