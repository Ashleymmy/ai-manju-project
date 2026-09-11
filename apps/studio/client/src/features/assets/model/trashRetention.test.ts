import { describe, expect, it } from "vitest";

import {
  ASSET_TRASH_RETENTION_DAYS,
  formatTrashCountdown,
  isTrashCountdownUrgent,
  remainingTrashDays,
  trashExpiresAt,
} from "./trashRetention";

describe("asset trash retention", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");

  it("keeps assets for 30 days from the delete timestamp", () => {
    const trashedAt = "2026-09-09T12:00:00.000Z";
    const expires = trashExpiresAt({ trashed_at: trashedAt });
    expect(expires?.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(remainingTrashDays({ trashed_at: trashedAt }, now)).toBe(ASSET_TRASH_RETENTION_DAYS);
  });

  it("prefers trash_expires_at from the API", () => {
    expect(remainingTrashDays({
      trashed_at: "2026-09-01T12:00:00.000Z",
      trash_expires_at: "2026-09-10T12:00:00.000Z",
    }, now)).toBe(1);
  });

  it("rounds partial days up and treats overdue assets as 0", () => {
    expect(remainingTrashDays({
      trash_expires_at: "2026-09-09T13:30:00.000Z",
    }, now)).toBe(1);
    expect(remainingTrashDays({
      trash_expires_at: "2026-09-09T11:00:00.000Z",
    }, now)).toBe(0);
    expect(formatTrashCountdown(29)).toBe("距离删除还有 29 天");
    expect(formatTrashCountdown(0)).toBe("即将自动清除");
    expect(isTrashCountdownUrgent(3)).toBe(true);
    expect(isTrashCountdownUrgent(4)).toBe(false);
  });
});
