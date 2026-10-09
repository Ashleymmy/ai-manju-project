import {
  ADMIN_TIME_RANGE_OPTIONS,
  adminLedgerTypeLabel,
  timeRangeStartIso,
  type AdminLedgerEntry,
  type AdminMemberUser,
} from "./memberAdmin";

/** Debounce user lookup and bound each result page; the API searches all users. */
export const LEDGER_USER_SEARCH_DELAY_MS = 300;
export const LEDGER_USER_SEARCH_PAGE_SIZE = 20;

export type LedgerFilterDraft = {
  entryType: string;
  timeRange: string;
  startDate: string;
  endDate: string;
  user: AdminMemberUser | null;
};

export const EMPTY_LEDGER_DRAFT: LedgerFilterDraft = {
  entryType: "",
  timeRange: "0",
  startDate: "",
  endDate: "",
  user: null,
};

export function ledgerUserLabel(user: AdminMemberUser) {
  return user.display_name || user.username || user.user_id;
}

/** The ledger row names its own user; a separately loaded user only fills in for older APIs. */
export function ledgerEntryUserName(
  entry: Pick<AdminLedgerEntry, "user_id" | "username" | "display_name">,
  loadedUser?: AdminMemberUser | null
) {
  const name =
    entry.display_name ||
    entry.username ||
    (loadedUser ? ledgerUserLabel(loadedUser) : "");
  return name === entry.user_id ? "" : name;
}

/** Store the applied bounds once so paging cannot shift a relative time window. */
export function resolveLedgerFilters(
  draft: LedgerFilterDraft,
  now = new Date()
) {
  let start: string | undefined;
  let end: string | undefined;
  let timeLabel = ADMIN_TIME_RANGE_OPTIONS.find(
    option => String(option.value) === draft.timeRange
  )?.label as string | undefined;
  if (draft.timeRange === "custom") {
    if (!draft.startDate || !draft.endDate) {
      return { error: "请选择开始日期和结束日期" } as const;
    }
    if (draft.startDate > draft.endDate) {
      return { error: "开始日期不能晚于结束日期" } as const;
    }
    // Inputs are local calendar dates. Both repositories use inclusive bounds.
    const from = new Date(`${draft.startDate}T00:00:00`);
    const through = new Date(`${draft.endDate}T23:59:59.999`);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(through.getTime())
    ) {
      return { error: "请选择有效日期" } as const;
    }
    start = from.toISOString();
    // Preserve sub-millisecond events at the end of the selected day (Go RFC3339).
    end = through.toISOString().replace(".999Z", ".999999999Z");
    timeLabel = `${draft.startDate} 至 ${draft.endDate}`;
  } else {
    start = timeRangeStartIso(Number(draft.timeRange), now);
  }
  return {
    filters: {
      userId: draft.user?.user_id,
      entryType: draft.entryType || undefined,
      start,
      end,
    },
    summary: [
      timeLabel || "全部时间",
      adminLedgerTypeLabel(draft.entryType),
      draft.user ? ledgerUserLabel(draft.user) : "全部用户",
    ],
  } as const;
}

/** A grant entry's balance is not the permanent account balance; absent is unknown. */
export function ledgerBalanceAfter(entry: AdminLedgerEntry) {
  if (entry.bucket === "grant") return entry.grant_remaining_after;
  if (entry.bucket === "permanent") return entry.permanent_after;
  return undefined;
}
