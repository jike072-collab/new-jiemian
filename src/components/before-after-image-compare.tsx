"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

type BeforeAfterImageCompareProps = {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  initialPosition?: number;
  beforeAlt?: string;
  afterAlt?: string;
};

const clampComparePosition = (value: number) => Math.min(97, Math.max(3, value));

export function BeforeAfterImageCompare({
  beforeSrc,
  afterSrc,
  beforeLabel = "增强前",
  afterLabel = "增强后",
  initialPosition = 50,
  beforeAlt = "",
  afterAlt = "",
}: BeforeAfterImageCompareProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => clampComparePosition(initialPosition));
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setPosition(clampComparePosition(nextPosition));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setDragging(true);
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
    const step = event.shiftKey ? 8 : 2;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPosition((current) => clampComparePosition(current - step));
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setPosition((current) => clampComparePosition(current + step));
    }
  };

  return (
    <div
      ref={containerRef}
      className="image-upscale-compare"
      style={{ "--compare-position": `${position}%` } as CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label="图片增强前后对比"
      aria-valuemin={3}
      aria-valuemax={97}
      aria-valuenow={Math.round(position)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <img className="compare-before" src={beforeSrc} alt={beforeAlt} draggable={false} />
      <img className="compare-after" src={afterSrc} alt={afterAlt} draggable={false} />
      <span className="compare-label compare-label--after">{afterLabel}</span>
      <span className="compare-label compare-label--before">{beforeLabel}</span>
      <span className="compare-divider" aria-hidden="true" />
      <span className="compare-handle" aria-hidden="true">
        <span>‹</span>
        <i />
        <span>›</span>
      </span>
    </div>
  );
}
