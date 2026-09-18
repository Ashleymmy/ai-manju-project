// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderConfigForm,
  ProviderHub,
  mergeConfigDocument,
  toConfigDocument,
  type ProviderRecord,
} from "@ai-manju/provider-hub";

describe("CC Switch provider editing workflow", () => {
  it("keeps a form/JSON draft, protects unsaved edits, and saves only on explicit submit", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const saved = vi.fn(async (_value: ProviderRecord) => true);
    const initial: ProviderRecord = {
      id: "one",
      name: "Company",
      enabled: true,
      base_url: "https://example.invalid/v1",
      capabilities: ["text"],
      text_model: "test-model",
    };
    function Harness() {
      const [draft, setDraft] = useState(initial);
      return (
        <ProviderHub
          providers={[initial]}
          draft={draft}
          onSelect={setDraft}
          onCreate={() => setDraft({ ...initial, id: "" })}
          onReload={() => {}}
          onSaveJSON={async value => {
            saved(value);
            return true;
          }}
          onSaveForm={async () => {
            saved(draft);
            return true;
          }}
          onDraftChange={setDraft}
          renderForm={() => (
            <ProviderConfigForm
              document={toConfigDocument(draft)}
              onChange={document =>
                setDraft(current => mergeConfigDocument(current, document))
              }
            />
          )}
        />
      );
    }
    const button = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        element =>
          element.textContent === label ||
          element.getAttribute("aria-label") === label
      )!;
    const fill = async (
      element: HTMLInputElement | HTMLTextAreaElement,
      value: string
    ) => {
      await act(async () => {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          element,
          value
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    try {
      await act(async () => root.render(<Harness />));
      expect(container.querySelector("dialog")).toBeNull();
      await act(async () => button("编辑 Company").click());
      await act(async () => button("JSON").click());
      const editor = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Provider JSON 配置"]'
      )!;
      const document = JSON.parse(editor.value);
      document.config.name = "Updated in JSON";
      await fill(editor, JSON.stringify(document));
      await act(async () => button("表单").click());
      expect(
        Array.from(container.querySelectorAll("input")).some(
          input => input.value === "Updated in JSON"
        )
      ).toBe(true);
      expect(saved).not.toHaveBeenCalled();
      await act(async () => button("返回供应商列表").click());
      expect(container.textContent).toContain("放弃未保存的修改？");
      await act(async () => button("继续编辑").click());
      await act(async () => button("保存配置").click());
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ id: "one", name: "Updated in JSON" })
      );
      expect(container.querySelector("dialog")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
      vi.unstubAllGlobals();
    }
  });
});
