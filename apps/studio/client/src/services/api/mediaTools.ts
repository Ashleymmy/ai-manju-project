import { request } from "./request";

export type ImageUpscalePayload = {
  model?: string;
  url?: string;
  image_url?: string;
  asset_id?: string;
  data_url?: string;
  scope?: string;
  mode?: "base" | "enhancement";
  upscale_factor?: 1 | 2 | 3 | 4;
  output_format?: "png" | "jpg" | "bmp";
  output_quality?: number;
};

export type ImageUpscaleResult = {
  request_id?: string;
  url: string;
  data_url?: string;
  model?: string;
  mode: "base" | "enhancement";
  upscale_factor: number;
  output_format: string;
  output_quality?: number;
};

export type VideoUpscalePayload = {
  model?: string;
  video_url?: string;
  url?: string;
  asset_id?: string;
  scope?: string;
  bit_rate?: number;
};

export type VideoUpscaleTaskResult = {
  id: string;
  job_id: string;
  request_id?: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  upstream_status?: string;
  video_url?: string;
  asset_id?: string;
  asset_url?: string;
  mime_type?: string;
  bytes?: number;
  model?: string;
  bit_rate?: number;
  message?: string;
  error_code?: string;
  error_message?: string;
};

export type VoiceClonePayload = {
  target_model?: string;
  prefix?: string;
  voice_id?: string;
  audio_url?: string;
  asset_id?: string;
  data_url?: string;
  scope?: string;
  text?: string;
  language_hints?: string[];
  /** 展示名（支持中文），只存在我们服务端，不发给服务商 */
  alias?: string;
};

export type VoiceCloneRecord = {
  voice_id: string;
  target_model?: string;
  status?: string;
  demo_audio?: string;
  created_at?: string;
  request_id?: string;
  model?: string;
  alias?: string;
  owner_name?: string;
};

export async function upscaleImage(payload: ImageUpscalePayload) {
  // Upload to Alibaba Cloud, upscale and download the result in one request.
  return request<ImageUpscaleResult>("/api/ai/images/upscale", {
    method: "POST",
    body: payload,
    timeoutMs: 300_000,
  });
}

export async function createVideoUpscaleTask(payload: VideoUpscalePayload) {
  // Local videos are uploaded to Alibaba Cloud before the task is submitted.
  return request<VideoUpscaleTaskResult>("/api/ai/videos/upscale", {
    method: "POST",
    body: payload,
    timeoutMs: 600_000,
  });
}

export async function getVideoUpscaleTask(
  id: string,
  options?: {
    model?: string;
    save_asset?: boolean;
    scope?: string;
    project_id?: string;
    node_id?: string;
    title?: string;
  }
) {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (options?.model) query.model = options.model;
  if (options?.save_asset) query.save_asset = "1";
  if (options?.scope) query.scope = options.scope;
  if (options?.project_id) query.project_id = options.project_id;
  if (options?.node_id) query.node_id = options.node_id;
  if (options?.title) query.title = options.title;
  return request<VideoUpscaleTaskResult>(
    `/api/ai/videos/upscale/${encodeURIComponent(id)}`,
    // A finished job is downloaded and saved to the asset library in this call.
    { query, timeoutMs: 180_000 }
  );
}

export async function createClonedVoice(payload: VoiceClonePayload) {
  return request<VoiceCloneRecord>("/api/ai/audio/voices", {
    method: "POST",
    body: payload,
  });
}

export async function listClonedVoices(model?: string, prefix?: string) {
  const query: Record<string, string | undefined> = {};
  if (model) query.model = model;
  if (prefix) query.prefix = prefix;
  const result = await request<{
    voices?: VoiceCloneRecord[];
    notice?: string;
  }>("/api/ai/audio/voices", Object.keys(query).length ? { query } : undefined);
  return result.voices || [];
}

// 删除会同时移除服务商账户里的音色（不可恢复）；已生成的音频资产不受影响。
export async function deleteClonedVoice(voiceId: string) {
  return request<{ voice_id: string; deleted: boolean }>(
    `/api/ai/audio/voices/${encodeURIComponent(voiceId)}`,
    { method: "DELETE" }
  );
}
