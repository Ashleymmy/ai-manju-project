import { describe, expect, it, vi } from "vitest";

import {
  applyProviderPreset,
  clearProviderSensitiveInputState,
  emptyProvider,
  normalizeAliasMap,
  splitModels,
} from "./provider";
import { adminQueryKeys } from "./queryKeys";
import { adminTabFromLocation } from "./routes";
import {
  buildSeedanceAssetListParams,
  isSeedanceTagColor,
  paginateSeedanceAssets,
  validateSeedanceUrlDraft,
} from "./seedance";
import type { ModelProviderPreset } from "../services/adminApi";

describe("Admin route and query contracts", () => {
  it("maps every deep link and the monitoring hash without changing fallback", () => {
    expect(adminTabFromLocation("/admin", "")).toBe("monitoring");
    expect(adminTabFromLocation("/admin", "#monitoring")).toBe("monitoring");
    expect(adminTabFromLocation("/admin/users", "")).toBe("users");
    expect(adminTabFromLocation("/admin/model-provider", "")).toBe("providers");
    expect(adminTabFromLocation("/admin/announcements", "")).toBe(
      "announcements"
    );
    expect(adminTabFromLocation("/admin/seedance-assets", "")).toBe("seedance");
    expect(adminTabFromLocation("/admin/unknown", "")).toBe("monitoring");
  });

  it("keeps provider, user and monitoring query identities separate", () => {
    expect(adminQueryKeys.users()).toEqual(["admin", "users"]);
    expect(adminQueryKeys.providers()).toEqual(["admin", "model-providers"]);
    expect(adminQueryKeys.providerPresets()).toEqual([
      "admin",
      "model-provider-presets",
    ]);
    expect(adminQueryKeys.monitoring(24)).toEqual(["admin", "monitoring", 24]);
    expect(adminQueryKeys.monitoring(24)).not.toEqual(
      adminQueryKeys.monitoring(168)
    );
  });
});

describe("Admin provider drafts", () => {
  it("applies presets without replacing a saved provider name or manual defaults", () => {
    const preset: ModelProviderPreset = {
      id: "preset-1",
      name: "Preset Provider",
      description: "",
      provider_type: "volcengine_ark",
      mode: "openai_compatible",
      base_url: "https://example.com",
      auth_type: "bearer",
      capabilities: ["text", "video"],
      models_by_capability: { text: ["text-v1"], video: ["video-v1"] },
      defaults: { text: "", video: "video-v1" },
    };
    const draft = {
      ...emptyProvider,
      id: "provider-1",
      name: "Existing Provider",
      text_model: "manual-text",
    };

    expect(applyProviderPreset(preset.id, [preset], draft)).toMatchObject({
      id: "provider-1",
      name: "Existing Provider",
      preset_id: "preset-1",
      text_model: "manual-text",
      video_model: "video-v1",
    });
  });

  it("clears all ephemeral secrets and test output on context changes", () => {
    const setApiKey = vi.fn();
    const setSecrets = vi.fn();
    const setResult = vi.fn();
    clearProviderSensitiveInputState(setApiKey, setSecrets, setResult);
    expect(setApiKey).toHaveBeenCalledWith("");
    expect(setSecrets).toHaveBeenCalledWith({});
    expect(setResult).toHaveBeenCalledWith(null);
  });

  it("keeps model and key-value parsing deterministic", () => {
    expect(splitModels("one， two\nthree;one")).toEqual([
      "one",
      "two",
      "three",
      "one",
    ]);
    expect(normalizeAliasMap({ " model ": " Alias ", empty: " " })).toEqual({
      model: "Alias",
    });
  });
});

describe("Admin Seedance list contracts", () => {
  it("normalizes filters, keeps the 100 item fetch window and paginates by ten", () => {
    expect(
      buildSeedanceAssetListParams({
        search: "  demo asset  ",
        status: "Active",
        type: "Video",
        tagId: "tag-1",
      })
    ).toEqual({
      search: "demo asset",
      status: "Active",
      type: "Video",
      tag_id: "tag-1",
      limit: 100,
    });
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(paginateSeedanceAssets(items, 2)).toEqual({
      items: items.slice(10, 20),
      page: 2,
      pageCount: 3,
    });
  });

  it("rejects unsafe URL schemes and invalid tag colors", () => {
    expect(
      validateSeedanceUrlDraft({
        source_url: "file:///tmp/image.png",
        name: "",
        description: "",
        asset_type: "Image",
        tag_ids: [],
      })
    ).toEqual({ source_url: "Source URL 仅支持 http 或 https" });
    expect(isSeedanceTagColor("#7dd3fc")).toBe(true);
    expect(isSeedanceTagColor("skyblue")).toBe(false);
  });
});
