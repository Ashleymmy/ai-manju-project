import {
  confirmComicAnalysisSession,
  createComicAnalysisRevision,
  setActiveComicAnalysisRevision,
  type ComicAnalysisDetail,
  type ComicAnalysisRevision,
} from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";

import { comicRevisionInput } from "../model/workflow";

export function reviseComicAnalysis(
  analysis: ComicAnalysisDetail,
  activeRevision: ComicAnalysisRevision,
  instruction: string,
  model: string,
  scope: WorkspaceScope
) {
  return createComicAnalysisRevision(
    analysis.session.id,
    comicRevisionInput({
      instruction,
      model,
      parentRevisionId: activeRevision.id,
      expectedActiveRevisionId: analysis.session.active_revision_id,
    }),
    scope
  );
}

export function activateComicAnalysisRevision(
  analysis: ComicAnalysisDetail,
  revisionId: string,
  scope: WorkspaceScope
) {
  return setActiveComicAnalysisRevision(analysis.session.id, revisionId, scope);
}

export function confirmComicAnalysis(
  analysis: ComicAnalysisDetail,
  activeRevision: ComicAnalysisRevision,
  scope: WorkspaceScope
) {
  return confirmComicAnalysisSession(
    analysis.session.id,
    activeRevision.id,
    scope
  );
}
