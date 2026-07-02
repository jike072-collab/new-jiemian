import "server-only";

import { NextResponse } from "next/server";

import { getWorkloadLimits } from "./workload-limits";

export type WorkloadLease = {
  release: () => void;
};

export type WorkloadAcquireResult =
  | { ok: true; lease: WorkloadLease }
  | { ok: false; retryAfterSeconds: number };

type SlotEntry = {
  id: number;
  expiresAt: number;
};

type WorkloadSlot = {
  key: string;
  limit: number;
  message: string;
  ttlMs?: number;
};

export class InMemoryConcurrencyLimiter {
  private readonly buckets = new Map<string, SlotEntry[]>();
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  tryAcquire(key: string, limit: number, ttlMs: number): WorkloadAcquireResult {
    const normalizedKey = key.trim() || "anonymous";
    const current = this.now().getTime();
    const active = (this.buckets.get(normalizedKey) || []).filter((slot) => slot.expiresAt > current);
    if (active.length >= limit) {
      this.buckets.set(normalizedKey, active);
      const retryAfterMs = Math.min(...active.map((slot) => slot.expiresAt - current));
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    const id = this.nextId++;
    active.push({ id, expiresAt: current + ttlMs });
    this.buckets.set(normalizedKey, active);
    let released = false;
    return {
      ok: true,
      lease: {
        release: () => {
          if (released) return;
          released = true;
          const remaining = (this.buckets.get(normalizedKey) || []).filter((slot) => slot.id !== id);
          if (remaining.length) {
            this.buckets.set(normalizedKey, remaining);
          } else {
            this.buckets.delete(normalizedKey);
          }
        },
      },
    };
  }

  activeCount(key: string) {
    const normalizedKey = key.trim() || "anonymous";
    const current = this.now().getTime();
    const active = (this.buckets.get(normalizedKey) || []).filter((slot) => slot.expiresAt > current);
    if (active.length) {
      this.buckets.set(normalizedKey, active);
    } else {
      this.buckets.delete(normalizedKey);
    }
    return active.length;
  }

  reset() {
    this.buckets.clear();
  }
}

export class WorkloadLimitError extends Error {
  readonly status = 429;
  readonly code = "WORKLOAD_RATE_LIMITED";

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "WorkloadLimitError";
  }
}

const defaultLimiter = new InMemoryConcurrencyLimiter();

export function workloadLimitResponse(error: WorkloadLimitError) {
  return NextResponse.json({
    ok: false,
    code: error.code,
    message: error.message,
    retryAfterSeconds: error.retryAfterSeconds,
  }, {
    status: error.status,
    headers: {
      "Retry-After": String(error.retryAfterSeconds),
    },
  });
}

export async function withWorkloadSlots<T>(
  slots: WorkloadSlot[],
  handler: () => Promise<T>,
  limiter = defaultLimiter,
): Promise<T> {
  const limits = getWorkloadLimits();
  const leases: WorkloadLease[] = [];
  try {
    for (const slot of slots) {
      const acquired = limiter.tryAcquire(slot.key, slot.limit, slot.ttlMs || limits.slotTtlMs);
      if (!acquired.ok) throw new WorkloadLimitError(slot.message, acquired.retryAfterSeconds);
      leases.push(acquired.lease);
    }
    return await handler();
  } finally {
    for (const lease of leases.reverse()) lease.release();
  }
}

export function withUserImageWorkload<T>(localUserId: string, handler: () => Promise<T>) {
  const limits = getWorkloadLimits();
  return withWorkloadSlots([{
    key: `user:${localUserId}:image-task`,
    limit: limits.userImageTasks,
    message: "图片任务正在排队，请稍后再试。",
  }], handler);
}

export function withUserVideoWorkload<T>(localUserId: string, handler: () => Promise<T>) {
  const limits = getWorkloadLimits();
  return withWorkloadSlots([{
    key: `user:${localUserId}:video-task`,
    limit: limits.userVideoTasks,
    message: "视频任务正在排队，请稍后再试。",
  }], handler);
}

export function withVideoUploadPhase<T>(localUserId: string, handler: () => Promise<T>) {
  const limits = getWorkloadLimits();
  return withWorkloadSlots([
    {
      key: `user:${localUserId}:large-upload`,
      limit: limits.userLargeUploads,
      message: "当前已有大文件上传任务，请稍后再试。",
    },
    {
      key: "site:video-upload-phase",
      limit: limits.siteVideoUploadPhase,
      message: "视频上传任务较多，请稍后再试。",
    },
  ], handler);
}

export function withVideoProviderUpload<T>(localUserId: string, handler: () => Promise<T>) {
  const limits = getWorkloadLimits();
  return withWorkloadSlots([
    {
      key: `user:${localUserId}:large-upload`,
      limit: limits.userLargeUploads,
      message: "当前已有大文件上传任务，请稍后再试。",
    },
    {
      key: "site:video-upload-phase",
      limit: limits.siteVideoUploadPhase,
      message: "视频上传任务较多，请稍后再试。",
    },
    {
      key: "process:large-video-io",
      limit: limits.processLargeVideoIo,
      message: "视频上传处理繁忙，请稍后再试。",
    },
  ], handler);
}

export function resetWorkloadLimiterForTests() {
  defaultLimiter.reset();
}

