import { createAssetFolder, getAssetFolders, uploadAsset } from "@/entities/asset";
import { createTag, listAllTags } from "@/entities/tag";
import { ApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { assetPackageUploadMetadata, PACKAGE_MAX_FOLDER_NAME, PACKAGE_MAX_TAG_NAME, type AssetPackageContents } from "./assetPackage";

// Retry name conflicts caused by simultaneous imports without overwriting data.
const MAX_NAME_ATTEMPTS = 100;
const defaultDependencies = { createAssetFolder, getAssetFolders, uploadAsset, createTag, listAllTags };
export type PackageImportProgress = { phase: string; completed: number; total: number; failures: Array<{ name: string; error: string }> };
const normalized = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const copyName = (name: string, suffix: number, limit: number) => {
  const ending = suffix ? `（导入 ${suffix}）` : "";
  return Array.from(name).slice(0, limit - Array.from(ending).length).join("") + ending;
};

/** One session survives retries/cancellation: completed files and created trees
 * are reused, and uncertain upload responses use the same idempotency key. */
export class AssetPackageImportSession {
  readonly folderIds = new Map<string, string>();
  readonly tagIds = new Map<string, string>();
  readonly completed = new Set<string>();
  private readonly sessionId = crypto.randomUUID();
  private readonly failures = new Map<string, { name: string; error: string }>();
  private running = false;

  constructor(readonly contents: AssetPackageContents, readonly scope: WorkspaceScope,
    private readonly fallbackFolderId?: string, private readonly deps = defaultDependencies) {}

  async run(onProgress: (progress: PackageImportProgress) => void, signal: AbortSignal) {
    if (this.running) return;
    this.running = true;
    const items = this.contents.items.filter(item => item.file);
    const report = (phase: string) => onProgress({ phase, completed: this.completed.size, total: items.length, failures: [...this.failures.values()] });
    const checkCanceled = () => { if (signal.aborted) throw new DOMException("导入已暂停，可继续导入", "AbortError"); };
    try {
      if (!items.length && !this.contents.folders.length) throw new Error("资产包中没有可导入的文件或目录");
      report("恢复文件夹");
      // Structured packages are always restored at the library root, preserving
      // the original depth even when a system folder is selected in the sidebar.
      const existingFolders = this.contents.folders.length ? await this.deps.getAssetFolders(this.scope) : [];
      for (const folder of this.contents.folders) {
        checkCanceled();
        if (this.folderIds.has(folder.id)) continue;
        const parent = folder.parent_id ? this.folderIds.get(folder.parent_id)! : "";
        for (let suffix = 0; suffix < existingFolders.length + MAX_NAME_ATTEMPTS; suffix++) {
          checkCanceled();
          const name = copyName(folder.name, suffix, PACKAGE_MAX_FOLDER_NAME);
          if (existingFolders.some(item => item.parent_id === parent && normalized(item.name) === normalized(name))) continue;
          try {
            const created = await this.deps.createAssetFolder({ name, parent_id: parent, sort_order: folder.sort_order }, this.scope);
            this.folderIds.set(folder.id, created.id);
            existingFolders.push(created);
            break;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) throw error;
          }
        }
        if (!this.folderIds.has(folder.id)) throw new Error(`无法创建目录：${folder.name}`);
      }
      report("恢复标签");
      const existingTags = this.contents.tags.length ? await this.deps.listAllTags(this.scope) : [];
      for (const tag of this.contents.tags) {
        checkCanceled();
        if (this.tagIds.has(tag.id)) continue;
        const parent = tag.parent_id ? this.tagIds.get(tag.parent_id)! : "";
        // Only reuse writable workspace definitions at the same full path.
        const match = existingTags.find(item => item.scope_type === "workspace" && item.status === "active" && item.asset_enabled && item.parent_id === parent && normalized(item.name) === normalized(tag.name));
        if (match) { this.tagIds.set(tag.id, match.id); continue; }
        for (let suffix = 0; suffix < existingTags.length + MAX_NAME_ATTEMPTS; suffix++) {
          checkCanceled();
          const name = copyName(tag.name, suffix, PACKAGE_MAX_TAG_NAME);
          if (existingTags.some(item => item.scope_type === "workspace" && item.parent_id === parent && normalized(item.name) === normalized(name))) continue;
          try {
            const created = await this.deps.createTag(this.scope, { name, parent_id: parent, description: tag.description,
              inherit_mode: tag.inherit_mode, asset_enabled: true, prompt_enabled: false, scope_type: "workspace" });
            this.tagIds.set(tag.id, created.id);
            existingTags.push(created);
            break;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) throw error;
          }
        }
        if (!this.tagIds.has(tag.id)) throw new Error(`无法创建标签：${tag.name}`);
      }
      for (const item of items) {
        checkCanceled();
        if (this.completed.has(item.asset.id)) continue;
        report(`正在导入：${item.asset.name}`);
        const folder = this.folderIds.get(item.asset.folder_id || "") || (this.contents.folders.length ? undefined : this.fallbackFolderId);
        const tagIds = item.asset.tag_ids?.map(id => this.tagIds.get(id)!);
        try {
          await this.deps.uploadAsset(item.file!, {
            ...assetPackageUploadMetadata(item.asset, folder, tagIds),
            idempotency_key: `asset-package:${this.sessionId}:${item.asset.id}`,
          }, this.scope, signal);
          this.completed.add(item.asset.id);
          this.failures.delete(item.asset.id);
        } catch (error) {
          checkCanceled();
          this.failures.set(item.asset.id, { name: item.asset.name, error: error instanceof Error ? error.message : "上传失败" });
        }
        report("导入资产");
      }
      report(this.failures.size ? "部分资产导入失败，可重试" : "导入完成");
    } finally {
      this.running = false;
    }
  }
}
