import { request } from "@/shared/api/http";
import type { PromptPreset } from "@/entities/prompt";

export type { PromptPreset, PromptPresetPriority } from "@/entities/prompt";

/**
 * 字段名必须与后端 sanitizeGeneration 白名单一致（apps/api/internal/handler/user_preference.go），
 * 白名单外的键会被服务端静默丢弃。
 */
export type UserGenerationPreferences = {
  imageModel?: string;
  videoModel?: string;
  textModel?: string;
  audioModel?: string;
  quality?: string;
  size?: string;
  count?: string;
  canvasImageCount?: string;
  videoSeconds?: string;
  vquality?: string;
  videoGenerateAudio?: string;
  videoWatermark?: string;
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: string;
  audioInstructions?: string;
  systemPrompt?: string;
};

export type UserShortcutPreferences = Record<string, string[]>;

export type UserPreferences = {
  generation?: UserGenerationPreferences;
  shortcuts?: UserShortcutPreferences;
  canvas?: {
    middleButtonLockHint?: boolean;
    backgroundMode?: "lines" | "dots" | "blank";
    wheelZoomRequiresCtrl?: boolean;
    promptPresets?: PromptPreset[];
  };
  updated_at?: string;
};

export type UserPreferencesPayload = {
  generation?: Partial<UserGenerationPreferences>;
  shortcuts?: UserShortcutPreferences;
  canvas?: Partial<NonNullable<UserPreferences["canvas"]>>;
};

export function getPreferences() {
  return request<UserPreferences>("/api/user/preferences");
}

export function updatePreferences(preferences: UserPreferencesPayload) {
  return request<UserPreferences>("/api/user/preferences", { method: "PUT", body: preferences });
}

export function getModels() {
  return request<unknown>("/api/ai/models");
}
