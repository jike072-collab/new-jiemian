import type { CanvasNodeData } from "./types";

type CanvasMediaMetadataInput = Pick<
  CanvasNodeData,
  "createdAt" | "completedAt" | "fileSize" | "generationStartedAt" | "mediaOrigin"
>;

export type CanvasMediaMetadata = {
  created: string;
  size: string;
  wait: string;
};

export function canvasMediaMetadata(data: CanvasMediaMetadataInput): CanvasMediaMetadata {
  const size = formatCanvasMediaSize(data.fileSize);
  if (data.mediaOrigin === "upload") return { created: "", size, wait: "" };
  return {
    created: formatCanvasMediaTime(data.createdAt),
    size,
    wait: formatCanvasMediaWait(data.generationStartedAt || data.createdAt, data.completedAt),
  };
}

export function formatCanvasMediaSize(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${trimDecimal(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${trimDecimal(bytes / 1024 ** 2)} MB`;
  return `${trimDecimal(bytes / 1024 ** 3)} GB`;
}

export function formatCanvasMediaWait(startValue: unknown, endValue: unknown) {
  const start = typeof startValue === "string" ? Date.parse(startValue) : Number.NaN;
  const end = typeof endValue === "string" ? Date.parse(endValue) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}分${remainingSeconds}秒` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}小时${remainingMinutes}分` : `${hours}小时`;
}

function formatCanvasMediaTime(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function trimDecimal(value: number) {
  return value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
