// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  orders: vi.fn(),
  consumptions: vi.fn(),
}));
vi.mock("../services/adminMemberApi", () => ({
  listAdminMemberUsers: mocks.users,
  listAdminOrders: mocks.orders,
  listAdminConsumptions: mocks.consumptions,
}));
import {
  useDashboardDetailsController,
  type DashboardDetailsController,
} from "./useDashboardDetailsController";

let root: Root, client: QueryClient, latest: DashboardDetailsController;
let active = true;
function Harness() {
  latest = useDashboardDetailsController(active);
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
  mocks.users
    .mockReset()
    .mockResolvedValue({
      items: [
        {
          user_id: "user-real",
          username: "account",
          permanent_balance: 8,
          limited_balance: 2,
          total_recharge_cents: 100,
        },
      ],
      total: 41,
      page_size: 20,
    });
  mocks.orders
    .mockReset()
    .mockResolvedValue({
      items: [{ id: "order-real", user_id: "user-real", amount_cents: 1990 }],
      total: 1,
      page_size: 20,
    });
  mocks.consumptions
    .mockReset()
    .mockResolvedValue({
      items: [
        {
          id: "consumption-real",
          user_id: "user-real",
          status: "reserved",
          credits_quoted: 12,
        },
      ],
      total: 1,
      page_size: 20,
    });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("loads only the active category and never fetches from an inactive dashboard", async () => {
  active = false;
  await render();
  expect(mocks.users).not.toHaveBeenCalled();
  active = true;
  await render();
  expect(latest.rows[0].id).toBe("user-real");
  expect(mocks.orders).not.toHaveBeenCalled();
  expect(mocks.consumptions).not.toHaveBeenCalled();
  await act(async () => latest.selectKind("orders"));
  await settle();
  expect(latest.rows[0].id).toBe("order-real");
});

it("applies server filters atomically and resets paging", async () => {
  await render();
  await act(async () => latest.setPage(3));
  await settle();
  mocks.users.mockClear();
  await act(async () =>
    latest.setDraft({ search: "  昵称  ", status: "disabled" })
  );
  expect(mocks.users).not.toHaveBeenCalled();
  await act(async () => latest.apply());
  expect(mocks.users).toHaveBeenCalledTimes(1);
  expect(mocks.users).toHaveBeenCalledWith(1, 20, {
    search: "昵称",
    status: "disabled",
  });
  await act(async () => latest.selectKind("consumptions"));
  await settle();
  await act(async () =>
    latest.setDraft({ search: "user-real", status: "reserved" })
  );
  await act(async () => latest.apply());
  expect(mocks.consumptions.mock.calls.at(-1)?.[0]).toMatchObject({
    userId: "user-real",
    status: "reserved",
    page: 1,
  });
  await act(async () => latest.reset());
  expect(latest.filters).toEqual({ search: "", status: "", page: 1 });
});

it("clears the old category and selected detail while the next category loads", async () => {
  await render();
  await act(async () => latest.setDetail(latest.rows[0]));
  mocks.orders.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => latest.selectKind("orders"));
  expect(latest.isPending).toBe(true);
  expect(latest.rows).toEqual([]);
  expect(latest.detail).toBeNull();
  expect(latest.filters.page).toBe(1);
});

it("exposes a query failure and supports retry without showing old records", async () => {
  mocks.users.mockRejectedValueOnce(new Error("server failure"));
  await render();
  expect(latest.isError).toBe(true);
  expect(latest.rows).toEqual([]);
  await act(async () => latest.reload());
  await settle();
  expect(latest.isError).toBe(false);
  expect(latest.rows[0].id).toBe("user-real");
});
