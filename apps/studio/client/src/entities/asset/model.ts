import type { WorkspaceScope } from "@/shared/config";

export type AssetCategory =
  | "character"
  | "environment"
  | "costume"
  | "prop"
  | "ui"
  | "reference"
  | "other";

export const ASSET_CATEGORIES: readonly AssetCategory[] = [
  "character",
  "environment",
  "costume",
  "prop",
  "ui",
  "reference",
  "other",
] as const;

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  character: "人物",
  environment: "场景",
  costume: "服饰",
  prop: "道具",
  ui: "UI",
  reference: "参考",
  other: "其他",
};

export const ASSET_CATEGORY_OPTIONS: Array<{ value: AssetCategory; label: string }> =
  ASSET_CATEGORIES.map(value => ({ value, label: ASSET_CATEGORY_LABELS[value] }));

export function normalizeAssetCategory(value?: string | null): AssetCategory {
  return ASSET_CATEGORIES.includes(value as AssetCategory)
    ? (value as AssetCategory)
    : "other";
}

export type AssetSourceType =
  | "manual_upload"
  | "image_workbench"
  | "canvas"
  | "comic_batch"
  | "legacy"
  | "unknown";

export type AssetUserState = {
  reaction: "none" | "favorite" | "dislike";
  private_note: string;
};

export type Asset = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  url?: string;
  size?: number;
  content_type?: string;
  folder_id?: string;
  category?: AssetCategory;
  tags?: string[];
  note?: string;
  source_type?: AssetSourceType;
  source_project_id?: string;
  source_project_name?: string;
  source_job_id?: string;
  source_metadata?: Record<string, unknown>;
  usage_stats?: {
    generation_use_count?: number;
    active_reference_count?: number;
    download_count?: number;
    export_count?: number;
  };
  user_state?: AssetUserState;
  trashed_at?: string;
  trash_expires_at?: string;
  trash_remaining_days?: number;
  trash_remaining_seconds?: number;
  trash_risk_warning?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AssetFolder = {
  id: string;
  parent_id: string;
  name: string;
  kind: "system" | "user";
  system_key?: string;
  source_ref_id?: string;
  source_ref_type?: string;
  asset_count: number;
  descendant_asset_count: number;
  sort_order: number;
};

/** Legacy automatic calendar folders are not user-created date-named folders. */
const DATE_ARCHIVE_KEYS = new Set(["canvas_project_date", "image_workbench_month"]);

/** Keep older/cached API folders consistent with the current built-in labels and order. */
const SYSTEM_FOLDER_PRESENTATION: Record<string, { name?: string; sort_order?: number }> = {
  comic: { name: "资产助手" },
  canvas: { sort_order: 0 },
};

export function isDateArchiveFolder(folder: AssetFolder) {
  return folder.kind === "system" && DATE_ARCHIVE_KEYS.has(folder.system_key || "");
}

/** Promote children of retired automatic folders in every library navigation. */
export function visibleAssetLibraryFolders(folders: readonly AssetFolder[]): AssetFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const hiddenIds = new Set(folders.filter(folder => isDateArchiveFolder(folder)
    || (folder.kind === "system" && folder.system_key === "system_root"))
    .map(folder => folder.id));
  return folders.filter(folder => !hiddenIds.has(folder.id)).map(folder => {
    let parentId = folder.parent_id;
    const seen = new Set([folder.id]);
    while (hiddenIds.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = byId.get(parentId)?.parent_id || "";
    }
    const presentation = folder.kind === "system" ? SYSTEM_FOLDER_PRESENTATION[folder.system_key || ""] : undefined;
    return !presentation && parentId === folder.parent_id ? folder : { ...folder, ...presentation, parent_id: parentId };
  });
}

export type AssetLibraryQuery = {
  folderId?: string;
  includeDescendants?: boolean;
  smartView?: "favorite" | "dislike" | "unused" | "frequent" | "";
  type?: Asset["type"] | "";
  category?: AssetCategory | "";
  sourceType?: AssetSourceType | "";
  keyword?: string;
  tagIds?: string[];
  tagMatch?: "and" | "or";
  includeTagDescendants?: boolean;
  createdFrom?: string;
  createdTo?: string;
  sourceProjectId?: string;
  page?: number;
  pageSize?: number;
  sort?: "created_at_desc" | "created_at_asc" | "name_asc" | "name_desc";
};

export type AssetLibraryResponse = {
  items: Asset[];
  total: number;
  page: number;
  page_size: number;
};

export type AssetTrashPreflight = {
  total: number;
  size: number;
  references: Array<{ asset_id: string; count: number; locations?: string[] }>;
};

export type AssetExportStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial_failed"
  | "failed"
  | "canceled"
  | "expired";

export type AssetExportBatch = {
  id: string;
  status: AssetExportStatus;
  selection_mode: "selected" | "filter" | "folder";
  total: number;
  succeeded: number;
  failed: number;
  size: number;
  file_name?: string;
  error?: string;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type AssetExportFilter = Pick<
  AssetLibraryQuery,
  | "folderId"
  | "includeDescendants"
  | "smartView"
  | "type"
  | "createdFrom"
  | "createdTo"
  | "includeTagDescendants"
  | "category"
  | "sourceType"
  | "keyword"
  | "tagIds"
  | "tagMatch"
  | "sort"
>;

export type AssetUsageEvent = {
  id: string;
  asset_id: string;
  event_type: string;
  source_type?: string;
  source_project_id?: string;
  source_node_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type AssetLineageEntry = {
  id?: string;
  parent_asset_id?: string;
  child_asset_id?: string;
  relation_type?: string;
  source_project_id?: string;
  source_node_id?: string;
  source_job_id?: string;
  created_at?: string;
};

export type AssetLineageView = {
  parents: AssetLineageEntry[];
  children: AssetLineageEntry[];
};

export type SeedanceAssetTag = {
  id: string;
  name: string;
  color?: string;
  scope?: string;
};

export type SeedanceAsset = {
  id: string;
  provider_id?: string;
  provider_protocol?: "tokenspace_material" | "volcano_asset" | string;
  volcano_asset_id: string;
  volcano_group_id?: string;
  name: string;
  description?: string;
  asset_type: "Image" | "Video" | string;
  storage_key?: string;
  source_url?: string;
  content_type?: string;
  size?: number;
  status: string;
  error_message?: string;
  tags?: SeedanceAssetTag[];
  created_at?: string;
  updated_at?: string;
  last_sync_at?: string;
};

export type SeedanceAssetList = {
  items: SeedanceAsset[];
  total: number;
};

export type SeedanceAssetReadiness = {
  provider_configured: boolean;
  provider_id?: string;
  provider_protocol?: "tokenspace_material" | "volcano_asset" | string;
  provider_error?: string;
  material_initialization_url?: string;
  upload_registration_available: boolean;
  public_asset_base_url_configured: boolean;
};

export type SeedanceAssetListParams = {
  provider_id?: string;
  scope?: WorkspaceScope;
  status?: string;
  type?: string;
  tag_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
};
