import { Activity, Check, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

import { useAdminUsersController } from "../controllers/useAdminUsersController";
import { useAnnouncementsController } from "../controllers/useAnnouncementsController";
import { useModelProvidersController } from "../controllers/useModelProvidersController";
import { useMonitoringController } from "../controllers/useMonitoringController";
import { useSeedanceAssetsController } from "../controllers/useSeedanceAssetsController";
import { formatTime } from "../model/format";
import {
  adminTabFromLocation,
  adminTabPaths,
  adminTabs,
} from "../model/routes";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { MonitoringPanel } from "./MonitoringPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SeedanceAssetsPanel } from "./SeedanceAssetsPanel";
import { UsersPanel } from "./UsersPanel";

export { adminTabFromLocation } from "../model/routes";
export { clearProviderSensitiveInputState } from "../model/provider";
export {
  buildSeedanceAssetListParams,
  paginateSeedanceAssets,
} from "../model/seedance";

export default function AdminWorkspaceView() {
  const [location, navigate] = useLocation();
  const [hash, setHash] = useState(() => window.location.hash);
  const [manualReloading, setManualReloading] = useState(false);
  const tab = adminTabFromLocation(location.split("?")[0], hash);
  const usersController = useAdminUsersController();
  const providersController = useModelProvidersController(tab === "providers");
  const announcementsController = useAnnouncementsController();
  const monitoringController = useMonitoringController(tab === "monitoring");
  const seedanceController = useSeedanceAssetsController();
  const loading =
    manualReloading ||
    usersController.isPending ||
    providersController.isPending ||
    announcementsController.isPending ||
    monitoringController.isPending ||
    seedanceController.isPending;

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
      ]);
    } finally {
      setManualReloading(false);
    }
  }, [
    announcementsController,
    monitoringController,
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
          <p>用户、Provider、公告、监控和素材库均连接真实后端。</p>
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
        </section>
        <aside className="admin-side-status">
          <p className="eyebrow">ACCESS LEVEL</p>
          <ShieldCheck size={24} />
          <h3>super_admin</h3>
          <p>此页所有数据都来自后端管理接口，修改会写入正式配置。</p>
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
