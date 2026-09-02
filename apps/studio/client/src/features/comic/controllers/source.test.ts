import { describe, expect, it, vi } from "vitest";

import type {
  ComicAnalysisDetail,
  ComicAsset,
  ComicProjectDetail,
} from "@/entities/comic";

import {
  analyzeComicSource,
  type ComicSourceDependencies,
} from "./source";

function createAsset(): ComicAsset {
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
    draft_prompt: "",
    approved_prompt: "",
    prompt_status: "needs_review",
    prompt_version: 1,
    output_version: 0,
  };
}

function createDependencies(): ComicSourceDependencies {
  return {
    extractScript: vi.fn(),
    parseWorkbook: vi.fn(),
    importProject: vi.fn(),
    createAnalysis: vi.fn(),
  };
}

describe("Comic source controller", () => {
  it("imports XLSX candidates and forwards the original file and scope", async () => {
    const file = { name: "assets.XLSX" } as File;
    const asset = createAsset();
    const detail: ComicProjectDetail = {
      project: {
        id: "project-1",
        title: "第一季",
        style_preset: "国风",
        source_file_name: file.name,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      assets: [asset],
    };
    const dependencies = createDependencies();
    vi.mocked(dependencies.parseWorkbook).mockResolvedValue([
      {
        key: "row-1",
        code: asset.code,
        class: asset.class,
        name: asset.name,
        state: asset.state,
        description: asset.description,
        visual_description: asset.visual_description,
        change_request: asset.change_request,
        source_prompt: asset.source_prompt,
        prompt_template: asset.prompt_template,
        archive_status: asset.archive_status,
      },
    ]);
    vi.mocked(dependencies.importProject).mockResolvedValue(detail);

    await expect(
      analyzeComicSource(
        {
          title: "  第一季  ",
          stylePreset: "  国风  ",
          file,
          instruction: "unused for workbook",
          model: "",
          scope: "team",
        },
        dependencies
      )
    ).resolves.toEqual({
      kind: "project",
      detail,
      importedCount: 1,
    });
    expect(dependencies.parseWorkbook).toHaveBeenCalledWith(file);
    expect(dependencies.importProject).toHaveBeenCalledWith(
      {
        title: "第一季",
        style_preset: "国风",
        source_type: "workbook",
        assets: [
          {
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
          },
        ],
      },
      file,
      "team"
    );
    expect(dependencies.extractScript).not.toHaveBeenCalled();
    expect(dependencies.createAnalysis).not.toHaveBeenCalled();
  });

  it("extracts script text and reports the active revision candidates", async () => {
    const file = { name: "story.docx" } as File;
    const asset = createAsset();
    const analysis: ComicAnalysisDetail = {
      session: {
        id: "session-1",
        title: "第一季",
        style_preset: "国风",
        status: "active",
        active_revision_id: "revision-1",
        confirmed_revision_id: "",
        project_id: "",
        source_file_name: file.name,
      },
      revisions: [
        {
          id: "revision-1",
          version: 1,
          source: "initial",
          instruction: "完整拆解",
          requested_model: "text-model",
          response_model: "text-model",
          candidate: { assets: [asset] },
        },
      ],
    };
    const dependencies = createDependencies();
    vi.mocked(dependencies.extractScript).mockResolvedValue({
      text: "剧本文本",
      truncated: true,
    });
    vi.mocked(dependencies.createAnalysis).mockResolvedValue(analysis);

    await expect(
      analyzeComicSource(
        {
          title: "  第一季  ",
          stylePreset: "  国风  ",
          file,
          instruction: "  完整拆解  ",
          model: "text-model",
          scope: "personal",
        },
        dependencies
      )
    ).resolves.toEqual({
      kind: "analysis",
      detail: analysis,
      candidateCount: 1,
      truncated: true,
    });
    expect(dependencies.extractScript).toHaveBeenCalledWith(file);
    expect(dependencies.createAnalysis).toHaveBeenCalledWith(
      {
        title: "第一季",
        style_preset: "国风",
        source_text: "剧本文本",
        instruction: "完整拆解",
        model: "text-model",
      },
      file,
      "personal"
    );
    expect(dependencies.parseWorkbook).not.toHaveBeenCalled();
    expect(dependencies.importProject).not.toHaveBeenCalled();
  });

  it("rejects an empty workbook before creating a project", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.parseWorkbook).mockResolvedValue([]);

    await expect(
      analyzeComicSource(
        {
          title: "第一季",
          stylePreset: "",
          file: { name: "assets.xlsx" } as File,
          instruction: "",
          model: "",
          scope: "personal",
        },
        dependencies
      )
    ).rejects.toThrow("资产表中没有可导入的资产行");
    expect(dependencies.importProject).not.toHaveBeenCalled();
  });
});
