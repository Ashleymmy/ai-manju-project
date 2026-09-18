import { describe, expect, it } from "vitest";
import {
  parseConfigDocument,
  toConfigDocument,
  mergeConfigDocument,
  type ProviderRecord,
} from "./config";

const provider: ProviderRecord = {
  id: "demo",
  name: "demo",
  base_url: "https://example.invalid",
  enabled: true,
  capabilities: ["text"],
};
describe("provider document contract", () => {
  it("round trips public fields without copying credentials or identity", () => {
    const record = {
      ...provider,
      api_key: "test-private",
      extra_headers: { Authorization: "test-private", "X-Tenant": "demo" },
    };
    const doc = toConfigDocument(record);
    expect(parseConfigDocument(JSON.stringify(doc)).ok).toBe(true);
    expect(doc.config.id).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain("test-private");
    expect(mergeConfigDocument(provider, doc).id).toBe("demo");
  });
  it("rejects unknown workflows, wrong types, cross-adapter imports and unsafe keys", () => {
    const doc = toConfigDocument(provider);
    for (const config of [
      { ...doc.config, request: {} },
      { ...doc.config, enabled: "yes" },
      { ...doc.config, api_key: "secret" },
    ])
      expect(parseConfigDocument(JSON.stringify({ ...doc, config })).ok).toBe(
        false,
      );
    expect(parseConfigDocument(JSON.stringify(doc), "sdvideo").ok).toBe(false);
    expect(parseConfigDocument('{"__proto__":{}}').ok).toBe(false);
  });
});
