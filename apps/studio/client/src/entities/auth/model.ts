export type AuthUser = {
  id: string;
  username: string;
  display_name?: string;
  /**
   * 后端三级权限（apps/api model.UserRole*）：
   * super_admin 超管 / ops_admin 运营 / auditor 只读审计 / member 普通用户。
   */
  role: "super_admin" | "ops_admin" | "auditor" | "member";
  status: string;
};

export type LoginResult = { token: string; user: AuthUser };

/** 可进入管理后台的角色（镜像后端 IsAdminRole）。 */
export const ADMIN_TIER_ROLES: readonly AuthUser["role"][] = ["super_admin", "ops_admin", "auditor"];

/** 是否可进入管理后台（前端路由/导航展示用；权限兜底仍在后端 RequireAdmin）。 */
export function isAdminTierRole(role: string | undefined | null): boolean {
  return ADMIN_TIER_ROLES.includes(role as AuthUser["role"]);
}

/** 只读审计角色：后台写操作入口隐藏（后端对 auditor 的写请求一律 403）。 */
export function isReadOnlyAdminRole(role: string | undefined | null): boolean {
  return role === "auditor";
}
