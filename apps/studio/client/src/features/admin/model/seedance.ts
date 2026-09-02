import type { SeedanceAsset, SeedanceAssetListParams } from "@/entities/asset";

export type SeedanceAssetFilters = {
  search?: string;
  status?: string;
  type?: string;
  tagId?: string;
};

export type SeedanceUrlDialogDraft = {
  source_url: string;
  name: string;
  description: string;
  asset_type: "Image" | "Video";
  tag_ids: string[];
};

export type SeedanceUploadDialogDraft = {
  name: string;
  description: string;
  asset_type: "Image" | "Video";
  tag_ids: string[];
};

export type SeedanceTagDialogDraft = {
  name: string;
  color: string;
};

export type SeedanceEditDialogDraft = {
  name: string;
  description: string;
  tag_ids: string[];
};

export const SEEDANCE_FETCH_LIMIT = 100;
export const SEEDANCE_PAGE_SIZE = 10;
export const SEEDANCE_TAG_DEFAULT_COLOR = "#7dd3fc";
export const SEEDANCE_REFRESH_ATTEMPTS = 3;
export const SEEDANCE_REFRESH_DELAY_MS = 2_000;

export function buildSeedanceAssetListParams(
  filters: SeedanceAssetFilters = {}
): SeedanceAssetListParams {
  const search = filters.search?.trim();
  return {
    ...(search ? { search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.tagId ? { tag_id: filters.tagId } : {}),
    limit: SEEDANCE_FETCH_LIMIT,
  };
}

export function paginateSeedanceAssets<T>(
  items: readonly T[],
  page: number,
  pageSize = SEEDANCE_PAGE_SIZE
) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: currentPage,
    pageCount,
  };
}

export const emptySeedanceUrlDraft = (): SeedanceUrlDialogDraft => ({
  source_url: "",
  name: "",
  description: "",
  asset_type: "Image",
  tag_ids: [],
});

export const emptySeedanceUploadDraft = (): SeedanceUploadDialogDraft => ({
  name: "",
  description: "",
  asset_type: "Image",
  tag_ids: [],
});

export const emptySeedanceTagDraft = (): SeedanceTagDialogDraft => ({
  name: "",
  color: SEEDANCE_TAG_DEFAULT_COLOR,
});

export const emptySeedanceEditDraft = (): SeedanceEditDialogDraft => ({
  name: "",
  description: "",
  tag_ids: [],
});

export function isSeedanceTagColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function validateSeedanceUrlDraft(draft: SeedanceUrlDialogDraft) {
  const errors: {
    source_url?: string;
    asset_type?: string;
  } = {};
  const sourceURL = draft.source_url.trim();
  if (!sourceURL) errors.source_url = "请输入 Source URL";
  else {
    try {
      const parsed = new URL(sourceURL);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.source_url = "Source URL 仅支持 http 或 https";
      }
    } catch {
      errors.source_url = "请输入有效的 http/https 地址";
    }
  }
  if (!draft.asset_type) errors.asset_type = "请选择资产类型";
  return errors;
}

export function validateSeedanceUploadDraft(
  draft: SeedanceUploadDialogDraft,
  file: File | null
) {
  const errors: { file?: string; asset_type?: string } = {};
  if (!file) errors.file = "请选择图片或视频文件";
  else if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) {
    errors.file = "仅支持 image/* 或 video/*";
  }
  if (!draft.asset_type) errors.asset_type = "请选择资产类型";
  return errors;
}

export function seedanceEditDraft(asset: SeedanceAsset): SeedanceEditDialogDraft {
  return {
    name: asset.name,
    description: asset.description || "",
    tag_ids: (asset.tags || []).map(tag => tag.id),
  };
}
