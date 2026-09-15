// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSeedanceAssetPreviewUrl, listUserSeedanceAssets, ensureSeedanceAssetsActive, uploadUserSeedanceAsset } from "./seedance-api";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

describe("用户拟真人素材接口", () => {
  it("上传、状态列表和激活检查使用用户路由并保留空间", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["image"], "hero.png", { type: "image/png" });
    await uploadUserSeedanceAsset(file, "team");
    const [target, options] = fetcher.mock.calls[0];
    expect(new URL(target).pathname).toBe("/api/ai/seedance-assets/upload");
    expect(new URL(target).searchParams.get("scope")).toBe("team");
    expect(options.body.get("file").name).toBe("hero.png");
    expect(options.body.get("asset_type")).toBe("Image");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [] } })));
    await listUserSeedanceAssets({ scope: "team" });
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe("/api/ai/seedance-assets");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { active: true } })));
    await ensureSeedanceAssetsActive(["asset://remote"], "team");
    expect(new URL(fetcher.mock.calls[2][0]).searchParams.get("scope")).toBe("team");
  });

  it("同源预览携带鉴权，外部 URL 不会收到 Studio 凭证", async () => {
    sessionStorage.setItem("ai-manju:auth_token", "test-only");
    const fetcher = vi.fn().mockResolvedValue(new Response("image"));
    vi.stubGlobal("fetch", fetcher);
    const create = vi.fn(() => "blob:preview");
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; });
    expect(await getSeedanceAssetPreviewUrl("/api/sd-video/volcano/assets/one/content?scope=personal")).toBe("blob:preview");
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer test-only" });
    expect(await getSeedanceAssetPreviewUrl("https://cdn.example/hero.png")).toBe("https://cdn.example/hero.png");
    expect(await getSeedanceAssetPreviewUrl("//external.test/path")).toBe("");
    expect(await getSeedanceAssetPreviewUrl("/api/admin/users")).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
