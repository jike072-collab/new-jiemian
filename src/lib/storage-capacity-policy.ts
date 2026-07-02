export type StorageProtectionLevel =
  | "normal"
  | "warning"
  | "critical"
  | "block-video"
  | "block-media"
  | "emergency"
  | "unavailable";

export type StorageOperation =
  | "read"
  | "download"
  | "login"
  | "admin-check"
  | "cleanup"
  | "image-generation"
  | "image-upscale"
  | "image-media-write"
  | "media-write"
  | "video-upload"
  | "video-generation"
  | "video-upscale"
  | "video-media-write";

export type StorageThresholds = {
  warning: number;
  critical: number;
  blockVideo: number;
  blockMedia: number;
  emergency: number;
};

export type StorageThresholdResolution = {
  thresholds: StorageThresholds;
  valid: boolean;
  errors: string[];
};

export const defaultStorageThresholds: StorageThresholds = {
  warning: 70,
  critical: 80,
  blockVideo: 85,
  blockMedia: 90,
  emergency: 95,
};

export const storageThresholdEnvNames = {
  warning: "STORAGE_WARNING_PERCENT",
  critical: "STORAGE_CRITICAL_PERCENT",
  blockVideo: "STORAGE_VIDEO_BLOCK_PERCENT",
  blockMedia: "STORAGE_MEDIA_BLOCK_PERCENT",
  emergency: "STORAGE_EMERGENCY_PERCENT",
} as const satisfies Record<keyof StorageThresholds, string>;

const levelRank: Record<StorageProtectionLevel, number> = {
  normal: 0,
  warning: 1,
  critical: 2,
  "block-video": 3,
  "block-media": 4,
  emergency: 5,
  unavailable: 6,
};

const readOnlyOperations = new Set<StorageOperation>([
  "read",
  "download",
  "login",
  "admin-check",
  "cleanup",
]);

const videoWriteOperations = new Set<StorageOperation>([
  "video-upload",
  "video-generation",
  "video-upscale",
  "video-media-write",
]);

const mediaWriteOperations = new Set<StorageOperation>([
  "image-generation",
  "image-upscale",
  "image-media-write",
  "media-write",
  ...videoWriteOperations,
]);

export function resolveStorageThresholds(env: Record<string, string | undefined> = process.env): StorageThresholdResolution {
  const next: StorageThresholds = { ...defaultStorageThresholds };
  const errors: string[] = [];

  for (const key of Object.keys(storageThresholdEnvNames) as Array<keyof StorageThresholds>) {
    const envName = storageThresholdEnvNames[key];
    const raw = env[envName];
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
      errors.push(`${envName}_invalid`);
      continue;
    }
    if (parsed > defaultStorageThresholds[key]) {
      errors.push(`${envName}_above_default`);
      continue;
    }
    next[key] = parsed;
  }

  if (!isStrictlyIncreasing(next)) {
    errors.push("storage_threshold_order_invalid");
  }

  if (errors.length) {
    return {
      thresholds: { ...defaultStorageThresholds },
      valid: false,
      errors,
    };
  }

  return {
    thresholds: next,
    valid: true,
    errors: [],
  };
}

export function storageLevelForUsedPercent(usedPercent: number, thresholds: StorageThresholds): StorageProtectionLevel {
  if (!Number.isFinite(usedPercent) || usedPercent < 0) return "unavailable";
  if (usedPercent >= thresholds.emergency) return "emergency";
  if (usedPercent >= thresholds.blockMedia) return "block-media";
  if (usedPercent >= thresholds.blockVideo) return "block-video";
  if (usedPercent >= thresholds.critical) return "critical";
  if (usedPercent >= thresholds.warning) return "warning";
  return "normal";
}

export function strictestStorageLevel(levels: StorageProtectionLevel[]) {
  return levels.reduce<StorageProtectionLevel>((strictest, level) => (
    levelRank[level] > levelRank[strictest] ? level : strictest
  ), "normal");
}

export function isStorageLevelAtLeast(level: StorageProtectionLevel, minimum: StorageProtectionLevel) {
  return levelRank[level] >= levelRank[minimum];
}

export function isStorageOperationAllowed(level: StorageProtectionLevel, operation: StorageOperation) {
  if (readOnlyOperations.has(operation)) return true;
  if (level === "unavailable" || level === "emergency") return false;
  if (isStorageLevelAtLeast(level, "block-media")) return !mediaWriteOperations.has(operation);
  if (isStorageLevelAtLeast(level, "block-video")) return !videoWriteOperations.has(operation);
  return true;
}

export function storageNeedsCleanup(level: StorageProtectionLevel) {
  return isStorageLevelAtLeast(level, "critical");
}

export function storageAllowsVideoWrites(level: StorageProtectionLevel) {
  return isStorageOperationAllowed(level, "video-generation");
}

export function storageAllowsMediaWrites(level: StorageProtectionLevel) {
  return isStorageOperationAllowed(level, "image-generation");
}

function isStrictlyIncreasing(thresholds: StorageThresholds) {
  return thresholds.warning < thresholds.critical
    && thresholds.critical < thresholds.blockVideo
    && thresholds.blockVideo < thresholds.blockMedia
    && thresholds.blockMedia < thresholds.emergency;
}
