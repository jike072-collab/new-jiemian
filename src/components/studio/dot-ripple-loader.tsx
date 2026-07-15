"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

function createDotRippleDots(size: number) {
  const center = (size - 1) / 2;
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const column = index % size;
    const distance = Math.hypot(row - center, column - center);
    const naturalOffset = (row * 17 + column * 29) % 34;
    const x = column / Math.max(size - 1, 1);
    const y = row / Math.max(size - 1, 1);
    const ellipse = Math.max(0, 1 - Math.hypot((x - 0.52) / 0.66, (y - 0.58) / 0.58));
    const core = ellipse ** 1.35;
    const directionalScale = x * 0.34 + y * 0.22;
    const fieldSize = 0.8 + core * (4.5 + directionalScale * 2.2);
    const fieldOpacity = 0.008 + core * (0.82 + directionalScale * 0.22);
    const fieldDriftX = ((row * 11 + column * 7) % 9 - 4) * 2.4;
    const fieldDriftY = ((row * 5 + column * 13) % 9 - 4) * 2.1;
    const opacityFloor = 0.06 + (naturalOffset % 7) * 0.025;
    const opacityMidpoint = 0.42 + ((row + column) % 6) * 0.065;
    return {
      row,
      column,
      naturalOffset,
      rippleDelay: Math.round(distance * 58 + naturalOffset),
      revealDelay: Math.round(distance * 10 + naturalOffset * 0.14),
      fieldSize,
      fieldOpacity,
      fieldOpacityLow: fieldOpacity * opacityFloor,
      fieldOpacityMid: fieldOpacity * opacityMidpoint,
      fieldDriftX,
      fieldDriftY,
      fieldDuration: 4800 + naturalOffset * 57,
    };
  });
}

const compactDotRippleDots = createDotRippleDots(8);
const fillDotRippleDots = createDotRippleDots(18);
const expandedFillDotRippleDots = createDotRippleDots(26);

export function DotRippleLoader({
  fill = false,
  expanded = false,
  imageSource,
  className,
}: {
  fill?: boolean;
  expanded?: boolean;
  imageSource?: string;
  className?: string;
}) {
  let dots = compactDotRippleDots;
  let size = 8;
  if (fill) {
    dots = expanded ? expandedFillDotRippleDots : fillDotRippleDots;
    size = expanded ? 26 : 18;
  }
  return (
    <div
      className={cn("studio-dot-ripple-loader", fill && "is-fill", fill && !imageSource && "is-vector-field", fill && expanded && "is-expanded-field", imageSource && "has-image-fragments", className)}
      style={imageSource ? {
        "--dot-image-source": `url(${JSON.stringify(imageSource)})`,
        "--dot-image-size": `${size * 100}% ${size * 100}%`,
      } as CSSProperties : undefined}
      aria-hidden="true"
    >
      {dots.map((dot, index) => (
        <span
          key={index}
          style={{
            "--dot-ripple-delay": `${dot.rippleDelay}ms`,
            "--dot-reveal-delay": `${dot.revealDelay}ms`,
            "--dot-image-position": `${(dot.column / (size - 1)) * 100}% ${(dot.row / (size - 1)) * 100}%`,
            "--dot-field-size": `${dot.fieldSize.toFixed(2)}px`,
            "--dot-field-opacity": dot.fieldOpacity.toFixed(3),
            "--dot-field-opacity-low": dot.fieldOpacityLow.toFixed(3),
            "--dot-field-opacity-mid": dot.fieldOpacityMid.toFixed(3),
            "--dot-field-drift-x": `${dot.fieldDriftX.toFixed(2)}px`,
            "--dot-field-drift-y": `${dot.fieldDriftY.toFixed(2)}px`,
            "--dot-field-drift-x-reverse": `${(-dot.fieldDriftX * 0.58).toFixed(2)}px`,
            "--dot-field-drift-y-reverse": `${(-dot.fieldDriftY * 0.58).toFixed(2)}px`,
            "--dot-field-duration": `${dot.fieldDuration}ms`,
            "--dot-field-delay": `-${dot.naturalOffset * 72}ms`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
