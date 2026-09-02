export type ComicAssetClass = "character" | "environment" | "prop" | "ui";

export type ComicAnalysisCandidate = {
  code: string;
  class: ComicAssetClass;
  name: string;
  state: string;
  description: string;
  visual_description: string;
  change_request: string;
  source_prompt: string;
  prompt_template: string;
  archive_status: string;
};

export type ComicAnalysisSession = {
  id: string;
  title: string;
  style_preset: string;
  status: "active" | "confirmed";
  active_revision_id: string;
  confirmed_revision_id: string;
  project_id: string;
  source_file_name: string;
};

export type ComicAnalysisRevision = {
  id: string;
  version: number;
  source: "initial" | "ai" | "manual";
  instruction: string;
  requested_model: string;
  response_model: string;
  candidate: { assets: ComicAnalysisCandidate[] };
};

export type ComicAnalysisDetail = {
  session: ComicAnalysisSession;
  revisions: ComicAnalysisRevision[];
};

export type ComicAssetProject = {
  id: string;
  title: string;
  style_preset: string;
  source_file_name?: string;
  created_at: string;
  updated_at: string;
};

export type ComicAsset = ComicAnalysisCandidate & {
  id: string;
  project_id: string;
  draft_prompt: string;
  approved_prompt: string;
  prompt_status: "draft" | "needs_review" | "approved";
  prompt_warnings?: string[];
  prompt_version: number;
  output_version: number;
  outputs?: Array<{
    version: number;
    asset_id: string;
    batch_id: string;
    batch_item_id: string;
    created_at: string;
  }>;
};

export type ComicProjectDetail = {
  project: ComicAssetProject;
  assets: ComicAsset[];
};

export type ComicBatchStatus =
  | "queued"
  | "running"
  | "paused"
  | "stopping"
  | "succeeded"
  | "partial_failed"
  | "canceled";

export type ComicBatchItemStatus =
  "pending" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ComicPromptPreview = {
  asset_id: string;
  source_prompt: string;
  draft_prompt: string;
  approved_prompt: string;
  template: string;
  template_source: "asset" | "project" | "system";
  warnings: string[];
  blockers: string[];
};

export type ComicPromptOptimizeResult = {
  asset: ComicAsset;
  requested_model: string;
  response_model: string;
};

export type ComicBulkPromptApprovalResult = {
  asset_id: string;
  ok: boolean;
  asset?: ComicAsset;
  error?: string;
};

export type ComicGenerationBatch = {
  id: string;
  project_id: string;
  status: ComicBatchStatus;
  model_selector: string;
  model: string;
  size: string;
  quality: string;
  concurrency: number;
  total: number;
  pending: number;
  active: number;
  succeeded: number;
  failed: number;
  canceled: number;
  created_at: string;
  updated_at: string;
  finished_at?: string;
};

export type ComicGenerationItem = {
  id: string;
  batch_id: string;
  comic_asset_id: string;
  asset_code: string;
  asset_name: string;
  position: number;
  status: ComicBatchItemStatus;
  prompt_snapshot: string;
  attempt: number;
  job_id: string;
  output_asset_id: string;
  output_version: number;
  error?: { code?: string; message?: string; suggestion?: string };
  updated_at: string;
};

export type ComicBatchDetail = {
  batch: ComicGenerationBatch;
  items: ComicGenerationItem[];
};

export type ComicProjectInput = {
  title: string;
  style_preset?: string;
  default_templates?: Partial<Record<ComicAssetClass, string>>;
};

export type ComicAssetInput = Partial<
  Pick<
    ComicAsset,
    | "code"
    | "class"
    | "name"
    | "state"
    | "description"
    | "visual_description"
    | "change_request"
    | "source_prompt"
    | "prompt_template"
    | "archive_status"
  >
>;

export type ImportComicProjectInput = ComicProjectInput & {
  source_type: "script" | "workbook";
  assets: ComicAssetInput[];
};

export type ComicAssetGenerationConfigInput = {
  asset_id: string;
  model_selector: string;
  size: string;
  quality: string;
  output_format: string;
  system_prompt: string;
  variants: number;
  reference_asset_ids: string[];
};
