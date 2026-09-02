import {
  bulkApproveComicPrompts,
  createComicAsset,
  deleteComicAsset,
  optimizeComicPrompt,
  previewComicPrompt,
  saveComicPrompt,
  updateComicAsset,
  type ComicAsset,
  type ComicAssetClass,
} from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";

import {
  comicAssetMetadataInput,
  type ComicAssetDraft,
} from "../model/workflow";

export function createComicProjectAsset(
  projectId: string,
  name: string,
  assetClass: ComicAssetClass,
  scope: WorkspaceScope
) {
  return createComicAsset(
    projectId,
    { name, class: assetClass, state: "", archive_status: "待审" },
    scope
  );
}

export function removeComicProjectAsset(
  projectId: string,
  assetId: string,
  scope: WorkspaceScope
) {
  return deleteComicAsset(projectId, assetId, scope);
}

export async function saveComicAssetDraft(
  projectId: string,
  asset: ComicAsset,
  draft: ComicAssetDraft,
  approve: boolean,
  scope: WorkspaceScope
) {
  const metadata = comicAssetMetadataInput(asset, draft);
  let current = metadata
    ? await updateComicAsset(projectId, asset.id, metadata, scope)
    : asset;
  if (draft.prompt.trim()) {
    current = await saveComicPrompt(
      projectId,
      asset.id,
      {
        content: draft.prompt.trim(),
        source: "manual",
        action: approve ? "approve" : "draft",
      },
      scope
    );
  }
  return current;
}

export function loadComicPromptTemplate(
  projectId: string,
  assetId: string,
  scope: WorkspaceScope
) {
  return previewComicPrompt(projectId, assetId, scope);
}

export function optimizeComicAssetPrompt(
  projectId: string,
  asset: ComicAsset,
  direction: string,
  model: string,
  operation: "optimize" | "merge",
  scope: WorkspaceScope
) {
  return optimizeComicPrompt(
    projectId,
    asset.id,
    {
      direction: direction.trim(),
      model,
      operation,
      base_content:
        operation === "merge"
          ? [asset.source_prompt, asset.draft_prompt, asset.approved_prompt]
              .filter(Boolean)
              .join("\n\n")
          : undefined,
      expected_prompt_version: asset.prompt_version,
    },
    scope
  );
}

export function approveComicAssetPrompt(
  projectId: string,
  asset: ComicAsset,
  scope: WorkspaceScope
) {
  const content =
    asset.draft_prompt || asset.approved_prompt || asset.source_prompt;
  return saveComicPrompt(
    projectId,
    asset.id,
    { content, source: "manual", action: "approve" },
    scope
  );
}

export function approveComicAssetPrompts(
  projectId: string,
  assets: ComicAsset[],
  scope: WorkspaceScope
) {
  return bulkApproveComicPrompts(
    projectId,
    assets
      .filter(asset => asset.prompt_status !== "approved")
      .map(asset => ({
        asset_id: asset.id,
        expected_prompt_version: asset.prompt_version,
      })),
    scope
  );
}
