import type { WebdavSyncConfig } from "../model/webdavConfig";

/**
 * WebDAV 客户端。默认走同源代理 /webdav-proxy（浏览器无法直发 PROPFIND/MKCOL 到跨域服务），
 * 协议与旧版 services/webdav-sync.ts 保持一致。
 */

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120_000;
const ensuredDirectories = new Set<string>();

export async function testWebdavConnection(config: WebdavSyncConfig) {
  await ensureWebdavDirectory(config);
  const response = await webdavFetch(config, "", { method: "PROPFIND", headers: { Depth: "0" } });
  if (response.ok || response.status === 207) return;
  await throwWebdavError(response, "WebDAV 连接测试失败");
}

export async function downloadWebdavFile(config: WebdavSyncConfig, path: string) {
  await ensureWebdavDirectory(config);
  const response = await webdavFetch(config, path, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) await throwWebdavError(response, "读取 WebDAV 文件失败");
  const file = await withTimeout(response.blob(), "读取 WebDAV 文件超时");
  return file.size ? file : null;
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream") {
  if (!file.size) throw new Error("上传文件为空，已取消上传");
  await ensureWebdavDirectory(config);
  await ensureWebdavSubdirectory(config, path);
  let response = await webdavFetch(config, path, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (response.status === 404 || response.status === 409) {
    clearEnsuredDirectoryCache(config, path);
    await ensureWebdavDirectory(config);
    await ensureWebdavSubdirectory(config, path);
    response = await webdavFetch(config, path, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  }
  if (!response.ok) await throwWebdavError(response, "上传 WebDAV 文件失败");
}

async function ensureWebdavDirectory(config: WebdavSyncConfig) {
  if (!config.url.trim()) throw new Error("请先填写 WebDAV 地址");
  await ensureWebdavDirectoryPath(config, config.directory);
}

async function ensureWebdavSubdirectory(config: WebdavSyncConfig, path: string) {
  const directory = normalizePath(path).split("/").slice(0, -1).join("/");
  if (!directory) return;
  await ensureWebdavDirectoryPath(config, [config.directory, directory].filter(Boolean).join("/"));
}

async function ensureWebdavDirectoryPath(config: WebdavSyncConfig, directory: string) {
  const parts = normalizePath(directory).split("/").filter(Boolean);
  const cacheKey = ensuredDirectoryCacheKey(config, parts.join("/"));
  if (ensuredDirectories.has(cacheKey)) return;
  let path = "";
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    const response = await webdavFetch({ ...config, directory: "" }, path, { method: "MKCOL" });
    if (response.ok || ((response.status === 405 || response.status === 423) && (await webdavDirectoryExists(config, path)))) continue;
    await throwWebdavError(response, "创建 WebDAV 远程目录失败");
  }
  ensuredDirectories.add(cacheKey);
}

function clearEnsuredDirectoryCache(config: WebdavSyncConfig, path: string) {
  const directories = [config.directory];
  const subdirectory = normalizePath(path).split("/").slice(0, -1).join("/");
  if (subdirectory) directories.push([config.directory, subdirectory].filter(Boolean).join("/"));
  directories.forEach((directory) => ensuredDirectories.delete(ensuredDirectoryCacheKey(config, directory)));
}

function ensuredDirectoryCacheKey(config: WebdavSyncConfig, directory: string) {
  return `${config.proxyMode}:${config.url}:${normalizePath(directory)}`;
}

async function webdavDirectoryExists(config: WebdavSyncConfig, path: string) {
  const response = await webdavFetch({ ...config, directory: "" }, path, { method: "PROPFIND", headers: { Depth: "0" } });
  return response.ok || response.status === 207;
}

async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (config.username || config.password) {
    headers.set("Authorization", `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`);
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
  try {
    const url = buildWebdavUrl(config, path);
    if (config.proxyMode === "direct") {
      return await fetch(url, { ...init, headers, signal: controller.signal });
    }
    return await fetch("/webdav-proxy", {
      method: "POST",
      headers: proxyHeaders(url, init.method || "GET", headers),
      body: proxyBody(init),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("WebDAV 请求超时，请检查网络、代理或远端服务状态");
    if (error instanceof TypeError) throw new Error("无法连接 WebDAV，请检查地址、HTTPS 证书或网络状态");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function proxyHeaders(target: string, method: string, headers: Headers) {
  const result = new Headers({ "x-webdav-target": target, "x-webdav-method": method });
  copyProxyHeader(headers, result, "Authorization", "x-webdav-authorization");
  copyProxyHeader(headers, result, "Depth", "x-webdav-depth");
  copyProxyHeader(headers, result, "Destination", "x-webdav-destination");
  copyProxyHeader(headers, result, "Overwrite", "x-webdav-overwrite");
  copyProxyHeader(headers, result, "Content-Type", "x-webdav-content-type");
  const contentType = headers.get("Content-Type");
  if (contentType) result.set("Content-Type", contentType);
  return result;
}

function copyProxyHeader(from: Headers, to: Headers, source: string, target: string) {
  const value = from.get(source);
  if (value) to.set(target, value);
}

function proxyBody(init: RequestInit) {
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  return (init.body as BodyInit | undefined) || undefined;
}

export function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
  const baseUrl = config.url.trim().replace(/\/+$/, "");
  const remotePath = [normalizePath(config.directory), normalizePath(path)].filter(Boolean).join("/");
  if (!remotePath) return baseUrl;
  return `${baseUrl}/${remotePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(path: string) {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

async function throwWebdavError(response: Response, fallback: string): Promise<never> {
  const detail = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) throw new Error("WebDAV 认证失败，请检查用户名、密码或应用密码");
  if (response.status === 404) throw new Error("WebDAV 路径不存在，请检查地址和远程目录");
  throw new Error(`${fallback}：${response.status}${detail ? ` ${detail.slice(0, 120)}` : ""}`);
}

function encodeBasicAuth(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), WEBDAV_REQUEST_TIMEOUT_MS);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}
