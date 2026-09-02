import { describe, expect, it } from "vitest";

import { assetFeatureQueryKeys } from "./assets/model/queries";
import { authFeatureQueryKeys } from "./auth/model/queries";
import {
  IMAGE_WORKBENCH_SIZE_OPTIONS,
  resolveImageWorkbenchRequestOptions,
} from "./image/model/options";
import {
  settingsQueryKeys,
} from "./settings/model/queries";
import {
  WEBDAV_CONFIG_STORAGE_KEY,
} from "./settings/model/webdavConfig";
import { buildWebdavUrl } from "./settings/services/webdavSync";
import { SKILL_STORAGE_KEY } from "./skills/model/skillLibrary";

describe("resource feature compatibility contracts", () => {
  it("keeps resource query identities scoped and revision-aware", () => {
    expect(assetFeatureQueryKeys.overview("personal", 3)).toEqual([
      "assets",
      "feature-overview",
      "personal",
      3,
    ]);
    expect(assetFeatureQueryKeys.overview("team", 3)).not.toEqual(
      assetFeatureQueryKeys.overview("personal", 3)
    );
    expect(settingsQueryKeys.preferences()).toEqual([
      "settings",
      "preferences",
    ]);
    expect(authFeatureQueryKeys.health()).toEqual([
      "auth",
      "public-health",
    ]);
  });

  it("keeps the image workbench 13-option request mapping", () => {
    expect(IMAGE_WORKBENCH_SIZE_OPTIONS).toHaveLength(13);
    expect(resolveImageWorkbenchRequestOptions("16:9(4k)", "auto"))
      .toEqual({ size: "16:9", quality: "high" });
    expect(resolveImageWorkbenchRequestOptions("auto", "auto")).toEqual({
      size: "auto",
      quality: "auto",
    });
  });

  it("keeps local resource storage keys byte-for-byte compatible", () => {
    expect(SKILL_STORAGE_KEY).toBe("ai-manju:canvas_skills");
    expect(WEBDAV_CONFIG_STORAGE_KEY).toBe("ai-manju:webdav_sync");
  });

  it("keeps WebDAV path composition and escaping stable", () => {
    expect(
      buildWebdavUrl(
        {
          proxyMode: "server",
          url: "https://nas.example.test/dav/",
          username: "",
          password: "",
          directory: "ai-manju",
          lastSyncedAt: "",
        },
        "assets/夜景.png"
      )
    ).toBe(
      "https://nas.example.test/dav/ai-manju/assets/%E5%A4%9C%E6%99%AF.png"
    );
  });
});
