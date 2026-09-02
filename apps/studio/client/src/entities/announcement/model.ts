export type SystemAnnouncementKind = "update" | "maintenance" | "notice";

export type SystemAnnouncementStatus = "active" | "revoked";

export type SystemAnnouncement = {
  id: string;
  title: string;
  content: string;
  kind: SystemAnnouncementKind;
  status: SystemAnnouncementStatus;
  created_by: string;
  published_at: string;
  revoked_at?: string;
  created_at: string;
  updated_at: string;
};

export type AnnouncementPayload = {
  title: string;
  content: string;
  kind: SystemAnnouncementKind;
};
