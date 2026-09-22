// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasModelPicker } from "./CanvasModelPicker";
import { canvasModelName, canvasVideoModelOptions } from "../domain/generationModels";

describe("canvas model menu dismissal", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();
  const onCanvasPress = vi.fn();
  const onToolbarClick = vi.fn();
  const options = [
    { value: "provider::gpt-image-1", label: "gpt-image-1" },
    { value: "provider::gpt-image-1.5", label: "gpt-image-1.5" },
  ];
  const trigger = () => container.querySelector('[aria-label="选择生成模型"]') as HTMLButtonElement;
  const menu = () => document.querySelector('[data-slot="popover-content"]');

  async function render(active = true, nodeId = "image-1") {
    await act(async () => root.render(<div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <CanvasModelPicker key={nodeId} active={active} value={options[0].value} label={options[0].label} options={options} onSelect={onSelect} />
      <div data-testid="canvas" onPointerDown={event => { event.stopPropagation(); onCanvasPress(); }}>画布空白</div>
      <button data-testid="toolbar" onClick={onToolbarClick}>工具栏</button>
      <input aria-label="提示词" />
    </div>));
  }
  async function open() {
    await act(async () => trigger().click());
    // Radix installs its normal outside-pointer listener on the next task.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(menu()).not.toBeNull();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["mouse", "touch"])("closes on the first outside %s press even when canvas dragging stops propagation", async pointerType => {
    await open();
    const event = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    await act(async () => container.querySelector('[data-testid="canvas"]')!.dispatchEvent(event));
    expect(menu()).toBeNull();
    expect(onCanvasPress).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on a click-only toolbar action without consuming that action", async () => {
    await open();
    await act(async () => (container.querySelector('[data-testid="toolbar"]') as HTMLButtonElement).click());
    expect(menu()).toBeNull();
    expect(onToolbarClick).toHaveBeenCalledOnce();
  });

  it("preserves focus in an outside prompt field", async () => {
    await open();
    const input = container.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      input.focus();
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it.each(options)("selects $label before closing, including the current model", async option => {
    await open();
    const item = [...menu()!.querySelectorAll("button")].find(button => button.textContent === option.label)!;
    await act(async () => item.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu()).not.toBeNull();
    await act(async () => item.click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(option.value);
    expect(menu()).toBeNull();
  });

  it("still toggles from the model button and closes with Escape", async () => {
    await open();
    await act(async () => trigger().click());
    expect(menu()).toBeNull();
    await open();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();
  });

  it("closes when the inspector hides or the selected node changes", async () => {
    await open();
    await render(false);
    expect(menu()).toBeNull();
    await render(true);
    expect(menu()).toBeNull();
    await open();
    await render(true, "image-2");
    expect(menu()).toBeNull();
  });

  it("allows an existing video node to explicitly select ChinaMobil instead of hiding it behind the old channel", async () => {
    const old = "old::doubao-seedance-2-0-fast-260128";
    const mobile = "mobile::doubao-seedance-2-0-fast-260128";
    const labels = { [mobile]: "c20f" };
    const choices = canvasVideoModelOptions([old, mobile], old, labels, { [old]: "火山", [mobile]: "ChinaMobil" });
    await act(async () => root.render(<CanvasModelPicker active value={old} label={canvasModelName(old, labels)} options={choices} onSelect={onSelect} />));
    await open();
    const buttons = [...menu()!.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].classList.contains("active")).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    const target = buttons.find(button => button.textContent === "c20f · ChinaMobil")!;
    await act(async () => target.click());
    expect(onSelect).toHaveBeenCalledWith(mobile);
    expect(menu()).toBeNull();
  });

  it("disables a saved video channel that is absent from the user's catalog", async () => {
    const restricted = "private::ep-fast";
    const available = "public::ep-fast";
    const choices = canvasVideoModelOptions([available], restricted);
    await act(async () => root.render(<CanvasModelPicker active value={restricted} label="旧模型" options={choices} onSelect={onSelect} />));
    await open();
    const buttons = [...menu()!.querySelectorAll("button")];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].textContent).toContain("当前不可用");
    await act(async () => buttons[0].click());
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => buttons[1].click());
    expect(onSelect).toHaveBeenCalledWith(available);
  });
});
