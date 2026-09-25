import { request } from "@/shared/api/http";

/** Keep recovery lists bounded; each page describes existing tasks only. */
export const GENERATION_RECOVERY_PAGE_SIZE = 30;
export const GENERATION_RECOVERY_QUERY_KEY = ["admin", "generation-recovery"] as const;

export type GenerationRecoveryRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  type: string;
  status: string;
  queue_phase: string;
  provider_id: string;
  model: string;
  checkpoint_phase: string;
  checkpoint_revision: number;
  provider_task_id: string;
  can_resume: boolean;
  reason: string;
  updated_at: string;
  recovery_requested: boolean;
};

export type GenerationRecoveryPage = {
  items: GenerationRecoveryRow[];
  total: number;
  limit: number;
  offset: number;
};

export function fetchGenerationRecovery(offset = 0, signal?: AbortSignal) {
  return request<GenerationRecoveryPage>("/api/admin/generation-recovery", {
    query: { limit: GENERATION_RECOVERY_PAGE_SIZE, offset },
    signal,
  });
}

/** Compare the checkpoint revision so a stale page cannot resume changed work. */
export function resumeGenerationRecovery(id: string, expectedRevision: number) {
  return request<GenerationRecoveryRow>(`/api/admin/generation-recovery/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    body: { expected_revision: expectedRevision },
  });
}
