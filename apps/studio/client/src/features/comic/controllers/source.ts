import {
  createComicAnalysisSession,
  importComicProject,
  type ComicAnalysisDetail,
  type ComicAssetInput,
  type ComicProjectDetail,
} from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";
import {
  extractComicScript,
  parseComicWorkbook,
  type ComicImportCandidate,
} from "@/lib/comic-import";

import {
  comicAnalysisInput,
  comicImportInput,
  type ComicProjectDraft,
} from "../model/workflow";

export type ComicSourceResult =
  | {
      kind: "project";
      detail: ComicProjectDetail;
      importedCount: number;
    }
  | {
      kind: "analysis";
      detail: ComicAnalysisDetail;
      candidateCount: number;
      truncated: boolean;
    };

export type ComicSourceDependencies = {
  extractScript: typeof extractComicScript;
  parseWorkbook: typeof parseComicWorkbook;
  importProject: typeof importComicProject;
  createAnalysis: typeof createComicAnalysisSession;
};

const defaultDependencies: ComicSourceDependencies = {
  extractScript: extractComicScript,
  parseWorkbook: parseComicWorkbook,
  importProject: importComicProject,
  createAnalysis: createComicAnalysisSession,
};

function importedAssets(candidates: ComicImportCandidate[]): ComicAssetInput[] {
  return candidates.map(({ key: _key, ...asset }) => asset);
}

export async function analyzeComicSource(
  input: ComicProjectDraft & {
    file: File;
    instruction: string;
    model: string;
    scope: WorkspaceScope;
  },
  dependencies: ComicSourceDependencies = defaultDependencies
): Promise<ComicSourceResult> {
  const extension = input.file.name.toLowerCase().split(".").pop();
  if (extension === "xlsx") {
    const parsed = await dependencies.parseWorkbook(input.file);
    if (!parsed.length) throw new Error("资产表中没有可导入的资产行");
    const detail = await dependencies.importProject(
      comicImportInput(input, importedAssets(parsed)),
      input.file,
      input.scope
    );
    return { kind: "project", detail, importedCount: detail.assets.length };
  }

  const { text, truncated } = await dependencies.extractScript(input.file);
  const detail = await dependencies.createAnalysis(
    comicAnalysisInput({
      title: input.title,
      stylePreset: input.stylePreset,
      sourceText: text,
      instruction: input.instruction,
      model: input.model,
    }),
    input.file,
    input.scope
  );
  const active =
    detail.revisions.find(
      revision => revision.id === detail.session.active_revision_id
    ) || detail.revisions.at(-1);
  return {
    kind: "analysis",
    detail,
    candidateCount: active?.candidate.assets.length || 0,
    truncated,
  };
}
