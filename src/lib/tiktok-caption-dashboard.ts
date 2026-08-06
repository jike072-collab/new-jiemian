import type { TikTokConnectionSummary, TikTokPublicPublishJob } from "@/lib/server/tiktok/types";

const shanghaiTimeZone = "Asia/Shanghai";

export type TikTokCaptionAccountGroup = {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  creatorUsername?: string;
  jobs: TikTokPublicPublishJob[];
};

export function shanghaiDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: shanghaiTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatShanghaiDate(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: shanghaiTimeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatShanghaiTime(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: shanghaiTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function groupTodayTikTokCaptionJobs(
  connections: TikTokConnectionSummary[],
  jobs: TikTokPublicPublishJob[],
  now = new Date(),
) {
  const today = shanghaiDateKey(now);
  const groups = new Map<string, TikTokCaptionAccountGroup>();

  for (const connection of connections) {
    groups.set(connection.zernioAccountId, {
      accountId: connection.zernioAccountId,
      displayName: connection.displayName,
      avatarUrl: connection.avatarUrl,
      creatorUsername: connection.creatorUsername,
      jobs: [],
    });
  }

  for (const job of jobs) {
    if (job.deliveryMode !== "creator_inbox" || shanghaiDateKey(job.scheduledAt) !== today) continue;
    const accountId = job.zernioAccountId || "unknown";
    const group = groups.get(accountId) || {
      accountId,
      displayName: accountId === "unknown" ? "未识别账号" : `TikTok ${accountId.slice(-6)}`,
      jobs: [],
    };
    group.jobs.push(job);
    groups.set(accountId, group);
  }

  for (const group of groups.values()) {
    group.jobs.sort((left, right) => {
      const scheduled = Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt);
      return scheduled || Date.parse(left.createdAt) - Date.parse(right.createdAt);
    });
  }

  return [...groups.values()];
}
