"use client";

import { AlertCircle, Film, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type VideoHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

type CanvasVideoPreviewProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  src: string;
  decorative?: boolean;
};

export function CanvasVideoPreview({
  src,
  className,
  decorative = false,
  onLoadedData,
  onLoadedMetadata,
  onCanPlay,
  onError,
  ...videoProps
}: CanvasVideoPreviewProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [active, setActive] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState("");
  const [errorSrc, setErrorSrc] = useState("");
  const ready = active && loadedSrc === src;
  const failed = active && errorSrc === src;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || active) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = window.requestAnimationFrame(() => setActive(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setActive(true);
      observer.disconnect();
    }, { rootMargin: "240px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [active]);

  return (
    <span ref={hostRef} className={cn("canvas-video-preview", ready && "is-ready", failed && "is-error", className)}>
      <video
        {...videoProps}
        src={active ? src : undefined}
        preload={active ? "metadata" : "none"}
        aria-hidden={decorative || undefined}
        tabIndex={decorative ? -1 : videoProps.tabIndex}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.duration > 0 && video.currentTime === 0) {
            try {
              video.currentTime = Math.min(0.05, video.duration / 2);
            } catch {
              // Some browsers reject seeking until the first frame is available.
            }
          }
          onLoadedMetadata?.(event);
        }}
        onLoadedData={(event) => {
          setLoadedSrc(src);
          setErrorSrc("");
          onLoadedData?.(event);
        }}
        onCanPlay={(event) => {
          setLoadedSrc(src);
          setErrorSrc("");
          onCanPlay?.(event);
        }}
        onError={(event) => {
          setErrorSrc(src);
          onError?.(event);
        }}
      />
      {!ready ? (
        <span className="canvas-video-preview__loading" aria-hidden="true">
          {failed ? <AlertCircle /> : active ? <LoaderCircle className="is-spinning" /> : <Film />}
        </span>
      ) : null}
    </span>
  );
}
