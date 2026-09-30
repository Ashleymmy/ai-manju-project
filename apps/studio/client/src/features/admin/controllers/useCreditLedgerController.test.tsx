// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ledger: vi.fn(), users: vi.fn() }));
vi.mock("../services/adminMemberApi", () => ({
  listAdminLedger: mocks.ledger,
  listAdminMemberUsers: mocks.users,
}));
import { LEDGER_USER_SEARCH_DELAY_MS } from "../model/ledgerFilters";
import {
  useCreditLedgerController,
  type CreditLedgerController,
} from "./useCreditLedgerController";

const alice = {
  user_id: "alice",
  username: "alice-account",
  display_name: "同名用户",
};
const bob = {
  user_id: "bob",
  username: "bob-account",
  display_name: "同名用户",
};
let root: Root,
  client: QueryClient,
  latest: CreditLedgerController,
  container: HTMLDivElement;
let active = true;
function Harness() {
  latest = useCreditLedgerController(active);
  return null;
}
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
  await settle();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  active = true;
  mocks.ledger.mockReset().mockImplementation(async filters => ({
    items: [{ id: filters.userId || "all", amount: -15 }],
    total: 100,
    page_size: 20,
    summary: { increase: 5000, decrease: 1200 },
  }));
  mocks.users.mockReset().mockResolvedValue({ items: [alice, bob], total: 2 });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("applies draft filters together, resets paging, and keeps time bounds when paging", async () => {
  await render();
  await act(async () => latest.setPage(3));
  await settle();
  mocks.ledger.mockClear();
  await act(async () => {
    latest.updateDraft({ entryType: "consume", timeRange: "7" });
    latest.selectUser("bob");
  });
  expect(mocks.ledger).not.toHaveBeenCalled();
  expect(latest.hasUnappliedChanges).toBe(true);
  await act(async () => latest.applyFilters());
  await settle();
  expect(mocks.ledger).toHaveBeenCalledTimes(1);
  const applied = mocks.ledger.mock.calls[0][0];
  expect(applied).toMatchObject({
    userId: "bob",
    entryType: "consume",
    page: 1,
  });
  expect(applied.start).toBeTruthy();
  expect(latest.hasUnappliedChanges).toBe(false);
  await act(async () => latest.setPage(2));
  expect(mocks.ledger.mock.calls.at(-1)?.[0]).toEqual({ ...applied, page: 2 });
});

it("does not silently query everyone when text has no selected user", async () => {
  await render();
  mocks.ledger.mockClear();
  await act(async () => latest.searchUsers("同名"));
  await act(async () => latest.applyFilters());
  expect(mocks.ledger).not.toHaveBeenCalled();
  expect(latest.validationError).toContain("请从匹配用户中选择");
  await act(async () => {
    await new Promise(resolve =>
      setTimeout(resolve, LEDGER_USER_SEARCH_DELAY_MS + 10)
    );
  });
  await settle();
  expect(mocks.users.mock.calls.at(-1)?.[2]).toEqual({ search: "同名" });
  await act(async () => latest.selectUser("bob"));
  await act(async () => latest.applyFilters());
  expect(mocks.ledger.mock.calls.at(-1)?.[0].userId).toBe("bob");
});

it("hides prior results during a new query and resets all conditions", async () => {
  await render();
  expect(latest.items).toHaveLength(1);
  mocks.ledger.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => latest.updateDraft({ entryType: "recharge" }));
  await act(async () => latest.applyFilters());
  expect(latest.isPending).toBe(true);
  expect(latest.items).toEqual([]);
  expect(latest.total).toBe(0);
  expect(latest.ledgerStats).toBeNull();
  await act(async () => latest.resetFilters());
  await settle();
  expect(latest.page).toBe(1);
  expect(latest.draft.entryType).toBe("");
  expect(latest.userSearch).toBe("");
  expect(latest.appliedSummary).toEqual(["全部时间", "全部流水", "全部用户"]);
  expect(mocks.ledger.mock.calls.at(-1)?.[0]).toEqual({
    userId: undefined,
    entryType: undefined,
    start: undefined,
    end: undefined,
    page: 1,
  });
});

it("blocks invalid dates, and does not fetch while inactive", async () => {
  active = false;
  await render();
  expect(mocks.ledger).not.toHaveBeenCalled();
  expect(mocks.users).not.toHaveBeenCalled();
  active = true;
  await render();
  mocks.ledger.mockClear();
  await act(async () =>
    latest.updateDraft({
      timeRange: "custom",
      startDate: "2026-09-10",
      endDate: "2026-09-01",
    })
  );
  await act(async () => latest.applyFilters());
  expect(latest.validationError).toContain("开始日期不能晚于结束日期");
  expect(mocks.ledger).not.toHaveBeenCalled();
});

it("handles failed user lookup without using stale matches, and allows retry", async () => {
  await render();
  mocks.users.mockRejectedValueOnce(new Error("lookup failed"));
  await act(async () => latest.searchUsers("missing"));
  await act(async () => {
    await new Promise(resolve =>
      setTimeout(resolve, LEDGER_USER_SEARCH_DELAY_MS + 10)
    );
  });
  await settle();
  expect(latest.userSearchFailed).toBe(true);
  expect(latest.userOptions).toEqual([]);
  // Names already returned for visible rows survive editing the search.
  expect(latest.knownUsers.alice.display_name).toBe("同名用户");
  await act(async () => latest.retryUserSearch());
  await settle();
  expect(latest.userSearchFailed).toBe(false);
  expect(latest.userOptions).toHaveLength(2);
});

it("allows applying an unchanged query to refresh server results", async () => {
  await render();
  mocks.ledger.mockClear();
  await act(async () => latest.applyFilters());
  expect(mocks.ledger).toHaveBeenCalledTimes(1);
});

it("uses all matching server totals across pages, not each page's rows", async () => {
  mocks.ledger.mockImplementation(async filters => ({
    items: [{ id: `page-${filters.page}`, amount: filters.page === 2 ? 400 : -15 }],
    total: 100,
    page_size: 20,
    summary: filters.entryType === "consume"
      ? { increase: 0, decrease: 900 }
      : { increase: 5000, decrease: 1200 },
  }));
  await render();
  expect(latest.ledgerStats).toEqual({ increase: 5000, decrease: 1200 });
  await act(async () => latest.setPage(2));
  await settle();
  expect(latest.items[0].amount).toBe(400);
  expect(latest.ledgerStats).toEqual({ increase: 5000, decrease: 1200 });
  await act(async () => latest.updateDraft({ entryType: "consume" }));
  await act(async () => latest.applyFilters());
  await settle();
  expect(latest.ledgerStats).toEqual({ increase: 0, decrease: 900 });
});

it("keeps rows usable but never substitutes page amounts when totals are missing", async () => {
  mocks.ledger.mockResolvedValue({ items: [{ id: "old-api", amount: 123 }], total: 2, page_size: 20 });
  await render();
  expect(latest.items).toHaveLength(1);
  expect(latest.ledgerStats).toBeNull();
  mocks.ledger.mockRejectedValueOnce(new Error("summary query failed"));
  await act(async () => latest.reload());
  await settle();
  expect(latest.isError).toBe(true);
  expect(latest.ledgerStats).toBeNull();
});
