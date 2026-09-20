// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComicBatchDetail, ComicGenerationItem } from "@/entities/comic";
const mocks = vi.hoisted(() => ({
  job: { data: undefined as any, error: null },
  image: vi.fn(),
}));
vi.mock("../model/queries", () => ({
  useComicBatchItemJobQuery: () => mocks.job,
}));
vi.mock("@/entities/asset", () => ({ getAssetContentObjectUrl: mocks.image }));
import { ComicBatchPanel } from "./ComicBatchPanel";

describe("comic batch feedback", () => {
  let root: Root;
  let container: HTMLDivElement;
  const retry = vi.fn();
  const revoke = vi.fn();
  function item(
    overrides: Partial<ComicGenerationItem> = {}
  ): ComicGenerationItem {
    return {
      id: "item-1",
      asset_name: "阿青",
      status: "failed",
      job_id: "job-12345678",
      ...overrides,
    } as ComicGenerationItem;
  }
  async function render(items: ComicGenerationItem[], error?: unknown) {
    const detail = {
      batch: {
        status: "partial_failed",
        total: items.length,
        active: 0,
        pending: 0,
        succeeded: 0,
        failed: 1,
        canceled: 0,
      },
      items,
    } as ComicBatchDetail;
    await act(async () =>
      root.render(
        <ComicBatchPanel
          detail={detail}
          scope="personal"
          busy={false}
          error={error}
          onRefresh={() => {}}
          onControl={() => {}}
          onRetryFailed={() => {}}
          onRetryItem={retry}
        />
      )
    );
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: revoke }));
    mocks.job.data = undefined;
    mocks.job.error = null;
    mocks.image.mockResolvedValue("blob:generated-image");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the failure reason and suggestion visible when a job ID exists", async () => {
    await render([
      item({
        error: {
          message: "该分组未开通图片生成",
          suggestion: "选择可生成图片的模型后重试",
        },
      }),
    ]);
    expect(container.textContent).toContain("该分组未开通图片生成");
    expect(container.textContent).toContain("选择可生成图片的模型后重试");
    expect(container.textContent).toContain("任务 12345678");
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".comic-item-retry")!.click()
    );
    expect(retry).toHaveBeenCalledWith("item-1");
  });

  it("shows actual running progress and explains refresh failures", async () => {
    mocks.job.data = { status: "running", progress: 65 };
    await render([item({ status: "queued" })], new Error("连接中断"));
    expect(container.textContent).toContain("生成中 65%");
    expect(
      container
        .querySelector('progress[aria-label="阿青 生成进度"]')
        ?.getAttribute("value")
    ).toBe("65");
    expect(container.textContent).toContain("当前显示上次结果");
    expect(container.textContent).toContain("连接中断");
  });

  it("loads completed output images and releases their object URLs", async () => {
    await render([item({ status: "succeeded", output_asset_id: "output-1" })]);
    expect(mocks.image).toHaveBeenCalledWith(
      "output-1",
      "personal",
      320,
      expect.any(AbortSignal)
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:generated-image"
    );
    await render([]);
    expect(revoke).toHaveBeenCalledWith("blob:generated-image");
  });

  it("offers an image reload instead of hiding an output fetch failure", async () => {
    mocks.image.mockRejectedValueOnce(new Error("图片读取失败"));
    await render([item({ status: "succeeded", output_asset_id: "output-1" })]);
    expect(container.textContent).toContain("图片读取失败");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find(button => button.textContent === "重新加载图片")!
        .click()
    );
    expect(container.querySelector("img")).not.toBeNull();
  });
});
