import type { UsageLogEntry } from "./quota/types";

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
