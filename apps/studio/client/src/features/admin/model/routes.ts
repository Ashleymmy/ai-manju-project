import {
  Activity,
  Bell,
  Database,
  Gauge,
  Gift,
  History,
  LayoutDashboard,
  ScrollText,
  ServerCog,
  Settings2,
  ShoppingCart,
  Users,
} from "lucide-react";

export type AdminTab =
  | "users"
  | "providers"
  | "announcements"
  | "monitoring"
  | "seedance"
  /* ---- WP-M7 会员系统后台 8 模块 ---- */
  | "member-users"
  | "credit-ledger"
  | "orders"
  | "consumptions"
  | "plans-config"
  | "dashboard"
  | "invites"
  | "audit-logs";

export const adminTabPaths: Record<AdminTab, string> = {
  users: "/admin/users",
  providers: "/admin/model-hub",
  announcements: "/admin/announcements",
  monitoring: "/admin",
  seedance: "/admin/seedance-assets",
  /* ---- WP-M7 会员系统后台 8 模块 ---- */
  "member-users": "/admin/member-users",
  "credit-ledger": "/admin/credit-ledger",
  orders: "/admin/orders",
  consumptions: "/admin/consumptions",
  "plans-config": "/admin/plans-config",
  dashboard: "/admin/dashboard",
  invites: "/admin/invites",
  "audit-logs": "/admin/audit-logs",
};

export const adminTabs = [
  ["users", "成员管理", Users],
  ["providers", "模型接入", ServerCog],
  ["announcements", "系统公告", Bell],
  ["monitoring", "运行监控", Activity],
  ["seedance", "Seedance 素材", Database],
  /* ---- WP-M7 会员系统后台 8 模块 ---- */
  ["dashboard", "运营看板", LayoutDashboard],
  ["credit-ledger", "积分流水", ScrollText],
  ["orders", "订单管理", ShoppingCart],
  ["consumptions", "消耗与成本", Gauge],
  ["plans-config", "套餐配置", Settings2],
  ["invites", "邀请记录", Gift],
  ["audit-logs", "审计日志", History],
] as const;

export function adminTabFromLocation(pathname: string, hash: string): AdminTab {
  if (pathname === "/admin/users") return "users";
  if (pathname === "/admin/model-provider" || pathname === "/admin/model-hub") return "providers";
  if (pathname === "/admin/announcements") return "announcements";
  if (pathname === "/admin/seedance-assets") return "seedance";
  /* ---- WP-M7 会员系统后台 8 模块 ---- */
  if (pathname === "/admin/member-users") return "member-users";
  if (pathname === "/admin/credit-ledger") return "credit-ledger";
  if (pathname === "/admin/orders") return "orders";
  if (pathname === "/admin/consumptions") return "consumptions";
  if (pathname === "/admin/plans-config") return "plans-config";
  if (pathname === "/admin/dashboard") return "dashboard";
  if (pathname === "/admin/invites") return "invites";
  if (pathname === "/admin/audit-logs") return "audit-logs";
  if (hash === "#monitoring" || pathname === "/admin") return "monitoring";
  return "monitoring";
}
