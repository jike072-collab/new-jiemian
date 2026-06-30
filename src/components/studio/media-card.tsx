"use client";

/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, Download, ExternalLink, Eye, Loader2, Play, Trash2 } from "lucide-react";

import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

export function LibraryCardActions({
  item,
  mediaMissing,
  deleting,
  onPreview,
  onDelete,
}: {
  item: LibraryItem;
  mediaMissing: boolean;
  deleting: boolean;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const canDownloadStoredFile = Boolean(item.output?.url && item.output.storedName && !mediaMissing);

  return (
    <div className="studio-library-tile__actions" aria-label="作品操作">
      <button type="button" onClick={onPreview}>
        <Eye className="size-4" aria-hidden="true" />
        预览
      </button>
      {canDownloadStoredFile ? (
        <a href={item.output?.url} download>
          <Download className="size-4" aria-hidden="true" />
          下载
        </a>
      ) : null}
      <button type="button" onClick={onDelete} disabled={deleting}>
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
        {deleting ? "删除中" : "删除"}
      </button>
    </div>
  );
}

export function MediaCard({
  item,
  large = false,
  compact = false,
  mediaMissing = false,
  onMediaMissing,
}: {
  item: LibraryItem;
  large?: boolean;
  compact?: boolean;
  mediaMissing?: boolean;
  onMediaMissing?: () => void;
}) {
  const media = item.output;
  const hasMediaUrl = Boolean(media?.url) && !mediaMissing;
  const typeLabel = libraryModeLabel(item);
  const createdAt = formatDateTime(item.createdAt);
  const dimensionText = libraryDimensions(item);
  const scaleText = typeof item.params.scale === "number" || typeof item.params.scale === "string"
    ? `${item.params.scale}x`
    : "";
  const fileSizeText = typeof media?.size === "number" ? formatBytes(media.size) : "";
  const durationText = libraryDuration(item);
  const canDownloadStoredFile = Boolean(media?.storedName);
  const showActions = large && !compact;
  const showMediaControls = large;
  const showBody = !compact;
  const statusBadge = mediaMissing ? "文件失效" : libraryStatusBadgeLabel(item.status);
  return (
    <article className={cn("studio-media-card", compact && "is-compact")}>
      <div className={cn("studio-media-card__frame", large && "is-large")}>
        {hasMediaUrl && media?.url && item.type === "image" ? (
          <img src={media.url} alt={item.title} onError={onMediaMissing} />
        ) : null}
        {hasMediaUrl && media?.url && item.type === "video" ? (
          <video src={media.url} controls={showMediaControls} preload="metadata" onError={onMediaMissing} />
        ) : null}
        {!hasMediaUrl ? (
          <div className={cn("studio-media-card__missing", mediaMissing && "is-missing")}>
            <AlertTriangle className="size-5" aria-hidden="true" />
            <span>{mediaMissing ? "文件失效" : libraryStatusLabel(item.status)}</span>
          </div>
        ) : null}
        {!large && item.type === "video" && hasMediaUrl ? (
          <>
            <span className="studio-media-card__play" aria-hidden="true">
              <Play className="size-5" fill="currentColor" />
            </span>
            {durationText ? <span className="studio-media-card__duration">{durationText}</span> : null}
          </>
        ) : null}
      </div>
      {showBody ? <div className="studio-media-card__body">
        <div className="studio-media-card__head">
          <strong>{item.title}</strong>
          {statusBadge ? <span>{statusBadge}</span> : null}
        </div>
        <div className="studio-media-card__meta" aria-label="作品信息">
          <span>{typeLabel}</span>
          <span>{createdAt}</span>
          {durationText ? <span>{durationText}</span> : null}
          {scaleText ? <span>{scaleText}</span> : null}
          {dimensionText ? <span>{dimensionText}</span> : null}
          {fileSizeText ? <span>{fileSizeText}</span> : null}
        </div>
        {large && item.error ? <p>{item.error}</p> : null}
        {mediaMissing ? <p className="studio-inline-error" role="alert">结果文件不存在，作品记录仍保留，可刷新或删除。</p> : null}
        {showActions && media?.url && !mediaMissing ? (
          <div className="studio-media-card__actions">
            <a href={media.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              预览
            </a>
            {canDownloadStoredFile ? (
              <a href={media.url} download>
                <Download className="size-4" aria-hidden="true" />
                下载
              </a>
            ) : null}
          </div>
        ) : null}
      </div> : null}
    </article>
  );
}

function libraryModeLabel(item: LibraryItem) {
  if (item.mode === "text-to-image") return "图片生成";
  if (item.mode === "image-to-image") return "图片编辑";
  if (item.mode === "text-to-video") return "视频生成";
  if (item.mode === "image-to-video") return "图像生成视频";
  if (item.mode === "image-upscale") return "图片高清增强";
  if (item.mode === "video-upscale") return "视频高清增强";
  return item.type === "image" ? "图片作品" : "视频作品";
}

function libraryStatusLabel(status: LibraryItem["status"]) {
  if (status === "done") return "已完成";
  if (status === "queued") return "排队中";
  if (status === "generating") return "处理中";
  return "失败";
}

export function libraryStatusBadgeLabel(status: LibraryItem["status"]) {
  return status === "done" ? undefined : libraryStatusLabel(status);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function libraryDimensions(item: LibraryItem) {
  const width = Number(item.params.outputWidth || item.params.sourceWidth || 0);
  const height = Number(item.params.outputHeight || item.params.sourceHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  return `${Math.round(width)}×${Math.round(height)}`;
}

function libraryDuration(item: LibraryItem) {
  const raw = item.params.durationSeconds || item.params.duration || item.params.videoDuration;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!minutes) return `0:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
