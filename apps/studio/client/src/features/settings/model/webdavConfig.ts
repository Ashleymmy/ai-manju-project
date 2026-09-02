/**
 * WebDAV 连接配置。与旧版一致存本地（后端偏好接口无对应 bucket，且本轮不改后端），
 * 因此配置随浏览器保存，不跟随账号同步。
 */

export type WebdavProxyMode = "server" | "direct";

export type WebdavSyncConfig = {
  proxyMode: WebdavProxyMode;
  url: string;
  username: string;
  password: string;
  directory: string;
  lastSyncedAt: string;
};

export const WEBDAV_CONFIG_STORAGE_KEY = "ai-manju:webdav_sync";

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
  proxyMode: "server",
  url: "",
  username: "",
  password: "",
  directory: "ai-manju",
  lastSyncedAt: "",
};

export function loadWebdavConfig(): WebdavSyncConfig {
  try {
    const raw = window.localStorage.getItem(WEBDAV_CONFIG_STORAGE_KEY);
    if (!raw) return { ...defaultWebdavSyncConfig };
    return normalizeWebdavConfig(JSON.parse(raw) as Partial<WebdavSyncConfig>);
  } catch {
    return { ...defaultWebdavSyncConfig };
  }
}

export function saveWebdavConfig(config: Partial<WebdavSyncConfig>) {
  const next = normalizeWebdavConfig({ ...loadWebdavConfig(), ...config });
  try {
    window.localStorage.setItem(WEBDAV_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    undefined;
  }
  return next;
}

export function webdavConfigReady(config: WebdavSyncConfig) {
  return Boolean(config.url.trim());
}

function normalizeWebdavConfig(value: Partial<WebdavSyncConfig>): WebdavSyncConfig {
  return {
    proxyMode: value.proxyMode === "direct" ? "direct" : "server",
    url: String(value.url ?? "").trim(),
    username: String(value.username ?? ""),
    password: String(value.password ?? ""),
    directory: String(value.directory ?? defaultWebdavSyncConfig.directory).trim(),
    lastSyncedAt: String(value.lastSyncedAt ?? ""),
  };
}
