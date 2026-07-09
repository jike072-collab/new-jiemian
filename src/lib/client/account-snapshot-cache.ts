"use client";

import type { CheckInStatus } from "@/lib/account-status";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot } from "@/lib/server/quota";

export type CachedMembershipSnapshot = {
  ok: true;
  plans: Array<{
    id: string;
    name: string;
  }>;
  membership: {
    active: { plan_id: string; ends_at: string } | null;
    entitlements: Record<"prompt_optimize" | "image_generation" | "video_generation", {
      remaining: number;
      granted: number;
      used: number;
    }>;
  };
};

export type CachedAccountSnapshot = {
  userId: string;
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  membership: CachedMembershipSnapshot | null;
  checkInStatus: CheckInStatus;
  savedAt: number;
};

const accountSnapshotCacheKey = "aohuang-account-snapshot-v1";
const accountSnapshotMaxAgeMs = 5 * 60 * 1000;

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCachedAccountSnapshot(userId: string | null | undefined) {
  if (!userId) return null;
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(accountSnapshotCacheKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedAccountSnapshot>;
    if (value.userId !== userId) return null;
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > accountSnapshotMaxAgeMs) return null;
    return value as CachedAccountSnapshot;
  } catch {
    return null;
  }
}

export function readAnyCachedAccountSnapshot() {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(accountSnapshotCacheKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedAccountSnapshot>;
    if (!value.userId) return null;
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > accountSnapshotMaxAgeMs) return null;
    return value as CachedAccountSnapshot;
  } catch {
    return null;
  }
}

export function writeCachedAccountSnapshot(snapshot: Omit<CachedAccountSnapshot, "savedAt">) {
  const store = storage();
  if (!store) return;

  try {
    store.setItem(accountSnapshotCacheKey, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    // Cache is only for visual continuity; failing to write should not affect account data.
  }
}

export function clearCachedAccountSnapshot() {
  const store = storage();
  if (!store) return;

  try {
    store.removeItem(accountSnapshotCacheKey);
  } catch {
    // Ignore cache cleanup failures.
  }
}
