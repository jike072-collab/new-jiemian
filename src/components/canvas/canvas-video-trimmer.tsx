"use client";

import { LoaderCircle, Pause, Play, Scissors, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchJsonWithCsrf } from "@/lib/client/api";
import type { LibraryItem } from "@/lib/server/types";

const MAX_CLIP_SECONDS = 14.9;
const MIN_CLIP_SECONDS = 0.1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function timeLabel(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${(safe % 60).toFixed(1).padStart(4, "0")}`;
}

export function CanvasVideoTrimmer({ item, videoUrl, scope, onComplete, onClose }: {
  item: LibraryItem;
  videoUrl: string;
  scope: "personal" | "shared";
  onComplete: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function setStart(value: number) {
    if (!duration) return;
    const nextStart = clamp(value, 0, Math.max(0, duration - MIN_CLIP_SECONDS));
    const nextEnd = clamp(Math.max(endSeconds, nextStart + MIN_CLIP_SECONDS), nextStart + MIN_CLIP_SECONDS, Math.min(duration, nextStart + MAX_CLIP_SECONDS));
    setStartSeconds(nextStart);
    setEndSeconds(nextEnd);
    setPreviewing(false);
  }

  function setEnd(value: number) {
    if (!duration) return;
    setEndSeconds(clamp(value, startSeconds + MIN_CLIP_SECONDS, Math.min(duration, startSeconds + MAX_CLIP_SECONDS)));
    setPreviewing(false);
  }

  async function togglePreview() {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (previewing) {
      video.pause();
      setPreviewing(false);
      return;
    }
    video.currentTime = startSeconds;
    setCurrentSeconds(startSeconds);
    setPreviewing(true);
    await video.play().catch(() => setPreviewing(false));
  }

  async function saveTrim() {
    if (!duration || busy) return;
    setBusy(true);
    setError("");
    videoRef.current?.pause();
    setPreviewing(false);
    try {
      const response = await fetchJsonWithCsrf<{ item: LibraryItem }>("/api/canvas/video-trim", {
        method: "POST",
        body: JSON.stringify({ libraryItemId: item.id, startSeconds, endSeconds, scope }),
      });
      onComplete(response.item);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "视频裁剪失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const clipDuration = Math.max(0, endSeconds - startSeconds);
  return (
    <div className="canvas-editor-backdrop canvas-video-trimmer-backdrop" role="presentation">
      <section className="canvas-video-trimmer" role="dialog" aria-modal="true" aria-label="视频裁剪器">
        <header>
          <div><Scissors /><span><strong>视频裁剪</strong><small>{item.title}</small></span></div>
          <button type="button" className="canvas-icon-button" onClick={onClose} title="关闭视频裁剪" aria-label="关闭视频裁剪"><X /></button>
        </header>
        <div className="canvas-video-trimmer__preview">
          <video
            ref={videoRef}
            src={videoUrl}
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              setDuration(nextDuration);
              setStartSeconds(0);
              setEndSeconds(Math.min(nextDuration, MAX_CLIP_SECONDS));
            }}
            onTimeUpdate={(event) => {
              const current = event.currentTarget.currentTime;
              setCurrentSeconds(current);
              if (previewing && current >= endSeconds - 0.03) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = startSeconds;
                setCurrentSeconds(startSeconds);
                setPreviewing(false);
              }
            }}
            onEnded={() => setPreviewing(false)}
          />
          <span>{timeLabel(currentSeconds)} / {timeLabel(duration)}</span>
        </div>
        <div className="canvas-video-trimmer__controls">
          <div className="canvas-video-trimmer__summary">
            <strong>片段 {timeLabel(startSeconds)} – {timeLabel(endSeconds)}</strong>
            <span>{clipDuration.toFixed(1)} 秒 / 最长 14.9 秒</span>
          </div>
          <label>
            <span>开始</span>
            <input type="range" min="0" max={Math.max(0, duration - MIN_CLIP_SECONDS)} step="0.1" value={startSeconds} disabled={!duration || busy} onChange={(event) => setStart(Number(event.target.value))} />
            <input type="number" min="0" max={Math.max(0, duration - MIN_CLIP_SECONDS)} step="0.1" value={startSeconds.toFixed(1)} disabled={!duration || busy} onChange={(event) => setStart(Number(event.target.value))} aria-label="裁剪开始秒数" />
          </label>
          <label>
            <span>结束</span>
            <input type="range" min={Math.min(duration, startSeconds + MIN_CLIP_SECONDS)} max={Math.min(duration, startSeconds + MAX_CLIP_SECONDS)} step="0.1" value={endSeconds} disabled={!duration || busy} onChange={(event) => setEnd(Number(event.target.value))} />
            <input type="number" min={startSeconds + MIN_CLIP_SECONDS} max={Math.min(duration, startSeconds + MAX_CLIP_SECONDS)} step="0.1" value={endSeconds.toFixed(1)} disabled={!duration || busy} onChange={(event) => setEnd(Number(event.target.value))} aria-label="裁剪结束秒数" />
          </label>
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <footer>
          <button type="button" className="is-secondary" disabled={!duration || busy} onClick={() => void togglePreview()}>{previewing ? <Pause /> : <Play />}<span>{previewing ? "暂停预览" : "预览片段"}</span></button>
          <button type="button" disabled={!duration || clipDuration < MIN_CLIP_SECONDS || clipDuration > MAX_CLIP_SECONDS || busy} onClick={() => void saveTrim()}>{busy ? <LoaderCircle className="is-spinning" /> : <Scissors />}<span>{busy ? "正在裁剪" : "保存裁剪"}</span></button>
        </footer>
      </section>
    </div>
  );
}
