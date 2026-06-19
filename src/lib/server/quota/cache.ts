import { type QuotaSnapshot } from "./types";

type CacheEntry = {
  snapshot: QuotaSnapshot;
  expiresAtMs: number;
};

export class QuotaDisplayCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs = 15_000) {}

  get(localUserId: string, now = new Date()) {
    const entry = this.entries.get(localUserId);
    if (!entry || entry.expiresAtMs <= now.getTime()) {
      if (entry) this.entries.delete(localUserId);
      return null;
    }
    return {
      ...entry.snapshot,
      cached: true,
    };
  }

  set(localUserId: string, snapshot: QuotaSnapshot, now = new Date()) {
    const expiresAtMs = now.getTime() + this.ttlMs;
    const next = {
      ...snapshot,
      cached: false,
      cache_expires_at: new Date(expiresAtMs).toISOString(),
    };
    this.entries.set(localUserId, { snapshot: next, expiresAtMs });
    return next;
  }

  invalidate(localUserId: string) {
    this.entries.delete(localUserId);
  }

  clear() {
    this.entries.clear();
  }
}
