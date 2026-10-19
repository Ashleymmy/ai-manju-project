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
  it("supports image_upscale and video_upscale super-resolution capabilities", () => {
    const doc = toConfigDocument({
      ...provider,
      preset_id: "aliyun_viapi_super_resolution",
      provider_type: "aliyun_viapi",
      auth_type: "none",
      base_url: "https://imageenhan.cn-shanghai.aliyuncs.com",
      capabilities: ["image_upscale", "video_upscale"],
      image_upscale_model: "MakeSuperResolutionImage",
      video_upscale_model: "SuperResolveVideo",
      models_by_capability: {
        image_upscale: ["MakeSuperResolutionImage"],
        video_upscale: ["SuperResolveVideo"],
      },
      endpoint_overrides: {
        image_upscale_endpoint: "https://imageenhan.cn-shanghai.aliyuncs.com",
        video_upscale_endpoint: "https://videoenhan.cn-shanghai.aliyuncs.com",
      },
    } as ProviderRecord);
    const parsed = parseConfigDocument(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    expect(doc.config.provider_type).toBe("aliyun_viapi");
    expect(doc.config.image_upscale_model).toBe("MakeSuperResolutionImage");
    expect(doc.config.video_upscale_model).toBe("SuperResolveVideo");
  });
});
