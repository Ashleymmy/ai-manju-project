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

  it("uses the Vite proxy for browser development without overriding an explicit API", () => {
    vi.stubEnv("DEV", true);
    vi.stubGlobal("window", { location: { origin: "http://localhost:3100" } });
    expect(normalizeApiBaseUrl(undefined)).toBe("http://localhost:3100");
    expect(normalizeApiBaseUrl("")).toBe("http://localhost:3100");
    expect(normalizeApiBaseUrl("http://custom-api:3101/")).toBe("http://custom-api:3101");
  });

  it("uses same-origin in production when the API build setting is omitted", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { origin: "https://studio.example.com" } });
    expect(normalizeApiBaseUrl(undefined)).toBe("https://studio.example.com");
    expect(normalizeApiBaseUrl("")).toBe("https://studio.example.com");
    expect(new URL(`${normalizeApiBaseUrl(undefined)}/api/auth/login`).pathname).toBe("/api/auth/login");
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

  it.each([
    "http://127.0.0.1:3101", "http://localhost:3101/", "http://[::1]:3101",
    "http://127.1:3101", "http://0.0.0.0:3101", "http://api.localhost:3101",
  ])("ignores a developer loopback API %s on a cloud page", api => {
    vi.stubGlobal("window", { location: { origin: "http://studio.clouddo.cc" } });
    expect(normalizeApiBaseUrl(api)).toBe("http://studio.clouddo.cc");
  });

  it("preserves explicit loopback API settings for local development", () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3100" } });
    expect(normalizeApiBaseUrl("http://127.0.0.1:3101/")).toBe("http://127.0.0.1:3101");
  });

  it("keeps explicitly configured remote APIs on cloud pages", () => {
    vi.stubGlobal("window", { location: { origin: "https://studio.example.com" } });
    expect(normalizeApiBaseUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("routes login to the page origin even when a build contains the old loopback setting", async () => {
    vi.stubGlobal("window", { location: { origin: "http://studio.clouddo.cc" } });
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:3101");
    vi.resetModules();
    const { apiUrl } = await import("../api/http/request");
    expect(apiUrl("/api/auth/login")).toBe("http://studio.clouddo.cc/api/auth/login");
  });
});
