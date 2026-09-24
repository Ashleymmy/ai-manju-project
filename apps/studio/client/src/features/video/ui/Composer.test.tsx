// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { PROMPT_REFERENCE_DISPLAY as chip } from "../model/promptEditor";
import { generationReferencesFrom, resolvePromptWithTokens, splitWorkbenchReferences, type WorkbenchReference } from "../model/referenceEngine";

const references = (["image", "video", "audio"] as const).map((kind, index) => ({
  id: `${kind}-ref`, kind, role: "reference", source: "asset", assetId: `${kind}-asset`,
  name: `${kind}-file`, token: ["@图片1", "@视频1", "@音频1"][index],
  file: new File([kind], `${kind}-file`, { type: `${kind}/${kind === "image" ? "png" : kind === "video" ? "mp4" : "mpeg"}` }),
  mime: `${kind}/*`, bytes: 5, width: 1280, height: 720, durationMs: 3000, previewUrl: `blob:${kind}`,
})) as WorkbenchReference[];

describe("video composer shelf references", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: FrameRequestCallback[];
  const changed = vi.fn(), removed = vi.fn(), submitted = vi.fn(), preview = vi.fn(), queried = vi.fn();

  function Harness({ initialPrompt = "前后", disabled = false }: { initialPrompt?: string; disabled?: boolean }) {
    const [prompt, setPrompt] = useState(initialPrompt);
    return <Composer prompt={prompt} onPromptChange={value => { changed(value); setPrompt(value); }}
      references={references} firstFrame={null} lastFrame={null} framesEnabled={false} generating={false} disabled={disabled}
      mentionCandidates={[]} mentionLoading={false} onMentionQuery={queried} onInsertAssetMention={async () => ""}
      onUploadFiles={vi.fn()} onPasteFiles={vi.fn()} onRemoveReference={removed} onRemoveFrame={vi.fn()} onFrameSelect={vi.fn()}
      onSubmit={() => {
        const snapshot = splitWorkbenchReferences(references);
        submitted(resolvePromptWithTokens(prompt, snapshot), generationReferencesFrom(snapshot));
      }} onOpenMedia={preview} thumbUrlFor={reference => reference.previewUrl} />;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  const textarea = () => container.querySelector("textarea")!;
  const insertButton = (index: number) => container.querySelectorAll<HTMLButtonElement>(".wb-shelf-insert")[index];
  const flushFocus = async () => { await act(async () => { const pending = frames.splice(0); pending.forEach(callback => callback(0)); }); };
  async function select(start: number, end = start) {
    await act(async () => {
      textarea().focus();
      textarea().setSelectionRange(start, end);
      document.dispatchEvent(new Event("selectionchange"));
    });
  }

  it.each([0, 1, 2])("inserts shelf media %i at the caret and restores editor focus without previewing or submitting", async index => {
    await act(async () => root.render(<Harness />));
    await select(1);
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => insertButton(index).dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);
    await act(async () => insertButton(index).dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    await act(async () => insertButton(index).click());
    await flushFocus();
    expect(changed).toHaveBeenLastCalledWith(`前\n@[ref:${references[index].id}]\n后`);
    expect(textarea().value).toBe(`前\n${chip}\n后`);
    expect(textarea().selectionStart).toBe(3 + chip.length);
    expect(textarea().selectionEnd).toBe(3 + chip.length);
    expect(document.activeElement).toBe(textarea());
    expect(container.querySelector(".wb-token i")?.textContent).toBe(references[index].token);
    expect(preview).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("appends when the editor has not been focused", async () => {
    await act(async () => root.render(<Harness initialPrompt="已有描述" />));
    await act(async () => insertButton(0).click());
    await flushFocus();
    expect(textarea().value).toBe(`已有描述\n${chip}\n`);
  });

  it("keeps the selected text range after focus moves to a shelf button", async () => {
    await act(async () => root.render(<Harness initialPrompt="替换这里保留" />));
    await select(0, 4);
    await act(async () => insertButton(1).focus());
    await act(async () => insertButton(1).click());
    await flushFocus();
    expect(textarea().value).toBe(`${chip}\n保留`);
  });

  it("keeps rapid multi-media clicks and repeat references, then submits real media with resolved labels", async () => {
    await act(async () => root.render(<Harness initialPrompt="" />));
    await act(async () => [0, 1, 2, 0].forEach(index => insertButton(index).click()));
    await flushFocus();
    expect(textarea().value).toBe([chip, chip, chip, chip].join(" ") + "\n");
    expect(changed).toHaveBeenLastCalledWith("@[ref:image-ref] @[ref:video-ref] @[ref:audio-ref] @[ref:image-ref]\n");
    expect(container.querySelectorAll(".wb-token")).toHaveLength(4);
    expect(container.querySelectorAll(".wb-shelf-item")).toHaveLength(3);
    expect(submitted).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-send")!.click());
    const [prompt, media] = submitted.mock.calls[0];
    expect(prompt).toBe("图片1 视频1 音频1 图片1\n");
    expect(media.images[0].file).toBe(references[0].file);
    expect(media.videos[0].file).toBe(references[1].file);
    expect(media.audios[0].file).toBe(references[2].file);
  });

  it("replaces a pending @ query through the existing mention insertion logic", async () => {
    await act(async () => root.render(<Harness initialPrompt="" />));
    await act(async () => {
      textarea().focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), "参考 @视频");
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(queried).toHaveBeenCalledWith("视频");
    await act(async () => insertButton(1).click());
    await flushFocus();
    expect(textarea().value).toBe(`参考\n${chip}\n`);
    expect(document.querySelector(".wb-mention-menu")).toBeNull();
  });

  it("removes independently and does not nest buttons or insert a reference", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-shelf-remove")!.click());
    expect(removed).toHaveBeenCalledWith("image-ref");
    expect(changed).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("does not insert while the editor is disabled", async () => {
    await act(async () => root.render(<Harness disabled />));
    expect(insertButton(0).disabled).toBe(true);
    await act(async () => insertButton(0).click());
    expect(changed).not.toHaveBeenCalled();
  });

  it("normalizes old drafts and snaps clicks inside a reference to its edge", async () => {
    await act(async () => root.render(<Harness initialPrompt="@[ref:image-ref] @[ref:video-ref] " />));
    expect(textarea().value).toBe(`${chip} ${chip}\n`);
    await select(chip.length - 1);
    expect(textarea().selectionStart).toBe(chip.length);
    await act(async () => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    expect(changed).toHaveBeenLastCalledWith("@[ref:video-ref]\n");
  });

  it("copies and pastes real ids, including a partially selected chip", async () => {
    await act(async () => root.render(<Harness initialPrompt={"@[ref:image-ref]\n@[ref:video-ref]\n"} />));
    await select(1, chip.length - 1);
    const clipboard = { setData: vi.fn(), getData: () => "@[ref:audio-ref]", items: [] };
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: clipboard });
    await act(async () => textarea().dispatchEvent(copy));
    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", "@[ref:image-ref]");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    await act(async () => textarea().dispatchEvent(paste));
    expect(changed).toHaveBeenLastCalledWith("@[ref:audio-ref] @[ref:video-ref]\n");
    expect([...container.querySelectorAll(".wb-token i")].map(item => item.textContent)).toEqual(["@音频1", "@视频1"]);
  });

  it("does not submit on Enter or during IME composition", async () => {
    await act(async () => root.render(<Harness />));
    await select(1);
    await act(async () => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
    expect(submitted).not.toHaveBeenCalled();
  });

  it("keeps a manually entered line break between short references after rerender", async () => {
    await act(async () => root.render(<Harness initialPrompt="@[ref:image-ref] @[ref:video-ref]" />));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), `${chip}\n ${chip}\n`);
      textarea().setSelectionRange(chip.length + 1, chip.length + 1);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea().value).toBe(`${chip}\n${chip}\n`);
    expect(changed).toHaveBeenLastCalledWith("@[ref:image-ref]\n@[ref:video-ref]\n");
    expect(submitted).not.toHaveBeenCalled();
  });
});
