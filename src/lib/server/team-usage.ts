import type { UsageLogEntry } from "./quota/types";
import { isSeedance20VideoModel } from "../seedance-model-display";

const consumedStatuses = new Set<UsageLogEntry["status"]>([
  "prechecked",
  "accepted",
  "succeeded",
  "reconciliation_required",
]);

export type TeamUsageSummary = {
  creditUnits: number;
  imageTasks: number;
  videoTasks: number;
};

export type SeedanceCanvasModelSuccess = {
  model: string;
  successfulCount: number;
  referenceVideoSuccessfulCount: number;
};

export type SeedanceCanvasSuccessSummary = {
  successfulCount: number;
  referenceVideoSuccessfulCount: number;
  models: SeedanceCanvasModelSuccess[];
};

type SeedanceCanvasUsageEntry = {
  ownerLocalUserId?: string | null;
  type: string;
  status: string;
  providerId: string;
  model: string;
  createdAt: string;
  params: Record<string, string | number | boolean>;
};

export function aggregateTeamUsage(entries: UsageLogEntry[]): TeamUsageSummary {
  return entries.reduce<TeamUsageSummary>((summary, entry) => {
    if (!consumedStatuses.has(entry.status)) return summary;
    const units = entry.actual_quota_units ?? entry.estimated_quota_units;
    return {
      creditUnits: summary.creditUnits + Math.max(0, Number(units) || 0),
      imageTasks: summary.imageTasks + (entry.operation.startsWith("cloud_image") ? 1 : 0),
      videoTasks: summary.videoTasks + (entry.operation.startsWith("cloud_video") ? 1 : 0),
    };
  }, { creditUnits: 0, imageTasks: 0, videoTasks: 0 });
}

function isSeedanceVideo(entry: SeedanceCanvasUsageEntry) {
  const providerId = entry.providerId.trim().toLowerCase();
  return providerId === "video-main"
    || providerId.startsWith("video-main::model::")
    || providerId === "video-seedance-new"
    || providerId.startsWith("video-seedance-new::model::")
    || isSeedance20VideoModel(entry.model);
}

export function aggregateSeedanceCanvasSuccess(
  entries: SeedanceCanvasUsageEntry[],
  input: { ownerIds: readonly string[]; from: string; to: string },
): SeedanceCanvasSuccessSummary {
  const owners = new Set(input.ownerIds.map((id) => id.trim()).filter(Boolean));
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const models = new Map<string, SeedanceCanvasModelSuccess>();

  for (const entry of entries) {
    if (!entry.ownerLocalUserId || !owners.has(entry.ownerLocalUserId)) continue;
    if (entry.type !== "video" || entry.status !== "done" || !isSeedanceVideo(entry)) continue;
    const canvasRequestedAt = String(entry.params.canvasRequestedAt || "").trim();
    const billingTaskId = String(entry.params.billingTaskId || "").trim();
    if (!canvasRequestedAt && !billingTaskId.startsWith("canvas-video-")) continue;
    const requestedAt = Date.parse(canvasRequestedAt || entry.createdAt);
    if (!Number.isFinite(requestedAt) || requestedAt < from || requestedAt >= to) continue;

    const model = entry.model.trim() || "未记录模型";
    const current = models.get(model) || { model, successfulCount: 0, referenceVideoSuccessfulCount: 0 };
    current.successfulCount += 1;
    if (Number(entry.params.referenceVideos || 0) > 0) current.referenceVideoSuccessfulCount += 1;
    models.set(model, current);
  }

  const rows = [...models.values()].sort((left, right) => (
    right.referenceVideoSuccessfulCount - left.referenceVideoSuccessfulCount
    || right.successfulCount - left.successfulCount
    || left.model.localeCompare(right.model)
  ));
  return {
    successfulCount: rows.reduce((total, row) => total + row.successfulCount, 0),
    referenceVideoSuccessfulCount: rows.reduce((total, row) => total + row.referenceVideoSuccessfulCount, 0),
    models: rows,
  };
}
