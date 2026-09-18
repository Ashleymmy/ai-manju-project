import { describe, expect, it } from "vitest";
import { mergeConfigDocument, parseConfigDocument, toConfigDocument } from "@ai-manju/provider-hub";
import { emptyProvider } from "./provider";

const draft = { ...emptyProvider, name: "demo", base_url: "https://example.test/v1" };
describe("portable live provider configuration", () => {
  it("round trips form fields and rejects inert or unsafe settings", () => {
    const document = toConfigDocument(draft);
    expect(parseConfigDocument(JSON.stringify(document)).ok).toBe(true);
    for (const config of [{ ...document.config, polling: {} }, { ...document.config, api_key: "secret" }, { ...document.config, extra_headers: { Authorization: "secret" } }, { ...document.config, models_by_capability: { image: null } }, { ...document.config, base_url: "https://x.test?api_key=secret" }]) {
      const result = parseConfigDocument(JSON.stringify({ ...document, config }));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('"secret"');
    }
    expect(parseConfigDocument("[]").ok).toBe(false);
    expect(parseConfigDocument('{"__proto__":{}}').ok).toBe(false);
  });
  it("exports no API key, secret status or credential headers", () => {
    const document = toConfigDocument({ ...draft, api_key: "private", api_key_set: true, extra_headers: { Authorization: "private", "X-Tenant": "team" } });
    expect(JSON.stringify(document)).not.toContain("private");
    expect(document.config.extra_headers).toEqual({ "X-Tenant": "team" });
  });
  it("keeps route identity and refuses stale SD-video versions", () => {
    const current = { ...draft, sdvideo_models: [{ key: "seedance-2.5", name: "2.5", model_id: "upstream", enabled: true, concurrency_limit: 3, version: 2, upstream_provider: "legacy_proxy" }] };
    const document = toConfigDocument(current);
    expect(parseConfigDocument(JSON.stringify(document), "sdvideo").ok).toBe(true);
    expect(parseConfigDocument(JSON.stringify(document), "studio").ok).toBe(false);
    expect(mergeConfigDocument(current, document).sdvideo_models[0].upstream_provider).toBe("legacy_proxy");
    expect(() => mergeConfigDocument({ ...current, sdvideo_models: [{ ...current.sdvideo_models[0], version: 3 }] }, document)).toThrow("版本");
  });
});
