// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { emptyProvider } from "../model/provider";
import {
  buildModelProviderPayload,
  type ModelProviderConfig,
} from "../services/adminApi";
import { SDVideoProviderEditor } from "./SDVideoProviderEditor";

describe("sdvideo management", () => {
  it("saves a single bulk change while keeping models with identical upstream IDs distinct", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const save = vi.fn();
    const initial: ModelProviderConfig = {
      ...emptyProvider,
      id: "sdvideo::all",
      name: "sdvideo",
      base_url: "sd-video://managed",
      capabilities: ["video"],
      sdvideo_models: [
        {
          key: "seedance-2.0",
          model_id: "shared-id",
          name: "Seedance 2.0",
          version: 2,
          enabled: false,
          available: false,
          credentials_configured: true,
          creation_disabled_reason: "当前视频模型未获准提交，请联系管理员检查 SD_VIDEO_ALLOWED_MODELS",
          concurrency_limit: 3,
        },
        {
          key: "seedance-2.0-ark",
          model_id: "shared-id",
          name: "官方",
          version: 5,
          enabled: true,
          available: false,
          credentials_configured: false,
          concurrency_limit: 1,
        },
      ],
    };
    function Harness() {
      const [draft, setDraft] = useState(initial);
      return (
        <SDVideoProviderEditor
          draft={draft}
          setDraft={setDraft}
          busy={false}
          save={save}
        />
      );
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(container.querySelectorAll("fieldset")).toHaveLength(2);
      expect(container.textContent).toContain("缺少凭据，启用后仍不可生成");
      const restricted = container.querySelectorAll("fieldset")[0];
      expect(restricted.textContent).toContain("凭据已配置");
      expect(restricted.textContent).toContain("SD_VIDEO_ALLOWED_MODELS");
      const button = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
          item => item.textContent === text
        )!;
      await act(async () => button("全部启用").click());
      expect(restricted.textContent).toContain("SD_VIDEO_ALLOWED_MODELS");
      expect(save).toHaveBeenCalledTimes(1);
      const payload = buildModelProviderPayload(save.mock.calls[0][0]);
      expect(
        payload.sdvideo_models?.map(item => [
          item.key,
          item.enabled,
          item.version,
        ])
      ).toEqual([
        ["seedance-2.0", true, 2],
        ["seedance-2.0-ark", true, 5],
      ]);
      await act(async () => button("全部停用").click());
      expect(
        save.mock.calls[1][0].sdvideo_models.every(
          (item: { enabled: boolean }) => !item.enabled
        )
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
