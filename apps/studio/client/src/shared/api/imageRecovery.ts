import { API_BASE_URL, getAuthToken } from "./http";

/** Only API-owned media endpoints may receive the session Authorization header. */
export function authenticatedImageSource(source: string) {
  try {
    const url = new URL(source, window.location.href);
    const api = new URL(API_BASE_URL);
    if (url.origin !== api.origin || url.username || url.password) return null;
    const apiPath = api.pathname.replace(/\/$/, "");
    if (!url.pathname.startsWith(`${apiPath}/`)) return null;
    const pathname = url.pathname.slice(apiPath.length);
    if (!/^\/api\/assets\/[^/]+\/content$/.test(pathname)
      && !/^\/api\/sd-video\/volcano\/assets\/[^/]+\/(content|thumbnail)$/.test(pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Recover token-only sessions without exposing their token in a URL. */
export async function recoverAuthenticatedImage(source: string, signal: AbortSignal) {
  const url = authenticatedImageSource(source);
  if (!url) throw new Error("Unsupported image source");
  const token = getAuthToken();
  const response = await fetch(url, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "reload",
    signal,
  });
  if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
  const blob = await response.blob();
  if (!blob.size || !blob.type.toLowerCase().startsWith("image/")) throw new Error("图片响应无效");
  return blob;
}
