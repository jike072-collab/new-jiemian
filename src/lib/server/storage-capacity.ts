import "server-only";

import { statfs } from "node:fs/promises";

import {
  isStorageOperationAllowed,
  resolveStorageThresholds,
  storageLevelForUsedPercent,
  storageNeedsCleanup,
  strictestStorageLevel,
  type StorageOperation,
  type StorageProtectionLevel,
  type StorageThresholds,
} from "../storage-capacity-policy";

import { GenerationDiagnosticError } from "./error-diagnostics";
import { dataRoot, uploadsRoot } from "./paths";

export type StorageStat = {
  bsize: number;
  blocks: number;
  bavail: number;
  bfree?: number;
};

export type StorageStatProvider = (path: string) => Promise<StorageStat>;

export type StorageCapacityRootStatus = {
  label: "DATA_DIR" | "UPLOADS_DIR";
  ok: boolean;
  level: StorageProtectionLevel;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  errorCode?: string;
};

export type StorageCapacityStatus = {
  ok: boolean;
  level: StorageProtectionLevel;
  needsCleanup: boolean;
  checkedAt: string;
  cache: "fresh" | "cached";
  thresholds: StorageThresholds;
  thresholdConfigValid: boolean;
  thresholdConfigErrors: string[];
  roots: StorageCapacityRootStatus[];
};

export type StorageCapacityOptions = {
  fresh?: boolean;
  now?: Date;
  statProvider?: StorageStatProvider;
  cacheTtlMs?: number;
};

type CachedStatus = {
  status: StorageCapacityStatus;
  expiresAt: number;
};

const defaultCacheTtlMs = 5000;
let cachedStatus: CachedStatus | null = null;

export class StorageCapacityError extends GenerationDiagnosticError {
  constructor(operation: StorageOperation, status: StorageCapacityStatus) {
    super({
      code: "UPLOAD_WRITE_FAILED",
      status: storageHttpStatus(status.level),
      publicMessage: storagePublicMessage(status.level, operation),
      safeDetails: {
        operation,
        storageLevel: status.level,
        needsCleanup: status.needsCleanup,
      },
    });
    this.name = "StorageCapacityError";
  }
}

export function isStorageCapacityError(error: unknown): error is StorageCapacityError {
  return error instanceof StorageCapacityError
    || (error instanceof GenerationDiagnosticError
      && error.safeDetails.storageLevel !== undefined
      && error.safeDetails.operation !== undefined);
}

export async function getStorageCapacityStatus(options: StorageCapacityOptions = {}): Promise<StorageCapacityStatus> {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  if (!options.fresh && cachedStatus && cachedStatus.expiresAt > nowMs) {
    return { ...cachedStatus.status, cache: "cached" };
  }

  const thresholdResolution = resolveStorageThresholds();
  let roots: StorageCapacityRootStatus[];
  try {
    roots = await Promise.all([
      inspectRoot("DATA_DIR", dataRoot, thresholdResolution.thresholds, options.statProvider),
      inspectRoot("UPLOADS_DIR", uploadsRoot, thresholdResolution.thresholds, options.statProvider),
    ]);
  } catch (error) {
    roots = [
      unavailableRoot("DATA_DIR", safeErrorCode(error)),
      unavailableRoot("UPLOADS_DIR", safeErrorCode(error)),
    ];
  }

  const level = strictestStorageLevel(roots.map((root) => root.level));
  const status: StorageCapacityStatus = {
    ok: level !== "unavailable" && level !== "emergency",
    level,
    needsCleanup: storageNeedsCleanup(level),
    checkedAt: now.toISOString(),
    cache: "fresh",
    thresholds: thresholdResolution.thresholds,
    thresholdConfigValid: thresholdResolution.valid,
    thresholdConfigErrors: thresholdResolution.errors,
    roots,
  };

  cachedStatus = {
    status,
    expiresAt: nowMs + (options.cacheTtlMs ?? defaultCacheTtlMs),
  };
  if (level !== "normal") {
    logStorageWarning(status);
  }
  return status;
}

export async function assertStorageAllows(operation: StorageOperation, options: StorageCapacityOptions = {}) {
  const status = await getStorageCapacityStatus(options);
  if (!isStorageOperationAllowed(status.level, operation)) {
    throw new StorageCapacityError(operation, status);
  }
  return status;
}

export function storageStatusForPublicHealth(status: StorageCapacityStatus) {
  return {
    ok: status.ok,
    level: status.level,
    needsCleanup: status.needsCleanup,
    checkedAt: status.checkedAt,
    cache: status.cache,
    thresholds: status.thresholds,
    thresholdConfigValid: status.thresholdConfigValid,
    roots: status.roots.map((root) => ({
      label: root.label,
      ok: root.ok,
      level: root.level,
      totalBytes: root.totalBytes,
      usedBytes: root.usedBytes,
      availableBytes: root.availableBytes,
      usedPercent: root.usedPercent,
      errorCode: root.errorCode,
    })),
  };
}

export function resetStorageCapacityCacheForTests() {
  cachedStatus = null;
}

async function inspectRoot(
  label: StorageCapacityRootStatus["label"],
  path: string,
  thresholds: StorageThresholds,
  provider: StorageStatProvider = nodeStatfs,
): Promise<StorageCapacityRootStatus> {
  try {
    const stat = await provider(path);
    const blockSize = Number(stat.bsize);
    const blocks = Number(stat.blocks);
    const availableBlocks = Number(stat.bavail);
    if (!Number.isFinite(blockSize) || !Number.isFinite(blocks) || !Number.isFinite(availableBlocks) || blockSize <= 0 || blocks <= 0 || availableBlocks < 0) {
      return unavailableRoot(label, "invalid_stat");
    }
    const totalBytes = blockSize * blocks;
    const availableBytes = Math.min(totalBytes, blockSize * availableBlocks);
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : Number.NaN;
    const level = storageLevelForUsedPercent(usedPercent, thresholds);
    return {
      label,
      ok: level !== "unavailable" && level !== "emergency",
      level,
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: roundPercent(usedPercent),
    };
  } catch (error) {
    return unavailableRoot(label, safeErrorCode(error));
  }
}

async function nodeStatfs(path: string): Promise<StorageStat> {
  const stats = await statfs(path);
  return {
    bsize: Number(stats.bsize),
    blocks: Number(stats.blocks),
    bavail: Number(stats.bavail),
    bfree: Number(stats.bfree),
  };
}

function unavailableRoot(label: StorageCapacityRootStatus["label"], errorCode: string): StorageCapacityRootStatus {
  return {
    label,
    ok: false,
    level: "unavailable",
    totalBytes: null,
    usedBytes: null,
    availableBytes: null,
    usedPercent: null,
    errorCode,
  };
}

function safeErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code || "stat_failed").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48);
  }
  return error instanceof Error ? error.name.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48) : "stat_failed";
}

function storageHttpStatus(level: StorageProtectionLevel) {
  return level === "unavailable" ? 503 : 507;
}

function storagePublicMessage(level: StorageProtectionLevel, operation: StorageOperation) {
  if (level === "unavailable") return "存储容量暂时无法确认，请稍后再试或联系管理员检查。";
  if (level === "emergency") return "服务器存储空间已进入紧急保护，请先清理空间后再提交。";
  if (operation.startsWith("video")) return "服务器存储空间不足，暂时不能提交新的视频任务。";
  return "服务器存储空间不足，暂时不能提交新的媒体任务。";
}

function roundPercent(value: number) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function logStorageWarning(status: StorageCapacityStatus) {
  console.warn(JSON.stringify({
    event: "storage_capacity_warning",
    level: status.level,
    needsCleanup: status.needsCleanup,
    roots: status.roots.map((root) => ({
      label: root.label,
      level: root.level,
      usedPercent: root.usedPercent,
      errorCode: root.errorCode,
    })),
  }));
}
