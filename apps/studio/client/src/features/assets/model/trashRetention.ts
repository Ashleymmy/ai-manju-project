import type { Asset } from "@/entities/asset";

/** 与后端 AssetTrashRetention 一致：从删除时刻起保留 30 天 */
export const ASSET_TRASH_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function trashExpiresAt(
  asset: Pick<Asset, "trashed_at" | "trash_expires_at">,
): Date | null {
  if (asset.trash_expires_at) {
    const parsed = Date.parse(asset.trash_expires_at);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  if (asset.trashed_at) {
    const parsed = Date.parse(asset.trashed_at);
    if (!Number.isNaN(parsed)) return new Date(parsed + ASSET_TRASH_RETENTION_DAYS * MS_PER_DAY);
  }
  return null;
}

/** 距离自动清除的整天数，不足一天按 1 天计；已到期为 0 */
export function remainingTrashDays(
  asset: Pick<Asset, "trashed_at" | "trash_expires_at" | "trash_remaining_days">,
  now = Date.now(),
): number {
  const expires = trashExpiresAt(asset);
  if (!expires) {
    return typeof asset.trash_remaining_days === "number" ? Math.max(0, asset.trash_remaining_days) : ASSET_TRASH_RETENTION_DAYS;
  }
  const remaining = expires.getTime() - now;
  if (remaining <= 0) return 0;
  return Math.max(1, Math.ceil(remaining / MS_PER_DAY));
}

export function formatTrashCountdown(days: number): string {
  if (days <= 0) return "即将自动清除";
  return `距离删除还有 ${days} 天`;
}

export function isTrashCountdownUrgent(days: number): boolean {
  return days <= 3;
}
