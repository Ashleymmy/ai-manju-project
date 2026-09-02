import { Activity, Bell, Database, ServerCog, Users } from "lucide-react";

export type AdminTab =
  | "users"
  | "providers"
  | "announcements"
  | "monitoring"
  | "seedance";

export const adminTabPaths: Record<AdminTab, string> = {
  users: "/admin/users",
  providers: "/admin/model-provider",
  announcements: "/admin/announcements",
  monitoring: "/admin",
  seedance: "/admin/seedance-assets",
};

export const adminTabs = [
  ["users", "用户", Users],
  ["providers", "模型提供商", ServerCog],
  ["announcements", "系统公告", Bell],
  ["monitoring", "运行监控", Activity],
  ["seedance", "Seedance 素材", Database],
] as const;

export function adminTabFromLocation(pathname: string, hash: string): AdminTab {
  if (pathname === "/admin/users") return "users";
  if (pathname === "/admin/model-provider") return "providers";
  if (pathname === "/admin/announcements") return "announcements";
  if (pathname === "/admin/seedance-assets") return "seedance";
  if (hash === "#monitoring" || pathname === "/admin") return "monitoring";
  return "monitoring";
}
