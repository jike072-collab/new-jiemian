"use client";

/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, Download, ExternalLink, ImageUp, Loader2, Play, RefreshCw, Trash2, Video, Wand2 } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";

import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

export function LibraryCardActions({
  item,
  mediaMissing,
  deleting,
  onDelete,
  onRegenerate,
  onUpscale,
  onCreateVideo,
  onEditImage,
}: {
  item: LibraryItem;
  mediaMissing: boolean;
  deleting: boolean;
  onDelete: () => void;
  onRegenerate: () => void;
  onUpscale: () => void;
  onCreateVideo: () => void;
  onEditImage: () => void;
}) {
  const canDownloadStoredFile = Boolean(item.output?.url && item.output.storedName && !mediaMissing);
  const canUseOutput = Boolean(item.output?.url && !mediaMissing && !item.expired);

  return (
    <>
      <button type="button" className="studio-library-tile__delete" onClick={onDelete} disabled={deleting} aria-label="删除作品">
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </button>
      <div className="studio-library-tile__actions" aria-label="作品操作">
        <button type="button" onClick={onRegenerate}>
          <RefreshCw className="size-4" aria-hidden="true" />
          重新生成
        </button>
        {item.type === "image" ? (
          <>
            <button type="button" onClick={onUpscale} disabled={!canUseOutput}>
              <ImageUp className="size-4" aria-hidden="true" />
              放大
            </button>
            <button type="button" onClick={onCreateVideo} disabled={!canUseOutput}>
              <Video className="size-4" aria-hidden="true" />
              生成视频
            </button>
            <button type="button" onClick={onEditImage} disabled={!canUseOutput}>
              <Wand2 className="size-4" aria-hidden="true" />
              图片编辑
            </button>
          </>
        ) : (
          <button type="button" onClick={onUpscale} disabled={!canUseOutput}>
            <ImageUp className="size-4" aria-hidden="true" />
            视频放大
          </button>
        )}
        {canDownloadStoredFile ? (
          <a href={item.output?.url} download>
            <Download className="size-4" aria-hidden="true" />
            下载
          </a>
        ) : null}
      </div>
    </>
  );
}

export function MediaCard({
  item,
  groupItems,
  large = false,
  compact = false,
  mediaMissing = false,
  onMediaMissing,
}: {
  item: LibraryItem;
  groupItems?: LibraryItem[];
  large?: boolean;
  compact?: boolean;
  mediaMissing?: boolean;
  onMediaMissing?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const media = item.output;
  const imageGroupItems = item.type === "image"
    ? (groupItems || [item]).filter((entry) => entry.type === "image" && entry.output?.url && !entry.expired).slice(0, 4)
    : [];
  const isImageGroup = imageGroupItems.length > 1;
  const mediaExpired = Boolean(item.expired);
  const unavailable = mediaMissing || mediaExpired;
  const hasMediaUrl = Boolean(media?.url) && !unavailable;
  const typeLabel = libraryModeLabel(item);
  const createdAt = formatDateTime(item.createdAt);
  const expiresAt = item.expiredAt || item.expiresAt;
  const expiryText = expiresAt ? `${mediaExpired ? "已过期" : "过期"} ${formatDateTime(expiresAt)}` : "";
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
  const imageLoading = large ? "eager" : "lazy";
  const imageFetchPriority = large ? "high" : "low";
  const videoPreload = large ? "auto" : "metadata";
  const imageUrl = media?.url && item.type === "image" ? mediaPreviewUrl(media.url, large) : media?.url;
  const statusBadge = mediaExpired ? "已过期" : mediaMissing ? "文件失效" : libraryStatusBadgeLabel(item.status);
  const batchText = isImageGroup ? `${imageGroupItems.length} 张` : "";

  const togglePreviewPlayback = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.muted = true;
      await video.play();
      setPreviewPlaying(true);
      return;
    }
    video.pause();
    setPreviewPlaying(false);
  };

  return (
    <article className={cn("studio-media-card", compact && "is-compact")}>
      <div className={cn("studio-media-card__frame", large && "is-large")}>
        {isImageGroup ? (
          <div className={cn("studio-media-card__collage", `is-count-${imageGroupItems.length}`)}>
            {imageGroupItems.map((entry) => (
              <img
                key={entry.id}
                src={entry.output?.url ? mediaPreviewUrl(entry.output.url, large) : ""}
                alt={entry.title}
                loading={imageLoading}
                decoding="async"
                fetchPriority={imageFetchPriority}
                onError={entry.id === item.id ? onMediaMissing : undefined}
              />
            ))}
          </div>
        ) : hasMediaUrl && imageUrl && item.type === "image" ? (
          <img src={imageUrl} alt={item.title} loading={imageLoading} decoding="async" fetchPriority={imageFetchPriority} onError={onMediaMissing} />
        ) : null}
        {hasMediaUrl && media?.url && item.type === "video" ? (
          <video
            ref={videoRef}
            src={media.url}
            controls={showMediaControls}
            muted={!large}
            playsInline
            preload={videoPreload}
            onError={onMediaMissing}
            onPause={() => setPreviewPlaying(false)}
            onPlay={() => setPreviewPlaying(true)}
            onEnded={() => setPreviewPlaying(false)}
          />
        ) : null}
        {!hasMediaUrl ? (
          <div className={cn("studio-media-card__missing", unavailable && "is-missing")}>
            <AlertTriangle className="size-5" aria-hidden="true" />
            <span>{mediaExpired ? "文件已过期" : mediaMissing ? "文件失效" : libraryStatusLabel(item.status)}</span>
          </div>
        ) : null}
        {!large && item.type === "video" && hasMediaUrl ? (
          <>
            <button
              type="button"
              className={cn("studio-media-card__play", previewPlaying && "is-playing")}
              onClick={(event) => void togglePreviewPlayback(event)}
              aria-label={previewPlaying ? "暂停预览" : "播放预览"}
            >
              <Play className="size-5" fill="currentColor" />
            </button>
            {durationText ? <span className="studio-media-card__duration">{durationText}</span> : null}
          </>
        ) : null}
      </div>
      {showBody ? <div className="studio-media-card__body">
        <div className="studio-media-card__head">
          <strong>{item.title}</strong>
          {batchText ? <span>{batchText}</span> : statusBadge ? <span>{statusBadge}</span> : null}
        </div>
        <div className="studio-media-card__meta" aria-label="作品信息">
          <span>{typeLabel}</span>
          {batchText ? <span>{batchText}</span> : null}
          <span>{createdAt}</span>
          {durationText ? <span>{durationText}</span> : null}
          {scaleText ? <span>{scaleText}</span> : null}
          {dimensionText ? <span>{dimensionText}</span> : null}
          {fileSizeText ? <span>{fileSizeText}</span> : null}
          {expiryText ? <span>{expiryText}</span> : null}
        </div>
        {large && item.error ? <p>{item.error}</p> : null}
        {mediaExpired ? <p className="studio-inline-error" role="alert">文件已超过保存期限，作品记录仍保留，可删除记录。</p> : null}
        {!mediaExpired && mediaMissing ? <p className="studio-inline-error" role="alert">结果文件不存在，作品记录仍保留，可刷新或删除。</p> : null}
        {showActions && media?.url && !unavailable ? (
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

function mediaPreviewUrl(url: string, large: boolean) {
  if (large || !url.startsWith("/api/files/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}view=thumb`;
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
