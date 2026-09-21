/** Go API 在 Studio 本地开发环境中的默认地址。 */
export const DEFAULT_API_BASE_URL = "http://localhost:3101";

export function normalizeApiBaseUrl(value: string | undefined) {
  // 发布镜像用 / 表示浏览器当前 origin；所有调用方仍获得可供 new URL 使用的绝对地址。
  // 本地开发沿用 Vite 的 /api 代理（目标为 127.0.0.1），避免 Windows
  // localhost 的 IPv6 转发挂起；同源访问也保留媒体请求的登录 Cookie。
  if (value === "/" || (!value && import.meta.env.DEV && typeof window !== "undefined")) {
    return window.location.origin;
  }
  return (value || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);
