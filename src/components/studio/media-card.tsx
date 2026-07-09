"use client";

/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, Download, ExternalLink, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";

import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

export function MediaCard({
  item,
  groupItems,
  large = false,
  compact = false,
  showDetailFacts = false,
  mediaMissing = false,
  onMediaMissing,
}: {
  item: LibraryItem;
  groupItems?: LibraryItem[];
  large?: boolean;
  compact?: boolean;
  showDetailFacts?: boolean;
  mediaMissing?: boolean;
  onMediaMissing?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [activeImageState, setActiveImageState] = useState({ key: "", index: 0 });
  const [imageViewportState, setImageViewportState] = useState({
    key: "",
    zoom: 1,
    offset: { x: 0, y: 0 },
    dragging: false,
  });
  const media = item.output;
  const imageGroupItems = item.type === "image"
    ? (groupItems || [item]).filter((entry) => entry.type === "image" && entry.output?.url && !entry.expired).slice(0, 4)
    : [];
  const imageGroupKey = `${item.id}:${imageGroupItems.map((entry) => entry.id).join(",")}`;
  const activeImageIndex = activeImageState.key === imageGroupKey
    ? Math.min(activeImageState.index, Math.max(0, imageGroupItems.length - 1))
    : 0;
  const imageViewportKey = `${item.id}:${activeImageIndex}:${large ? "large" : "tile"}`;
  const imageZoom = imageViewportState.key === imageViewportKey ? imageViewportState.zoom : 1;
  const imageOffset = imageViewportState.key === imageViewportKey ? imageViewportState.offset : { x: 0, y: 0 };
  const isDraggingImage = imageViewportState.key === imageViewportKey ? imageViewportState.dragging : false;
  const isImageGroup = imageGroupItems.length > 1;
  const showLargeGallery = large && isImageGroup;
  const activeImageItem = showLargeGallery ? imageGroupItems[activeImageIndex] || imageGroupItems[0] : null;
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

  useEffect(() => {
    if (item.type !== "image" || !hasMediaUrl || !imageUrl) return undefined;
    const warmImage = new Image();
    warmImage.decoding = "async";
    warmImage.src = imageUrl;
    return () => {
      warmImage.src = "";
    };
  }, [hasMediaUrl, imageUrl, item.type]);

  const detailFactItem = showLargeGallery ? activeImageItem || item : item;
  const detailFacts = showDetailFacts ? buildLibraryDetailFacts(detailFactItem) : [];

  const setActiveImageIndex = (index: number) => {
    dragStateRef.current = null;
    setActiveImageState({ key: imageGroupKey, index });
  };

  const setImageZoom = (nextZoom: number | ((value: number) => number)) => {
    setImageViewportState((current) => {
      const currentZoom = current.key === imageViewportKey ? current.zoom : 1;
      const zoom = typeof nextZoom === "function" ? nextZoom(currentZoom) : nextZoom;
      return {
        key: imageViewportKey,
        zoom,
        offset: current.key === imageViewportKey ? current.offset : { x: 0, y: 0 },
        dragging: current.key === imageViewportKey ? current.dragging : false,
      };
    });
  };

  const setImageOffset = (offset: { x: number; y: number }) => {
    setImageViewportState((current) => ({
      key: imageViewportKey,
      zoom: current.key === imageViewportKey ? current.zoom : 1,
      offset,
      dragging: current.key === imageViewportKey ? current.dragging : false,
    }));
  };

  const setIsDraggingImage = (dragging: boolean) => {
    setImageViewportState((current) => ({
      key: imageViewportKey,
      zoom: current.key === imageViewportKey ? current.zoom : 1,
      offset: current.key === imageViewportKey ? current.offset : { x: 0, y: 0 },
      dragging,
    }));
  };

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

  const handleImageWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    if (!large || item.type !== "image") return;
    event.preventDefault();
    event.stopPropagation();
    const direction = Math.sign(event.deltaY);
    if (!direction) return;
    setImageZoom((current) => {
      const next = current + (direction < 0 ? 0.2 : -0.2);
      return Math.min(4, Math.max(1, Number(next.toFixed(2))));
    });
  };

  const clampImageOffset = (value: { x: number; y: number }, element: HTMLDivElement) => {
    if (imageZoom <= 1) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    const maxX = ((imageZoom - 1) * rect.width) / 2;
    const maxY = ((imageZoom - 1) * rect.height) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, value.x)),
      y: Math.max(-maxY, Math.min(maxY, value.y)),
    };
  };

  const handleImagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!large || item.type !== "image") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    };
    setIsDraggingImage(true);
  };

  const handleImagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const rawOffset = {
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    };
    const next = imageZoom > 1 ? clampImageOffset(rawOffset, event.currentTarget) : rawOffset;
    setImageOffset(next);
  };

  const handleImagePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDraggingImage(false);
  };

  return (
    <article className={cn("studio-media-card", compact && "is-compact")}>
      <div className={cn("studio-media-card__frame", large && "is-large")}>
        {detailFacts.length ? (
          <div className="studio-media-card__facts-overlay" aria-label="Detail facts">
            {detailFacts.map((fact, index) => (
              <span key={`${detailFactItem.id}-${fact}-${index}`}>{fact}</span>
            ))}
          </div>
        ) : null}
        {showLargeGallery ? (
          <div className="studio-media-card__gallery-single">
            {activeImageItem ? (
              <div
                className={cn("studio-media-card__zoom-surface", imageZoom > 1 && "is-zoomed", isDraggingImage && "is-dragging")}
                onWheel={handleImageWheelZoom}
                onPointerDown={handleImagePointerDown}
                onPointerMove={handleImagePointerMove}
                onPointerUp={handleImagePointerEnd}
                onPointerCancel={handleImagePointerEnd}
              >
                <img
                  key={activeImageItem.id}
                  src={activeImageItem.output?.url || ""}
                  alt={activeImageItem.title}
                  loading={imageLoading}
                  decoding="async"
                  fetchPriority={imageFetchPriority}
                  onError={activeImageItem.id === item.id ? onMediaMissing : undefined}
                  style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${imageZoom})` }}
                />
              </div>
            ) : null}
            <div className="studio-media-card__gallery-pager" aria-label="Image switcher">
              {imageGroupItems.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(index === activeImageIndex && "is-active")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveImageIndex(index);
                  }}
                  aria-label={`View image ${index + 1}`}
                  aria-pressed={index === activeImageIndex}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        ) : isImageGroup ? (
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
          large ? (
            <div
              className={cn("studio-media-card__zoom-surface", imageZoom > 1 && "is-zoomed", isDraggingImage && "is-dragging")}
              onWheel={handleImageWheelZoom}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerEnd}
              onPointerCancel={handleImagePointerEnd}
            >
              <img
                src={imageUrl}
                alt={item.title}
                loading={imageLoading}
                decoding="async"
                fetchPriority={imageFetchPriority}
                onError={onMediaMissing}
                style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${imageZoom})` }}
              />
            </div>
          ) : (
            <img src={imageUrl} alt={item.title} loading={imageLoading} decoding="async" fetchPriority={imageFetchPriority} onError={onMediaMissing} />
          )
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
              {previewPlaying ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5" fill="currentColor" />}
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
        <div className="studio-media-card__meta" aria-label="Item info">
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

export function buildLibraryDetailFacts(item: LibraryItem) {
  const facts: string[] = [];
  facts.push(formatDateTime(item.createdAt));
  const durationText = libraryDuration(item);
  if (durationText) facts.push(durationText);
  const ratioText = libraryRatio(item);
  if (ratioText) facts.push(ratioText);
  const dimensionText = libraryDimensions(item);
  if (dimensionText) facts.push(dimensionText);
  const scaleText = typeof item.params.scale === "number" || typeof item.params.scale === "string"
    ? `${item.params.scale}x`
    : "";
  if (scaleText) facts.push(scaleText);
  const fileSizeText = typeof item.output?.size === "number" ? formatBytes(item.output.size) : "";
  if (fileSizeText) facts.push(fileSizeText);
  return facts.filter(Boolean);
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

function libraryRatio(item: LibraryItem) {
  return typeof item.params.ratio === "string" ? item.params.ratio.trim() : "";
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
