// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listAdminMemberUsers } from "../services/adminMemberApi";
import { UsageMemberPicker } from "./UsageMemberPicker";

vi.mock("../services/adminMemberApi", () => ({ listAdminMemberUsers: vi.fn() }));
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let container: HTMLDivElement;
const changes: string[] = [];
const members = [
  { user_id: "u-1", username: "testyang", display_name: "杨测试" },
  { user_id: "u-2", username: "bing", display_name: "吕柏兵" },
];
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="成员"]')!;
const options = () => Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]"));
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function open() { await act(async () => trigger().click()); await settle(); }
async function choose(text: string) {
  const option = options().find(item => item.textContent?.includes(text));
  expect(option, text).toBeTruthy();
  await act(async () => option!.click());
  await settle();
}
function Harness() {
  const [value, setValue] = useState("");
  return <UsageMemberPicker value={value} onChange={next => { changes.push(next); setValue(next); }} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  vi.resetAllMocks();
  changes.length = 0;
  vi.mocked(listAdminMemberUsers).mockImplementation(async (_page, _size, filters) => {
    const search = filters?.search || "";
    const items = members.filter(member => !search || member.username.includes(search) || member.display_name.includes(search));
    return { items, total: items.length, page: 1, page_size: 200 } as never;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });

it("opens a searchable list under the field and shows the chosen member", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await settle();
  expect(trigger().textContent).toContain("全部成员");
  await open();
  expect(options().map(item => item.textContent)).toEqual(["全部成员", "杨测试testyang", "吕柏兵bing"]);

  const input = document.querySelector<HTMLInputElement>('input[aria-label="查找成员"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "bing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  expect(listAdminMemberUsers).toHaveBeenLastCalledWith(1, 200, { search: "bing" });
  expect(options().map(item => item.textContent)).toEqual(["吕柏兵bing"]);

  await choose("吕柏兵");
  expect(changes).toEqual(["u-2"]);
  expect(trigger().textContent).toBe("吕柏兵bing");
  expect(document.querySelector("[cmdk-item]")).toBeNull();
});

it("clears the member filter from the 全部成员 option", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await settle();
  await open();
  await choose("杨测试");
  await open();
  await choose("全部成员");
  expect(changes).toEqual(["u-1", ""]);
  expect(trigger().textContent).toContain("全部成员");
});
