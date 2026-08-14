import { request } from "./request";

export type UserPreferences = { generation?: Record<string, unknown>; canvas?: { middleButtonLockHint?: boolean; backgroundMode?: "lines" | "dots" | "blank"; wheelZoomRequiresCtrl?: boolean; promptPresets?: unknown[] } };

export function getPreferences() { return request<UserPreferences>("/api/user/preferences"); }
export function updatePreferences(preferences: UserPreferences) { return request<UserPreferences>("/api/user/preferences", { method: "PUT", body: preferences }); }
export function getModels() { return request<unknown>("/api/ai/models"); }
