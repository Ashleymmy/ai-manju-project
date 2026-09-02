export const announcementQueryKeys = {
  all: ["announcements"] as const,
  current: () => [...announcementQueryKeys.all, "current"] as const,
  adminList: () => [...announcementQueryKeys.all, "admin-list"] as const,
};
