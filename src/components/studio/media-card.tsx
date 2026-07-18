"use client";

/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, Download, ExternalLink, Pause, Play, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type SyntheticEvent } from "react";

import { DotRippleLoader } from "@/components/studio/dot-ripple-loader";
import { cachedMediaObjectUrl, peekSessionMediaObjectUrl, sessionMediaObjectUrl } from "@/lib/client/media-cache";
import { seedanceLibraryModelName } from "@/lib/seedance-model-display";
import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

const revealedImageKeys = new Set<string>();

function rememberRevealedImage(key: string) {
  if (revealedImageKeys.has(key)) return;
  if (revealedImageKeys.size >= 256) {
    const oldestKey = revealedImageKeys.values().next().value;
    if (oldestKey) revealedImageKeys.delete(oldestKey);
  }
  revealedImageKeys.add(key);
}

export function MediaCard({
  cacheOwnerId,
  item,
  groupItems,
  large = false,
  compact = false,
  smoothReveal = false,
  showDetailFacts = false,
  mediaMissing = false,
  onMediaMissing,
}: {
  cacheOwnerId?: string | null;
  item: LibraryItem;
  groupItems?: LibraryItem[];
  large?: boolean;
  compact?: boolean;
  smoothReveal?: boolean;
  showDetailFacts?: boolean;
  mediaMissing?: boolean;
  onMediaMissing?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);
  const imageRevealFrameRef = useRef<number | null>(null);
  const imageRevealTimeoutRef = useRef<number | null>(null);
  const imageRevealFinishTimeoutRef = useRef<number | null>(null);
  const imageRevealStartedKeyRef = useRef("");
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [readyVideoSource, setReadyVideoSource] = useState("");
  const [readyImageSource, setReadyImageSource] = useState("");
  const [finishedImageRevealKey, setFinishedImageRevealKey] = useState("");
  const [imageRevealBounds, setImageRevealBounds] = useState({ key: "", top: 0, left: 0, width: 0, height: 0 });
  const [activeImageState, setActiveImageState] = useState({ key: "", index: 0 });
  const [imageViewportState, setImageViewportState] = useState({
    key: "",
    zoom: 1,
    offset: { x: 0, y: 0 },
    dragging: false,
  });
  const media = item.output;
  const imageGroupItems = item.type === "image"
    ? (groupItems || [item])
      .filter((entry) => entry.type === "image" && entry.output?.url && !entry.expired)
      .sort((left, right) => Number(left.params.imagePageIndex || left.params.imageBatchIndex || 0) - Number(right.params.imagePageIndex || right.params.imageBatchIndex || 0))
      .slice(0, item.params.imageBatchTotal === 10 ? 10 : 4)
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
  const displayTitle = item.title === typeLabel || item.mode === "image-upscale" || item.mode === "video-upscale"
    ? ""
    : item.title;
  const createdAt = formatDateTime(item.createdAt);
  const scaleText = typeof item.params.scale === "number" || typeof item.params.scale === "string"
    ? `x${item.params.scale}`
    : "";
  const fileSizeText = typeof media?.size === "number" ? formatBytes(media.size) : "";
  const ratioText = libraryRatio(item);
  const durationText = libraryDuration(item);
  const canDownloadStoredFile = Boolean(media?.storedName);
  const showActions = large && !compact;
  const showMediaControls = large;
  const showBody = !compact;
  const imageLoading = large ? "eager" : "lazy";
  const imageFetchPriority = large ? "high" : "low";
  const imageUrl = media?.url && item.type === "image" ? mediaPreviewUrl(media.url, large) : media?.url;
  const videoSource = item.type === "video" ? media?.url || "" : "";
  const retainImageSource = smoothReveal && item.type === "image";
  const resolvedMediaUrl = useCachedMediaSource(cacheOwnerId, item.type === "image" ? imageUrl : videoSource, retainImageSource);
  const imageElementSource = item.type === "image" ? resolvedMediaUrl || (retainImageSource ? "" : imageUrl || "") : "";
  const displayedImageSource = item.type === "image" && !showLargeGallery && !isImageGroup && hasMediaUrl
    ? imageElementSource || imageUrl || ""
    : "";
  const imageRevealKey = displayedImageSource ? imageUrl || displayedImageSource : "";
  const imageRevealPreviouslyFinished = Boolean(imageRevealKey) && revealedImageKeys.has(imageRevealKey);
  const imageReady = !smoothReveal || !displayedImageSource || imageRevealPreviouslyFinished || readyImageSource === displayedImageSource;
  const imageRevealFinished = !smoothReveal || !displayedImageSource || imageRevealPreviouslyFinished || finishedImageRevealKey === imageRevealKey;
  const resolvedVideoSource = item.type === "video" ? resolvedMediaUrl || videoSource : "";
  const videoReady = Boolean(resolvedVideoSource) && readyVideoSource === resolvedVideoSource;
  const statusBadge = mediaExpired ? "已过期" : mediaMissing ? "文件失效" : libraryStatusBadgeLabel(item.status);

  const cancelScheduledImageReveal = useCallback(() => {
    if (imageRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(imageRevealFrameRef.current);
      imageRevealFrameRef.current = null;
    }
    if (imageRevealTimeoutRef.current !== null) {
      window.clearTimeout(imageRevealTimeoutRef.current);
      imageRevealTimeoutRef.current = null;
    }
    if (imageRevealFinishTimeoutRef.current !== null) {
      window.clearTimeout(imageRevealFinishTimeoutRef.current);
      imageRevealFinishTimeoutRef.current = null;
    }
  }, []);

  const handleImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (!displayedImageSource) return;
    const image = event.currentTarget;
    const containerWidth = image.clientWidth;
    const containerHeight = image.clientHeight;
    const naturalRatio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0;
    if (containerWidth > 0 && containerHeight > 0 && naturalRatio > 0) {
      const containerRatio = containerWidth / containerHeight;
      const width = naturalRatio >= containerRatio ? containerWidth : containerHeight * naturalRatio;
      const height = naturalRatio >= containerRatio ? containerWidth / naturalRatio : containerHeight;
      setImageRevealBounds({
        key: imageRevealKey,
        top: (containerHeight - height) / 2,
        left: (containerWidth - width) / 2,
        width,
        height,
      });
    }
    if (!smoothReveal || imageRevealPreviouslyFinished) {
      setReadyImageSource(displayedImageSource);
      return;
    }
    if (imageRevealStartedKeyRef.current === imageRevealKey) return;
    imageRevealStartedKeyRef.current = imageRevealKey;
    cancelScheduledImageReveal();
    imageRevealFrameRef.current = window.requestAnimationFrame(() => {
      imageRevealFrameRef.current = window.requestAnimationFrame(() => {
        imageRevealTimeoutRef.current = window.setTimeout(() => {
          setReadyImageSource(displayedImageSource);
          imageRevealTimeoutRef.current = null;
          imageRevealFinishTimeoutRef.current = window.setTimeout(() => {
            rememberRevealedImage(imageRevealKey);
            imageRevealStartedKeyRef.current = "";
            setFinishedImageRevealKey(imageRevealKey);
            imageRevealFinishTimeoutRef.current = null;
          }, 1_600);
        }, 72);
      });
    });
  }, [cancelScheduledImageReveal, displayedImageSource, imageRevealKey, imageRevealPreviouslyFinished, smoothReveal]);

  useEffect(() => () => {
    if (imageRevealStartedKeyRef.current) {
      rememberRevealedImage(imageRevealStartedKeyRef.current);
      imageRevealStartedKeyRef.current = "";
    }
    cancelScheduledImageReveal();
  }, [cancelScheduledImageReveal, imageRevealKey]);

  useEffect(() => {
    if (item.type !== "image" || !hasMediaUrl || !imageUrl || retainImageSource) return undefined;
    const warmImage = new Image();
    warmImage.decoding = "async";
    warmImage.src = imageUrl;
    return () => {
      warmImage.src = "";
    };
  }, [hasMediaUrl, imageUrl, item.type, retainImageSource]);

  const detailFactItem = showLargeGallery ? activeImageItem || item : item;
  const detailFacts = showDetailFacts ? buildLibraryDetailFacts(detailFactItem) : [];

  const setActiveImageIndex = (index: number) => {
    dragStateRef.current = null;
    setActiveImageState({ key: imageGroupKey, index });
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

  useEffect(() => {
    const element = zoomSurfaceRef.current;
    if (!element || !large || item.type !== "image") return undefined;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const direction = Math.sign(event.deltaY);
      if (!direction) return;
      setImageViewportState((current) => {
        const currentZoom = current.key === imageViewportKey ? current.zoom : 1;
        const next = currentZoom + (direction < 0 ? 0.2 : -0.2);
        const zoom = Math.min(4, Math.max(0.5, Number(next.toFixed(2))));
        return {
          key: imageViewportKey,
          zoom,
          offset: current.key === imageViewportKey ? current.offset : { x: 0, y: 0 },
          dragging: false,
        };
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [imageViewportKey, item.type, large]);

  const togglePreviewPlayback = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.muted = true;
      try {
        await video.play();
        setPreviewPlaying(true);
      } catch {
        setPreviewPlaying(false);
      }
      return;
    }
    video.pause();
    setPreviewPlaying(false);
  };

  const clampImageOffset = (value: { x: number; y: number }, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const movementRatio = Math.max(0.15, Math.abs(imageZoom - 1) / 2);
    const maxX = rect.width * movementRatio;
    const maxY = rect.height * movementRatio;
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
    setImageOffset(clampImageOffset(rawOffset, event.currentTarget));
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
      <div
        className={cn(
          "studio-media-card__frame",
          large && "is-large",
          smoothReveal && displayedImageSource && "has-smooth-image-reveal",
          smoothReveal && displayedImageSource && imageReady && "is-image-ready",
        )}
        data-image-reveal-state={smoothReveal && displayedImageSource
          ? imageRevealFinished ? "ready" : imageReady ? "revealing" : "loading"
          : undefined}
        data-image-reveal-grid={smoothReveal && displayedImageSource ? "24" : undefined}
        data-image-reveal-width={imageRevealBounds.key === imageRevealKey ? Math.round(imageRevealBounds.width) : undefined}
        data-image-reveal-height={imageRevealBounds.key === imageRevealKey ? Math.round(imageRevealBounds.height) : undefined}
      >
        {!large && scaleText ? <span className="studio-media-card__scale-badge">{scaleText}</span> : null}
        {!large && libraryModelName(item) ? <span className="studio-media-card__model-badge">{libraryModelName(item)}</span> : null}
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
                ref={zoomSurfaceRef}
                className={cn("studio-media-card__zoom-surface", "is-draggable", isDraggingImage && "is-dragging")}
                style={{ position: "relative" }}
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
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${imageZoom})`,
                  }}
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
        ) : hasMediaUrl && imageUrl && item.type === "image" && imageElementSource ? (
          large ? (
            <div
              ref={zoomSurfaceRef}
              className={cn("studio-media-card__zoom-surface", "is-draggable", isDraggingImage && "is-dragging")}
              style={{ position: "relative" }}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerEnd}
              onPointerCancel={handleImagePointerEnd}
            >
              <img
                src={imageElementSource}
                alt={item.title}
                loading={imageLoading}
                decoding="async"
                fetchPriority={imageFetchPriority}
                onLoad={handleImageLoad}
                onError={onMediaMissing}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${imageZoom})`,
                }}
              />
            </div>
          ) : (
            <img src={imageElementSource} alt={item.title} loading={imageLoading} decoding="async" fetchPriority={imageFetchPriority} onLoad={handleImageLoad} onError={onMediaMissing} />
          )
        ) : null}
        {smoothReveal && displayedImageSource && !imageRevealFinished ? (
          <div
            className="studio-media-card__image-reveal-overlay"
            data-image-reveal-bounded={imageRevealBounds.key === imageRevealKey ? "true" : "false"}
            style={imageRevealBounds.key === imageRevealKey ? {
              inset: "auto",
              top: imageRevealBounds.top,
              left: imageRevealBounds.left,
              width: imageRevealBounds.width,
              height: imageRevealBounds.height,
            } : undefined}
          >
            <DotRippleLoader fill imageSource={imageElementSource || undefined} />
          </div>
        ) : null}
        {hasMediaUrl && media?.url && item.type === "video" ? (
          <>
            {!videoReady ? (
              <div className="studio-media-card__video-placeholder" aria-hidden="true">
                <Video className="size-7" />
                <span>{item.title}</span>
              </div>
            ) : null}
            <video
              ref={videoRef}
              className={cn("studio-media-card__video", videoReady && "is-ready")}
              src={resolvedVideoSource}
              controls={showMediaControls}
              muted={!large}
              playsInline
              preload={large ? "metadata" : "auto"}
              onLoadedData={() => setReadyVideoSource(resolvedVideoSource)}
              onError={onMediaMissing}
              onPause={() => setPreviewPlaying(false)}
              onPlay={() => setPreviewPlaying(true)}
              onEnded={() => setPreviewPlaying(false)}
            />
          </>
        ) : null}
        {!hasMediaUrl ? (
          <div className={cn("studio-media-card__missing", unavailable && "is-missing")}>
            <AlertTriangle className="size-5" aria-hidden="true" />
            <span>{mediaExpired ? "文件已过期" : mediaMissing ? "文件失效" : libraryStatusLabel(item.status)}</span>
          </div>
        ) : null}
        {item.type === "video" && hasMediaUrl && (!large || !videoReady) ? (
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
        {displayTitle || statusBadge ? <div className="studio-media-card__head">
          {displayTitle ? <strong>{displayTitle}</strong> : <span />}
          {statusBadge ? <span>{statusBadge}</span> : null}
        </div> : null}
        <div className="studio-media-card__meta" aria-label="Item info">
          <span>{createdAt}</span>
          <span>{fileSizeText || "大小未知"}</span>
          <span>{ratioText || "比例未知"}</span>
        </div>
        {large && item.error && (item.status === "failed" || !item.output?.url) ? <p>生成失败</p> : null}
        {mediaExpired ? <p className="studio-inline-error" role="alert">文件已超过保存期限，作品记录仍保留，可删除记录。</p> : null}
        {!mediaExpired && mediaMissing ? <p className="studio-inline-error" role="alert">结果文件不存在，作品记录仍保留，可刷新或删除。</p> : null}
        {showActions && media?.url && !unavailable ? (
          <div className="studio-media-card__actions">
            <a href={resolvedMediaUrl || media.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              预览
            </a>
            {canDownloadStoredFile ? (
              <a href={resolvedMediaUrl || media.url} download={media.storedName || true}>
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

function useCachedMediaSource(
  ownerLocalUserId: string | null | undefined,
  url: string | null | undefined,
  retainAcrossMounts = false,
) {
  const [cachedSource, setCachedSource] = useState<{ source: string; url: string } | null>(() => {
    const source = retainAcrossMounts && url ? peekSessionMediaObjectUrl(ownerLocalUserId, url) : null;
    return source ? { source, url: url || "" } : null;
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (!url) return undefined;

    const resolveMediaUrl = retainAcrossMounts ? sessionMediaObjectUrl : cachedMediaObjectUrl;
    void resolveMediaUrl(ownerLocalUserId, url).then((cachedUrl) => {
      if (!cachedUrl) return;
      if (cancelled) {
        if (!retainAcrossMounts) URL.revokeObjectURL(cachedUrl);
        return;
      }
      if (!retainAcrossMounts) objectUrl = cachedUrl;
      setCachedSource({ source: cachedUrl, url });
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ownerLocalUserId, retainAcrossMounts, url]);

  return cachedSource && cachedSource.url === url ? cachedSource.source : "";
}

export function buildLibraryDetailFacts(item: LibraryItem) {
  const facts: string[] = [];
  const modelName = libraryModelName(item);
  if (modelName) facts.push(modelName);
  facts.push(formatDateTime(item.createdAt));
  const durationText = libraryDuration(item);
  if (durationText) facts.push(durationText);
  const ratioText = libraryRatio(item);
  if (ratioText) facts.push(ratioText);
  const dimensionText = libraryDimensions(item);
  if (dimensionText) facts.push(dimensionText);
  const scaleText = typeof item.params.scale === "number" || typeof item.params.scale === "string"
    ? `x${item.params.scale}`
    : "";
  if (scaleText) facts.push(scaleText);
  const fileSizeText = typeof item.output?.size === "number" ? formatBytes(item.output.size) : "";
  if (fileSizeText) facts.push(fileSizeText);
  return facts.filter(Boolean);
}

export function libraryModelName(item: LibraryItem) {
  const model = (item.model || "").trim();
  const normalized = model.toLowerCase();
  const seedanceName = seedanceLibraryModelName(model);
  if (seedanceName) return seedanceName;
  if (normalized === "image" || normalized === "banana-img2") return "Image";
  if (normalized === "banana2") return "Banana2";
  if (normalized === "banana-pro") return "Banana Pro";
  if (normalized === "grok-video-1.5") return "Grok";
  return model;
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
