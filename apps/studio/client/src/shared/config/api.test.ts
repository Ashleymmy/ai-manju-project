import { afterEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from "./api";

describe("API runtime config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps VITE_API_URL fallback and trailing slash behavior", () => {
    expect(API_BASE_URL).toBe(
      normalizeApiBaseUrl(import.meta.env.VITE_API_URL)
    );
    expect(normalizeApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeApiBaseUrl("")).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeApiBaseUrl("https://studio.example.com/")).toBe(
      "https://studio.example.com"
    );
    expect(normalizeApiBaseUrl("https://studio.example.com//")).toBe(
      "https://studio.example.com/"
    );
  });

  it("reads and normalizes VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com/");
    vi.resetModules();

    const configured = await import("./api");

    expect(configured.API_BASE_URL).toBe("https://api.example.com");
  });

  it("resolves the same-origin build option without a localhost fallback", async () => {
    vi.stubGlobal("window", { location: { origin: "https://studio.example.com" } });
    vi.stubEnv("VITE_API_URL", "/");
    const configured = await import("./api");
    expect(configured.API_BASE_URL).toBe(window.location.origin);
    const url = new URL(`${configured.API_BASE_URL}/api/sd-video/conversations`);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/sd-video/conversations");
  });
});
