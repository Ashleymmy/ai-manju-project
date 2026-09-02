import type {
  SystemAnnouncementKind,
  SystemAnnouncementStatus,
  SystemAnnouncement,
  AnnouncementPayload,
} from "./model";
import { API_BASE_URL, getAuthToken, request } from "@/shared/api/http";

export function fetchCurrentAnnouncement() {
  return request<SystemAnnouncement | null>("/api/announcements/current");
}

export function markAnnouncementRead(id: string) {
  return request<{ read_at: string }>(
    `/api/announcements/${encodeURIComponent(id)}/read`,
    { method: "POST" }
  );
}

export function listAdminAnnouncements() {
  return request<SystemAnnouncement[]>("/api/admin/announcements");
}

export function createAdminAnnouncement(payload: AnnouncementPayload) {
  return request<SystemAnnouncement>("/api/admin/announcements", {
    method: "POST",
    body: payload,
  });
}

export function revokeAdminAnnouncement(id: string) {
  return request<SystemAnnouncement>(
    `/api/admin/announcements/${encodeURIComponent(id)}/revoke`,
    { method: "POST" }
  );
}

export function republishAdminAnnouncement(
  id: string,
  payload: Partial<AnnouncementPayload>
) {
  return request<SystemAnnouncement>(
    `/api/admin/announcements/${encodeURIComponent(id)}/republish`,
    { method: "POST", body: payload }
  );
}

export function announcementStreamUrl(token = getAuthToken() || "") {
  const url = new URL(`${API_BASE_URL}/api/announcements/stream`);
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}
