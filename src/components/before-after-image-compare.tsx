"use client";

/* eslint-disable @next/next/no-img-element */

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import { cn } from "@/lib/utils";

type BeforeAfterImageCompareProps = {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  initialPosition?: number;
  beforeAlt?: string;
  afterAlt?: string;
  mediaType?: "image" | "video";
  beforeEffect?: "none" | "blur";
  beforePoster?: string;
  afterPoster?: string;
};

const clampComparePosition = (value: number) => Math.min(97, Math.max(3, value));
const videoStartFrameTime = 0.12;
const compareHintStoragePrefix = "aohuang-upscale-compare-hint-seen";

function seekVideoToStartFrame(video: HTMLVideoElement) {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : videoStartFrameTime;
  const startTime = Math.min(videoStartFrameTime, duration);

  try {
    video.currentTime = startTime;
  } catch {
    // The video can still be settling during metadata load; sync will retry on the next media event.
  }
}

export function BeforeAfterImageCompare({
  afterSrc,
  beforeLabel = "高清前",
  afterLabel = "高清后",
  initialPosition = 50,
  beforeAlt = "",
  afterAlt = "",
  mediaType = "image",
  beforeEffect = "blur",
  beforePoster,
  afterPoster,
}: BeforeAfterImageCompareProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const userPausedRef = useRef(false);
  const [position, setPosition] = useState(() => clampComparePosition(initialPosition));
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(mediaType === "video");
  const [hintVisible, setHintVisible] = useState(false);
  const hintStorageKey = `${compareHintStoragePrefix}:${mediaType}`;

  useEffect(() => {
    if (window.sessionStorage.getItem(hintStorageKey)) return undefined;

    const showTimer = window.setTimeout(() => {
      setHintVisible(true);
    }, 120);
    const hideTimer = window.setTimeout(() => {
      window.sessionStorage.setItem(hintStorageKey, "true");
      setHintVisible(false);
    }, 3200);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [hintStorageKey]);

  const dismissHint = useCallback(() => {
    window.sessionStorage.setItem(hintStorageKey, "true");
    setHintVisible(false);
  }, [hintStorageKey]);

  const updateFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setPosition(clampComparePosition(nextPosition));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dismissHint();
    setDragging(true);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    dismissHint();
    const step = event.shiftKey ? 8 : 2;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setPosition((current) => clampComparePosition(current - step));
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setPosition((current) => clampComparePosition(current + step));
    }

    if (event.key === "Home") {
      event.preventDefault();
      setPosition(3);
    }

    if (event.key === "End") {
      event.preventDefault();
      setPosition(97);
    }
  };

  const pauseVideos = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  const playVideos = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  const handleVideoPlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    dismissHint();

    if (!video.paused) {
      userPausedRef.current = true;
      pauseVideos();
      return;
    }

    userPausedRef.current = false;
    playVideos();
  }, [dismissHint, pauseVideos, playVideos]);

  const handlePrimaryVideoPlay = useCallback(() => {
    setPlaying(true);
  }, []);

  const handlePrimaryVideoPause = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleBeforeVideoLoaded = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.currentTime < videoStartFrameTime) {
      seekVideoToStartFrame(video);
    }
  }, []);

  useEffect(() => {
    if (mediaType !== "video") return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        pauseVideos();
        return;
      }

      if (!userPausedRef.current) {
        playVideos();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [mediaType, pauseVideos, playVideos]);

  useEffect(() => {
    if (mediaType !== "video" || userPausedRef.current) return;

    playVideos();
  }, [mediaType, playVideos]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "image-upscale-compare",
        mediaType === "video" && "is-video",
        beforeEffect === "blur" && "has-blurred-before",
        dragging && "is-dragging",
        hintVisible && "is-hint-visible",
      )}
      style={{ "--compare-position": `${position}%` } as CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label={mediaType === "video" ? "视频高清增强前后对比" : "图片高清增强前后对比"}
      aria-valuemin={3}
      aria-valuemax={97}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`左侧${beforeLabel}，右侧${afterLabel}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={() => setDragging(false)}
      onKeyDown={handleKeyDown}
    >
      {mediaType === "video" ? (
        <>
          <video
            ref={videoRef}
            className="compare-video-source"
            src={afterSrc}
            poster={afterPoster ?? beforePoster}
            aria-label={afterAlt}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onLoadedMetadata={handleBeforeVideoLoaded}
            onPlay={handlePrimaryVideoPlay}
            onPause={handlePrimaryVideoPause}
          />
          <span className="compare-video-before" aria-label={beforeAlt} />
        </>
      ) : (
        <>
          <img className="compare-image-source" src={afterSrc} alt={afterAlt} draggable={false} />
          <span className="compare-image-before" aria-label={beforeAlt} />
        </>
      )}
      <span className="compare-label compare-label--after">{afterLabel}</span>
      <span className="compare-label compare-label--before">{beforeLabel}</span>
      <span className="compare-divider" aria-hidden="true" />
      <span className="compare-handle" aria-hidden="true">
        <span>‹</span>
        <i />
        <span>›</span>
      </span>
      <span className="compare-hint" aria-hidden="true">拖动查看对比</span>
      {mediaType === "video" ? (
        <button
          type="button"
          className="compare-play-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleVideoPlayPause}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={playing ? "暂停对比视频" : "播放对比视频"}
        >
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}
