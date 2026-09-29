import { describe, expect, it } from "vitest";

import {
  EMPTY_LEDGER_DRAFT,
  ledgerBalanceAfter,
  resolveLedgerFilters,
} from "./ledgerFilters";
import type { AdminLedgerEntry } from "./memberAdmin";

describe("ledger query bounds and balance", () => {
  it("does not constrain the default all-time query", () => {
    expect(resolveLedgerFilters(EMPTY_LEDGER_DRAFT).filters).toEqual({
      userId: undefined,
      entryType: undefined,
      start: undefined,
      end: undefined,
    });
  });

  it("uses the local start and inclusive end of custom dates, including fractional events", () => {
    const result = resolveLedgerFilters({
      ...EMPTY_LEDGER_DRAFT,
      timeRange: "custom",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
    });
    expect(result.error).toBeUndefined();
    expect(result.filters?.start).toBe(new Date(2026, 8, 1).toISOString());
    expect(result.filters?.end).toBe(
      new Date(2026, 8, 2, 23, 59, 59, 999)
        .toISOString()
        .replace(".999Z", ".999999999Z")
    );
  });

  it("rejects incomplete and reversed custom dates before querying", () => {
    expect(
      resolveLedgerFilters({ ...EMPTY_LEDGER_DRAFT, timeRange: "custom" }).error
    ).toBeTruthy();
    expect(
      resolveLedgerFilters({
        ...EMPTY_LEDGER_DRAFT,
        timeRange: "custom",
        startDate: "2026-09-03",
        endDate: "2026-09-02",
      }).error
    ).toBeTruthy();
  });

  it("reads the correct account snapshot and preserves missing values", () => {
    const entry = {
      bucket: "grant",
      permanent_after: 100,
      grant_remaining_after: 15,
    } as AdminLedgerEntry;
    expect(ledgerBalanceAfter(entry)).toBe(15);
    expect(ledgerBalanceAfter({ ...entry, bucket: "permanent" })).toBe(100);
    expect(ledgerBalanceAfter({ ...entry, grant_remaining_after: 0 })).toBe(0);
    expect(
      ledgerBalanceAfter({ ...entry, grant_remaining_after: undefined })
    ).toBeUndefined();
    expect(ledgerBalanceAfter({ ...entry, bucket: "unknown" })).toBeUndefined();
  });
});
