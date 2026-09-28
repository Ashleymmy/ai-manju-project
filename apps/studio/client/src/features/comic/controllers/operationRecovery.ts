import { ApiError } from "@/shared/api/http";

export type ComicRetainedCandidate = { title: string; content: string };

// Expose only the retained candidate, never the rest of the receipt/error
// envelope. Displaying it must not adopt stale content or issue another call.
export function comicRetainedCandidate(error: unknown): ComicRetainedCandidate | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return;
  const data = (error.details as { data?: { recovery?: {
    status?: string; kind?: string;
    candidate?: { prompt?: { asset?: { draft_prompt?: unknown } }; revision?: { candidate?: { assets?: unknown[] } } };
  } } } | undefined)?.data?.recovery;
  if (data?.status !== "conflict") return;
  if (data.kind === "comic_prompt" && typeof data.candidate?.prompt?.asset?.draft_prompt === "string") {
    return { title: "已保留的提示词", content: data.candidate.prompt.asset.draft_prompt };
  }
  if (data.kind === "comic_revision" && Array.isArray(data.candidate?.revision?.candidate?.assets)) {
    return { title: "已保留的分析候选", content: JSON.stringify(data.candidate.revision.candidate, null, 2) };
  }
}
