export const E2E_TEXT_MODEL = "e2e-text-model";
export const E2E_IMAGE_MODEL = "e2e-seedream-image-codex";
export const E2E_ADMIN_ACCOUNT = process.env.E2E_ADMIN_ACCOUNT || process.env.ADMIN_USERNAME || "admin";
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin123456";
export const E2E_PROVIDER_PORT = Number(process.env.E2E_PROVIDER_PORT || 45991);
export const E2E_BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3100";
export const E2E_API_URL = process.env.E2E_API_URL || "http://127.0.0.1:3101";
export const E2E_WORKER_URL = process.env.E2E_WORKER_URL || "http://127.0.0.1:8101";

export function apiUrl(path: string) {
  return `${E2E_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function providerBaseUrlForAPI() {
  return process.env.E2E_PROVIDER_BASE_URL || `http://host.docker.internal:${E2E_PROVIDER_PORT}/v1`;
}
