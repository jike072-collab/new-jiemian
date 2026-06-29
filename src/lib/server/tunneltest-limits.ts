import "server-only";

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { dataRoot, readJsonFile, writeJsonFile } from "./paths";
import { type BillableOperation, type QuotaSnapshot, type UsageLogEntry, type UsagePage } from "./quota";

type TunneltestPolicy = {
  label: string;
  totalLimit: number;
  rateLimit: number;
  rateWindowMs: number;
};

type TunneltestLimitInput = {
  localUserId: string;
  operation: BillableOperation;
  taskId?: string | null;
  idempotencyKey?: string | null;
  now?: Date;
};

export type TunneltestLimitResult =
  | {
      ok: true;
      status: 200;
      operation: BillableOperation;
      policy: TunneltestPolicy;
      used: number;
      remaining: number;
      snapshot: QuotaSnapshot;
      usage?: UsageLogEntry;
    }
  | {
      ok: false;
      status: 403 | 429;
      code: "tunneltest_quota_exhausted" | "tunneltest_rate_limited";
      operation: BillableOperation;
      policy: TunneltestPolicy;
      message: string;
      retryAfterSeconds?: number;
      snapshot: QuotaSnapshot;
    };

const policies: Record<BillableOperation, TunneltestPolicy> = {
  cloud_image_generation: {
    label: "图片生成",
    totalLimit: 5,
    rateLimit: 5,
    rateWindowMs: 10 * 60 * 1000,
  },
  cloud_video_generation: {
    label: "视频生成",
    totalLimit: 1,
    rateLimit: 1,
    rateWindowMs: 30 * 60 * 1000,
  },
  cloud_image_upscale: {
    label: "图片高清",
    totalLimit: 1,
    rateLimit: 1,
    rateWindowMs: 10 * 60 * 1000,
  },
  cloud_video_upscale: {
    label: "视频高清",
    totalLimit: 1,
    rateLimit: 1,
    rateWindowMs: 10 * 60 * 1000,
  },
};

const usagePath = join(dataRoot, "tunneltest-usage-log.json");
let writeQueue = Promise.resolve();

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim();
}

export function isTunnelTestRuntime() {
  return process.env.PORT === "3107"
    || process.env.DATA_DIR === "data-tunneltest"
    || process.env.UPLOADS_DIR === "uploads-tunneltest"
    || process.env.RUNTIME_STORAGE_ISOLATION === "strict";
}

function totalLimit() {
  return Object.values(policies).reduce((sum, policy) => sum + policy.totalLimit, 0);
}

function userEntries(entries: UsageLogEntry[], localUserId: string) {
  return entries.filter((entry) => entry.local_user_id === localUserId);
}

function usedCount(entries: UsageLogEntry[], localUserId: string, operation?: BillableOperation) {
  return userEntries(entries, localUserId)
    .filter((entry) => !operation || entry.operation === operation)
    .length;
}

function quotaSnapshot(entries: UsageLogEntry[], localUserId: string, now: Date): QuotaSnapshot {
  const total = totalLimit();
  const used = usedCount(entries, localUserId);
  const timestamp = now.toISOString();
  return {
    local_user_id: localUserId,
    new_api_user_id: "tunneltest",
    quota_units: total,
    used_quota_units: used,
    available_quota_units: Math.max(0, total - used),
    display_unit: "credits",
    source: "new_api",
    fetched_at: timestamp,
    cached: false,
    cache_expires_at: timestamp,
  };
}

function minutes(ms: number) {
  return Math.max(1, Math.round(ms / 60000));
}

async function readUsageEntries() {
  return readJsonFile<UsageLogEntry[]>(usagePath, []);
}

async function writeUsageEntries(entries: UsageLogEntry[]) {
  await writeJsonFile(usagePath, entries);
}

async function withUsageLock<T>(action: () => Promise<T>) {
  const previous = writeQueue;
  let release: () => void = () => undefined;
  writeQueue = previous.then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
  }
}

function checkLimit(entries: UsageLogEntry[], input: Required<Pick<TunneltestLimitInput, "localUserId" | "operation" | "now">>): TunneltestLimitResult {
  const policy = policies[input.operation];
  const snapshot = quotaSnapshot(entries, input.localUserId, input.now);
  const operationEntries = userEntries(entries, input.localUserId)
    .filter((entry) => entry.operation === input.operation);
  const used = operationEntries.length;
  const remaining = Math.max(0, policy.totalLimit - used);
  const windowStart = input.now.getTime() - policy.rateWindowMs;
  const recent = operationEntries.filter((entry) => new Date(entry.created_at).getTime() >= windowStart);
  if (recent.length >= policy.rateLimit) {
    const oldest = recent
      .map((entry) => new Date(entry.created_at).getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b)[0] || input.now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + policy.rateWindowMs - input.now.getTime()) / 1000));
    return {
      ok: false,
      status: 429,
      code: "tunneltest_rate_limited",
      operation: input.operation,
      policy,
      message: `操作太频繁：${policy.label}每 ${minutes(policy.rateWindowMs)} 分钟最多 ${policy.rateLimit} 次，请稍后再试。`,
      retryAfterSeconds,
      snapshot,
    };
  }
  if (used >= policy.totalLimit) {
    return {
      ok: false,
      status: 403,
      code: "tunneltest_quota_exhausted",
      operation: input.operation,
      policy,
      message: `测试额度已用完：${policy.label}每账号最多 ${policy.totalLimit} 次。`,
      snapshot,
    };
  }

  return {
    ok: true,
    status: 200,
    operation: input.operation,
    policy,
    used,
    remaining,
    snapshot,
  };
}

function normalizeInput(input: TunneltestLimitInput) {
  return {
    localUserId: normalizeText(input.localUserId),
    operation: input.operation,
    now: input.now || new Date(),
    taskId: normalizeText(input.taskId) || `${input.operation}:${randomUUID()}`,
    idempotencyKey: normalizeText(input.idempotencyKey) || `${input.operation}:${randomUUID()}`,
  };
}

export async function getTunneltestQuotaSnapshot(localUserId: string) {
  const entries = await readUsageEntries();
  return quotaSnapshot(entries, localUserId, new Date());
}

export async function getTunneltestUsagePage(localUserId: string, page = 1, pageSize = 20): Promise<UsagePage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const entries = userEntries(await readUsageEntries(), localUserId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const start = (safePage - 1) * safePageSize;
  return {
    entries: entries.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: entries.length,
  };
}

export async function precheckTunneltestLimit(input: TunneltestLimitInput): Promise<TunneltestLimitResult | null> {
  if (!isTunnelTestRuntime()) return null;
  const normalized = normalizeInput(input);
  if (!normalized.localUserId) {
    return {
      ok: false,
      status: 403,
      code: "tunneltest_quota_exhausted",
      operation: normalized.operation,
      policy: policies[normalized.operation],
      message: "测试额度校验失败：请先登录。",
      snapshot: quotaSnapshot([], "", normalized.now),
    };
  }
  return checkLimit(await readUsageEntries(), normalized);
}

export async function claimTunneltestLimit(input: TunneltestLimitInput): Promise<TunneltestLimitResult | null> {
  if (!isTunnelTestRuntime()) return null;
  return withUsageLock(async () => {
    const normalized = normalizeInput(input);
    const entries = await readUsageEntries();
    const checked = checkLimit(entries, normalized);
    if (!checked.ok) return checked;

    const timestamp = normalized.now.toISOString();
    const usage: UsageLogEntry = {
      id: randomUUID(),
      local_user_id: normalized.localUserId,
      new_api_user_id: "tunneltest",
      task_id: normalized.taskId,
      operation: normalized.operation,
      status: "accepted",
      estimated_quota_units: 1,
      actual_quota_units: 1,
      upstream_log_id: null,
      upstream_request_id: null,
      upstream_model: null,
      upstream_created_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      idempotency_key: normalized.idempotencyKey,
      error_code: null,
      error_message: null,
    };
    const nextEntries = [...entries, usage];
    await writeUsageEntries(nextEntries);
    const used = checked.used + 1;
    return {
      ...checked,
      used,
      remaining: Math.max(0, checked.policy.totalLimit - used),
      snapshot: quotaSnapshot(nextEntries, normalized.localUserId, normalized.now),
      usage,
    };
  });
}

export function tunneltestLimitResponse(result: TunneltestLimitResult) {
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      quota: result.snapshot,
      operation: result.operation,
      used: result.used,
      remaining: result.remaining,
      tunneltest: true,
    });
  }
  return NextResponse.json({
    ok: false,
    code: result.code,
    message: result.message,
    retryAfterSeconds: result.retryAfterSeconds,
    quota: result.snapshot,
    tunneltest: true,
  }, { status: result.status });
}
