import type { LibraryItem } from "./server/types";

export const mediaRetentionDefaultHours = 24;
export const mediaRetentionMinHours = 1;
export const mediaRetentionMaxHours = 168;

export function resolveMediaRetentionHours(raw = process.env.MEDIA_RETENTION_HOURS) {
  const value = String(raw || "").trim();
  if (!value) return mediaRetentionDefaultHours;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return mediaRetentionDefaultHours;
  const hours = Math.trunc(parsed);
  if (hours < mediaRetentionMinHours || hours > mediaRetentionMaxHours) {
    return mediaRetentionDefaultHours;
  }
  return hours;
}

export function mediaRetentionHoursLabel(hours = resolveMediaRetentionHours()) {
  return `${hours}小时`;
}

export function mediaRetentionNotice(hours = resolveMediaRetentionHours()) {
  return `作品仅保存${mediaRetentionHoursLabel(hours)}，请及时下载`;
}

export function mediaCompletedAt(item: Pick<LibraryItem, "completedAt" | "createdAt">) {
  return item.completedAt || item.createdAt;
}

export function mediaExpiresAt(item: Pick<LibraryItem, "completedAt" | "createdAt">, hours = resolveMediaRetentionHours()) {
  const completedAt = new Date(mediaCompletedAt(item));
  if (Number.isNaN(completedAt.getTime())) return undefined;
  return new Date(completedAt.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function attachMediaRetentionMetadata(item: LibraryItem, hours = resolveMediaRetentionHours()): LibraryItem {
  if (item.expired) return item.expiredAt ? { ...item, expiresAt: item.expiredAt } : item;
  if (item.status !== "done" || !item.output?.storedName) return item;
  const expiresAt = mediaExpiresAt(item, hours);
  return expiresAt ? { ...item, expiresAt } : item;
}
