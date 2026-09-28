import { ApiError, request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";
import { awaitComicAnalysis } from "./analysisTask";
import { getComicAnalysisSession } from "./api";
import type { ComicAnalysisSession } from "./model";

export type ComicAnalysisSummary = Pick<ComicAnalysisSession, "id" | "title" | "source_file_name" | "status"> & {
  created_at: string;
  expires_at: string;
};
export type ComicAnalysisHistoryPage = { items: ComicAnalysisSummary[]; next_cursor?: string };

export function listComicAnalysisHistory(scope: WorkspaceScope, cursor?: string, signal?: AbortSignal) {
  return request<ComicAnalysisHistoryPage>("/api/comic-asset-analysis-sessions", { query: { scope, cursor }, signal });
}

/** Resume from server discovery without uploading a file or making a paid POST. */
export function resumeComicAnalysis(sessionID: string, scope: WorkspaceScope, signal?: AbortSignal) {
  return awaitComicAnalysis(
    async () => { throw new Error("恢复分析不能创建新任务"); },
    async id => {
      const detail = await getComicAnalysisSession(id, scope, signal);
      if (detail?.session?.id !== sessionID) throw new ApiError("原分析返回的任务不匹配，请稍后再查看", 502);
      return detail;
    },
    { resume_session_id: sessionID, scope }, undefined, { resumeSessionID: sessionID, signal },
  );
}
