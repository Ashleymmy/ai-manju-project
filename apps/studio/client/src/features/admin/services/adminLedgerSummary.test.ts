import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/http", () => ({ request: mocks.request }));
import { listAdminLedger } from "./adminMemberApi";

beforeEach(() => mocks.request.mockReset());

it("retains server totals while normalizing only the paginated rows", async () => {
  mocks.request.mockResolvedValue({
    items: [{ id: "one-row", amount: -12 }], total: 45, page: 2, page_size: 20,
    summary: { increase: 900, decrease: 350 },
  });
  const result = await listAdminLedger({ page: 2, userId: "member", entryType: "consume", start: "2026-09-01T00:00:00Z" });
  expect(result.summary).toEqual({ increase: 900, decrease: 350 });
  expect(result.items).toHaveLength(1);
  expect(result.total).toBe(45);
  expect(mocks.request).toHaveBeenCalledWith("/api/admin/billing/ledger", {
    query: { user_id: "member", entry_type: "consume", start: "2026-09-01T00:00:00Z", end: undefined, page: 2, page_size: 20 },
  });
});

it("does not invent zero totals for a server without the summary field", async () => {
  mocks.request.mockResolvedValue({ items: [{ amount: 500 }], total: 1 });
  expect((await listAdminLedger({})).summary).toBeNull();
});
