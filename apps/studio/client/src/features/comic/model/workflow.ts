import type {
  ComicAnalysisDetail,
  ComicAnalysisRevision,
  ComicAsset,
  ComicAssetClass,
  ComicAssetGenerationConfigInput,
  ComicAssetInput,
  ComicAssetProject,
  ComicGenerationBatch,
  ComicProjectInput,
  ImportComicProjectInput,
} from "@/entities/comic";

export type ComicAssetDraft = {
  name: string;
  state: string;
  class: ComicAssetClass;
  visual_description: string;
  prompt: string;
};

export type ComicProjectDraft = {
  title: string;
  stylePreset: string;
};

export type ComicBatchDraft = {
  assetIds: string[];
  modelSelector: string;
  size: string;
  quality: string;
  outputFormat: string;
  variantsPerAsset: number;
  referenceAssetIds: string[];
  concurrency: 1 | 2;
  destinationMode: "auto" | "custom";
  destinationFolderId: string;
  createCategorySubfolders: boolean;
  assetConfigs?: ComicAssetGenerationConfigInput[];
};

export function comicProjectInput(draft: ComicProjectDraft): ComicProjectInput {
  return {
    title: draft.title.trim(),
    style_preset: draft.stylePreset.trim(),
  };
}

export function comicImportInput(
  draft: ComicProjectDraft,
  assets: ComicAssetInput[]
): ImportComicProjectInput {
  return {
    ...comicProjectInput(draft),
    source_type: "workbook",
    assets,
  };
}

export function comicAnalysisInput(input: {
  title: string;
  stylePreset: string;
  sourceText: string;
  instruction: string;
  model: string;
}) {
  return {
    title: input.title.trim(),
    style_preset: input.stylePreset.trim(),
    source_text: input.sourceText,
    instruction: input.instruction.trim(),
    model: input.model,
  };
}

export function comicRevisionInput(input: {
  instruction: string;
  model: string;
  parentRevisionId: string;
  expectedActiveRevisionId: string;
}) {
  return {
    instruction: input.instruction.trim(),
    model: input.model,
    parent_revision_id: input.parentRevisionId,
    expected_active_revision_id: input.expectedActiveRevisionId,
  };
}

export function comicBatchInput(draft: ComicBatchDraft) {
  return {
    asset_ids: draft.assetIds,
    model_selector: draft.modelSelector,
    size: draft.size,
    quality: draft.quality,
    output_format: draft.outputFormat,
    variants_per_asset: draft.variantsPerAsset,
    reference_asset_ids: draft.referenceAssetIds,
    concurrency: draft.concurrency,
    destination_mode: draft.destinationMode,
    ...(draft.destinationMode === "custom"
      ? { destination_folder_id: draft.destinationFolderId }
      : {}),
    create_category_subfolders: draft.createCategorySubfolders,
    ...(draft.assetConfigs ? { asset_configs: draft.assetConfigs } : {}),
  };
}

export function activeComicRevision(
  analysis: ComicAnalysisDetail | null
): ComicAnalysisRevision | undefined {
  return (
    analysis?.revisions.find(
      revision => revision.id === analysis.session.active_revision_id
    ) || analysis?.revisions.at(-1)
  );
}

export function comicAssetDraft(asset: ComicAsset): ComicAssetDraft {
  return {
    name: asset.name,
    state: asset.state || "",
    class: asset.class,
    visual_description: asset.visual_description || "",
    prompt:
      asset.draft_prompt || asset.approved_prompt || asset.source_prompt || "",
  };
}

export function comicAssetMetadataInput(
  asset: ComicAsset,
  draft: ComicAssetDraft
): ComicAssetInput | null {
  const changed =
    draft.name !== asset.name ||
    draft.state !== (asset.state || "") ||
    draft.class !== asset.class ||
    draft.visual_description !== (asset.visual_description || "");
  if (!changed) return null;
  return {
    name: draft.name.trim() || asset.name,
    state: draft.state.trim(),
    class: draft.class,
    visual_description: draft.visual_description.trim(),
  };
}

export function filterComicAssets(
  assets: ComicAsset[],
  assetClass: ComicAssetClass | "",
  keyword: string
) {
  const search = keyword.trim();
  return assets.filter(
    asset =>
      (!assetClass || asset.class === assetClass) &&
      (!search ||
        [
          asset.name,
          asset.code,
          asset.state,
          asset.visual_description,
          asset.draft_prompt,
          asset.approved_prompt,
        ]
          .join(" ")
          .includes(search))
  );
}

export function latestComicBatch(batches: ComicGenerationBatch[]) {
  return [...batches].sort(
    (left, right) =>
      new Date(right.created_at).getTime() -
      new Date(left.created_at).getTime()
  )[0];
}

export function isComicBatchActive(status?: string) {
  return ["queued", "running", "paused", "stopping"].includes(status || "");
}

export function comicBatchProgress(batch: ComicGenerationBatch) {
  return batch.total
    ? Math.round(
        ((batch.succeeded + batch.failed + batch.canceled) / batch.total) * 100
      )
    : 0;
}

export function comicProjectSourceName(project: ComicAssetProject) {
  return project.source_file_name || `${project.title}.txt`;
}
