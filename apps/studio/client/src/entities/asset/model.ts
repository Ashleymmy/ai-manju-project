export type AssetCategory =
  | "character"
  | "environment"
  | "costume"
  | "prop"
  | "ui"
  | "reference"
  | "other";

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
  usage_stats?: {
    generation_use_count?: number;
    active_reference_count?: number;
    download_count?: number;
    export_count?: number;
  };
  user_state?: AssetUserState;
  trashed_at?: string;
  trash_expires_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type AssetFolder = {
  id: string;
  parent_id: string;
  name: string;
  kind: "system" | "user";
  system_key?: string;
  asset_count: number;
  descendant_asset_count: number;
  sort_order: number;
};

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
  status?: string;
  type?: string;
  tag_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
};
