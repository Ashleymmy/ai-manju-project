/** Go API 在 Studio 本地开发环境中的默认地址。 */
export const DEFAULT_API_BASE_URL = "http://localhost:3101";

export function normalizeApiBaseUrl(value: string | undefined) {
  return (value || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);
