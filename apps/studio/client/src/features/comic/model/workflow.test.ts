import { describe, expect, it } from "vitest";

import type {
  ComicAnalysisDetail,
  ComicAnalysisRevision,
  ComicAsset,
  ComicGenerationBatch,
} from "@/entities/comic";

import {
  activeComicRevision,
  comicAnalysisInput,
  comicAssetDraft,
  comicAssetMetadataInput,
  comicBatchInput,
  comicBatchProgress,
  comicImportInput,
  comicProjectInput,
  comicRevisionInput,
  filterComicAssets,
  isComicBatchActive,
  latestComicBatch,
} from "./workflow";

function createAsset(overrides: Partial<ComicAsset> = {}): ComicAsset {
  return {
    id: "asset-1",
    project_id: "project-1",
    code: "C001",
    class: "character",
    name: "林默",
    state: "常服",
    description: "主角",
    visual_description: "黑发，灰色外套",
    change_request: "",
    source_prompt: "source prompt",
    prompt_template: "",
    archive_status: "待审",
    draft_prompt: "draft prompt",
    approved_prompt: "",
    prompt_status: "draft",
    prompt_version: 3,
    output_version: 0,
    ...overrides,
  };
}

function createRevision(
  id: string,
  version: number
): ComicAnalysisRevision {
  return {
    id,
    version,
    source: version === 1 ? "initial" : "ai",
    instruction: `revision ${version}`,
    requested_model: "text-model",
    response_model: "text-model",
    candidate: { assets: [] },
  };
}

function createBatch(
  id: string,
  createdAt: string,
  overrides: Partial<ComicGenerationBatch> = {}
): ComicGenerationBatch {
  return {
    id,
    project_id: "project-1",
    status: "queued",
    model_selector: "image-model",
    model: "image-model",
    size: "1:1",
    quality: "high",
    concurrency: 2,
    total: 4,
    pending: 4,
    active: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

describe("Comic workflow compatibility contracts", () => {
  it("builds project, import, analysis and revision payloads exactly", () => {
    expect(
      comicProjectInput({ title: "  第一季  ", stylePreset: "  国风  " })
    ).toEqual({ title: "第一季", style_preset: "国风" });

    const assets = [{ name: "林默", class: "character" as const }];
    expect(
      comicImportInput(
        { title: "  第一季  ", stylePreset: "  国风  " },
        assets
      )
    ).toEqual({
      title: "第一季",
      style_preset: "国风",
      source_type: "workbook",
      assets,
    });

    expect(
      comicAnalysisInput({
        title: "  第一季  ",
        stylePreset: "  国风  ",
        sourceText: "  剧本文本保持原样  ",
        instruction: "  完整拆解  ",
        model: "text-model",
      })
    ).toEqual({
      title: "第一季",
      style_preset: "国风",
      source_text: "  剧本文本保持原样  ",
      instruction: "完整拆解",
      model: "text-model",
    });

    expect(
      comicRevisionInput({
        instruction: "  补充道具  ",
        model: "text-model",
        parentRevisionId: "revision-2",
        expectedActiveRevisionId: "revision-2",
      })
    ).toEqual({
      instruction: "补充道具",
      model: "text-model",
      parent_revision_id: "revision-2",
      expected_active_revision_id: "revision-2",
    });
  });

  it("keeps automatic and custom batch payload fields compatible", () => {
    const common = {
      assetIds: ["asset-1"],
      modelSelector: "image-model",
      size: "16:9",
      quality: "high",
      outputFormat: "png",
      variantsPerAsset: 2,
      referenceAssetIds: ["reference-1"],
      concurrency: 2 as const,
      createCategorySubfolders: true,
    };

    expect(
      comicBatchInput({
        ...common,
        destinationMode: "auto",
        destinationFolderId: "must-not-leak",
      })
    ).toEqual({
      asset_ids: ["asset-1"],
      model_selector: "image-model",
      size: "16:9",
      quality: "high",
      output_format: "png",
      variants_per_asset: 2,
      reference_asset_ids: ["reference-1"],
      concurrency: 2,
      destination_mode: "auto",
      create_category_subfolders: true,
    });

    const assetConfigs = [
      {
        asset_id: "asset-1",
        model_selector: "override-model",
        size: "1:1",
        quality: "medium",
        output_format: "webp",
        system_prompt: "keep identity",
        variants: 1,
        reference_asset_ids: [],
      },
    ];
    expect(
      comicBatchInput({
        ...common,
        destinationMode: "custom",
        destinationFolderId: "folder-1",
        assetConfigs,
      })
    ).toMatchObject({
      destination_mode: "custom",
      destination_folder_id: "folder-1",
      asset_configs: assetConfigs,
    });
  });

  it("resolves the active revision and falls back to the latest revision", () => {
    const first = createRevision("revision-1", 1);
    const second = createRevision("revision-2", 2);
    const analysis: ComicAnalysisDetail = {
      session: {
        id: "session-1",
        title: "第一季",
        style_preset: "国风",
        status: "active",
        active_revision_id: "revision-1",
        confirmed_revision_id: "",
        project_id: "",
        source_file_name: "story.docx",
      },
      revisions: [first, second],
    };

    expect(activeComicRevision(analysis)).toBe(first);
    expect(
      activeComicRevision({
        ...analysis,
        session: { ...analysis.session, active_revision_id: "missing" },
      })
    ).toBe(second);
    expect(activeComicRevision(null)).toBeUndefined();
  });

  it("keeps asset filtering and draft metadata behavior", () => {
    const character = createAsset();
    const prop = createAsset({
      id: "asset-2",
      code: "P001",
      class: "prop",
      name: "铜钥匙",
      state: "锈蚀",
      visual_description: "黄铜材质",
      draft_prompt: "",
    });

    expect(filterComicAssets([character, prop], "prop", "铜")).toEqual([
      prop,
    ]);
    expect(filterComicAssets([character, prop], "", "灰色外套")).toEqual([
      character,
    ]);
    expect(comicAssetDraft(character)).toEqual({
      name: "林默",
      state: "常服",
      class: "character",
      visual_description: "黑发，灰色外套",
      prompt: "draft prompt",
    });
    expect(
      comicAssetMetadataInput(character, comicAssetDraft(character))
    ).toBeNull();
    expect(
      comicAssetMetadataInput(character, {
        ...comicAssetDraft(character),
        name: "  林默·少年  ",
      })
    ).toEqual({
      name: "林默·少年",
      state: "常服",
      class: "character",
      visual_description: "黑发，灰色外套",
    });
  });

  it("selects the latest batch without mutating input and tracks progress", () => {
    const older = createBatch("batch-1", "2026-01-01T00:00:00Z");
    const newer = createBatch("batch-2", "2026-01-02T00:00:00Z", {
      status: "running",
      pending: 0,
      active: 1,
      succeeded: 1,
      failed: 1,
      canceled: 1,
    });
    const batches = [older, newer];

    expect(latestComicBatch(batches)).toBe(newer);
    expect(batches).toEqual([older, newer]);
    expect(comicBatchProgress(newer)).toBe(75);
    expect(isComicBatchActive("queued")).toBe(true);
    expect(isComicBatchActive("running")).toBe(true);
    expect(isComicBatchActive("paused")).toBe(true);
    expect(isComicBatchActive("stopping")).toBe(true);
    expect(isComicBatchActive("succeeded")).toBe(false);
    expect(isComicBatchActive()).toBe(false);
  });
});
