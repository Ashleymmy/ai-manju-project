// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptTagInput } from "./PromptTagInput";

describe("prompt tag input suggestions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: string[] = [];

  function Harness({ initial }: { initial: string[] }) {
    const [tags, setTags] = useState(initial);
    latest = tags;
    return <PromptTagInput tags={tags} suggestions={["人物", "主角", "景", "水果"]} onChange={setTags} />;
  }
  const input = () => container.querySelector("input") as HTMLInputElement;
  const options = () => [...container.querySelectorAll('[role="option"]')].map(item => item.textContent);
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("keeps a trailing comma and filters suggestions by the last segment", async () => {
    await act(async () => root.render(<Harness initial={[]} />));
    await act(async () => input().focus());
    expect(options()).toEqual(["#人物", "#主角", "#景", "#水果"]);
    await type("人物, 主");
    expect(latest).toEqual(["人物", "主"]);
    expect(options()).toEqual(["#主角"]);
    await type("人物, ");
    expect(input().value).toBe("人物, ");
    expect(options()).toEqual(["#主角", "#景", "#水果"]);
  });

  it("completes the last segment without dropping earlier tags", async () => {
    await act(async () => root.render(<Harness initial={["人物"]} />));
    await act(async () => input().focus());
    await type("人物, 水");
    const option = container.querySelector('[role="option"]') as HTMLElement;
    await act(async () => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(latest).toEqual(["人物", "水果"]);
    expect(input().value).toBe("人物, 水果, ");
  });

  it("supports keyboard selection and escape", async () => {
    await act(async () => root.render(<Harness initial={[]} />));
    await act(async () => input().focus());
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(latest).toEqual(["主角"]);
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
