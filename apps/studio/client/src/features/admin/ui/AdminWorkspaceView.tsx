import { Activity, Check, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

import { useAuth } from "@/contexts/AuthContext";
import { isReadOnlyAdminRole } from "@/entities/auth";

import { useAdminUsersController } from "../controllers/useAdminUsersController";
import { useAnnouncementsController } from "../controllers/useAnnouncementsController";
import { useAuditLogsController } from "../controllers/useAuditLogsController";
import { useConsumptionsController } from "../controllers/useConsumptionsController";
import { useCreditLedgerController } from "../controllers/useCreditLedgerController";
import { useDashboardController } from "../controllers/useDashboardController";
import { useInvitesController } from "../controllers/useInvitesController";
import { useMemberUsersController } from "../controllers/useMemberUsersController";
import { useModelProvidersController } from "../controllers/useModelProvidersController";
import { useMonitoringController } from "../controllers/useMonitoringController";
import { useOrdersController } from "../controllers/useOrdersController";
import { usePlansConfigController } from "../controllers/usePlansConfigController";
import { useSeedanceAssetsController } from "../controllers/useSeedanceAssetsController";
import { formatTime } from "../model/format";
import {
  adminTabFromLocation,
  adminTabPaths,
  adminTabs,
} from "../model/routes";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { AuditLogsPanel } from "./AuditLogsPanel";
import { ConsumptionsPanel } from "./ConsumptionsPanel";
import { CreditLedgerPanel } from "./CreditLedgerPanel";
import { DashboardPanel } from "./DashboardPanel";
import { InvitesPanel } from "./InvitesPanel";
import { MemberUsersPanel } from "./MemberUsersPanel";
import { MonitoringPanel } from "./MonitoringPanel";
import { OrdersPanel } from "./OrdersPanel";
import { PlansConfigPanel } from "./PlansConfigPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SeedanceAssetsPanel } from "./SeedanceAssetsPanel";
import { UsersPanel } from "./UsersPanel";

export { adminTabFromLocation } from "../model/routes";
export { clearProviderSensitiveInputState } from "../model/provider";
export {
  buildSeedanceAssetListParams,
  paginateSeedanceAssets,
} from "../model/seedance";

/** 后台角色中文名（与后端三级权限对齐）。 */
function adminRoleLabel(role?: string) {
  switch (role) {
    case "super_admin":
      return "super_admin";
    case "ops_admin":
      return "ops_admin";
    case "auditor":
      return "auditor（只读）";
    default:
      return role || "member";
  }
}

export default function AdminWorkspaceView() {
  const [location, navigate] = useLocation();
  const [hash, setHash] = useState(() => window.location.hash);
  const [manualReloading, setManualReloading] = useState(false);
  const tab = adminTabFromLocation(location.split("?")[0], hash);
  const { user } = useAuth();
  /** auditor 只读：写按钮隐藏，写操作由后端 RequireAdmin 兜底 403。 */
  const readOnly = isReadOnlyAdminRole(user?.role);

  const usersController = useAdminUsersController();
  const providersController = useModelProvidersController(tab === "providers");
  const announcementsController = useAnnouncementsController();
  const monitoringController = useMonitoringController(tab === "monitoring");
  const seedanceController = useSeedanceAssetsController();
  /* ---- WP-M7 会员系统后台 8 模块（激活对应 tab 时才拉取） ---- */
  const memberUsersController = useMemberUsersController(tab === "member-users");
  const creditLedgerController = useCreditLedgerController(tab === "credit-ledger");
  const ordersController = useOrdersController(tab === "orders");
  const consumptionsController = useConsumptionsController(tab === "consumptions");
  const plansConfigController = usePlansConfigController(tab === "plans-config");
  const dashboardController = useDashboardController(tab === "dashboard");
  const invitesController = useInvitesController(tab === "invites");
  const auditLogsController = useAuditLogsController(tab === "audit-logs");
  const loading =
    manualReloading ||
    usersController.isPending ||
    providersController.isPending ||
    announcementsController.isPending ||
    monitoringController.isPending ||
    seedanceController.isPending ||
    memberUsersController.isPending ||
    creditLedgerController.isPending ||
    ordersController.isPending ||
    consumptionsController.isPending ||
    plansConfigController.isPending ||
    dashboardController.isPending ||
    invitesController.isPending ||
    auditLogsController.isPending;

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const reload = useCallback(async () => {
    setManualReloading(true);
    try {
      await Promise.allSettled([
        usersController.reload(),
        providersController.reload(),
        announcementsController.reload(),
        monitoringController.reload(),
        seedanceController.reload(),
        memberUsersController.reload(),
        creditLedgerController.reload(),
        ordersController.reload(),
        consumptionsController.reload(),
        plansConfigController.reload(),
        dashboardController.reload(),
        invitesController.reload(),
        auditLogsController.reload(),
      ]);
    } finally {
      setManualReloading(false);
    }
  }, [
    announcementsController,
    auditLogsController,
    consumptionsController,
    creditLedgerController,
    dashboardController,
    invitesController,
    memberUsersController,
    monitoringController,
    ordersController,
    plansConfigController,
    providersController,
    seedanceController,
    usersController,
  ]);

  return (
    <div className="feature-page admin-page real-admin-page">
      <div className="feature-title">
        <div>
          <p className="eyebrow">SYSTEM / SUPER ADMIN</p>
          <h1>管理后台</h1>
          <p>用户、Provider、公告、监控、素材与会员计费均连接真实后端。</p>
        </div>
        <button
          className="outline-button small"
          onClick={() => void reload()}
          disabled={loading}
        >
          <RefreshCcw size={15} /> 刷新
        </button>
      </div>
      <div className="admin-workspace">
        <aside className="admin-nav">
          {adminTabs.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => navigate(adminTabPaths[key])}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </aside>
        <section className="admin-panel">
          {loading ? (
            <div className="empty-output">
              <Loader2 className="spin" size={26} />
              <p>正在读取管理数据…</p>
            </div>
          ) : null}
          {tab === "users" ? (
            <UsersPanel controller={usersController} />
          ) : null}
          {tab === "providers" ? (
            <ProvidersPanel controller={providersController} />
          ) : null}
          {tab === "announcements" ? (
            <AnnouncementsPanel controller={announcementsController} />
          ) : null}
          {tab === "monitoring" ? (
            <MonitoringPanel controller={monitoringController} />
          ) : null}
          {tab === "seedance" ? (
            <SeedanceAssetsPanel controller={seedanceController} />
          ) : null}
          {tab === "dashboard" ? (
            <DashboardPanel controller={dashboardController} />
          ) : null}
          {tab === "member-users" ? (
            <MemberUsersPanel controller={memberUsersController} readOnly={readOnly} />
          ) : null}
          {tab === "credit-ledger" ? (
            <CreditLedgerPanel controller={creditLedgerController} />
          ) : null}
          {tab === "orders" ? (
            <OrdersPanel controller={ordersController} readOnly={readOnly} />
          ) : null}
          {tab === "consumptions" ? (
            <ConsumptionsPanel controller={consumptionsController} />
          ) : null}
          {tab === "plans-config" ? (
            <PlansConfigPanel controller={plansConfigController} readOnly={readOnly} />
          ) : null}
          {tab === "invites" ? (
            <InvitesPanel controller={invitesController} />
          ) : null}
          {tab === "audit-logs" ? (
            <AuditLogsPanel controller={auditLogsController} />
          ) : null}
        </section>
        <aside className="admin-side-status">
          <p className="eyebrow">ACCESS LEVEL</p>
          <ShieldCheck size={24} />
          <h3>{adminRoleLabel(user?.role)}</h3>
          <p>此页所有数据都来自后端管理接口，修改会写入正式配置。</p>
          {readOnly ? <p>只读审计账号：写操作入口已隐藏。</p> : null}
          <hr />
          <p className="eyebrow">QUICK STATUS</p>
          <button>
            <Activity size={15} /> {" "}
            {monitoringController.monitoring?.generated_at
              ? `监控更新 ${formatTime(monitoringController.monitoring.generated_at)}`
              : "监控待加载"}
          </button>
          <button>
            <Check size={15} /> {providersController.providers.length} 个 Provider
          </button>
        </aside>
      </div>
    </div>
  );
}
