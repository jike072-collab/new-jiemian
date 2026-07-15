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
    const columnWeight = column / Math.max(size - 1, 1);
    const rowWeight = row / Math.max(size - 1, 1);
    const createFlowScale = (weight: number) => (0.35 + weight * 0.9).toFixed(3);
    const createFlowOpacity = (weight: number) => (0.14 + weight * 0.8).toFixed(3);
    return {
      row,
      column,
      rippleDelay: Math.round(distance * 58 + naturalOffset),
      flowRightScale: createFlowScale(columnWeight),
      flowRightOpacity: createFlowOpacity(columnWeight),
      flowDownScale: createFlowScale(rowWeight),
      flowDownOpacity: createFlowOpacity(rowWeight),
      flowLeftScale: createFlowScale(1 - columnWeight),
      flowLeftOpacity: createFlowOpacity(1 - columnWeight),
      flowUpScale: createFlowScale(1 - rowWeight),
      flowUpOpacity: createFlowOpacity(1 - rowWeight),
      revealDelay: Math.round(distance * 10 + naturalOffset * 0.14),
    };
  });
}

const compactDotRippleDots = createDotRippleDots(8);
const fillDotRippleDots = createDotRippleDots(24);

export function DotRippleLoader({
  fill = false,
  imageSource,
  className,
}: {
  fill?: boolean;
  imageSource?: string;
  className?: string;
}) {
  const dots = fill ? fillDotRippleDots : compactDotRippleDots;
  const size = fill ? 24 : 8;
  return (
    <div
      className={cn("studio-dot-ripple-loader", fill && "is-fill", imageSource && "has-image-fragments", className)}
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
            "--dot-flow-right-scale": dot.flowRightScale,
            "--dot-flow-right-opacity": dot.flowRightOpacity,
            "--dot-flow-down-scale": dot.flowDownScale,
            "--dot-flow-down-opacity": dot.flowDownOpacity,
            "--dot-flow-left-scale": dot.flowLeftScale,
            "--dot-flow-left-opacity": dot.flowLeftOpacity,
            "--dot-flow-up-scale": dot.flowUpScale,
            "--dot-flow-up-opacity": dot.flowUpOpacity,
            "--dot-reveal-delay": `${dot.revealDelay}ms`,
            "--dot-image-position": `${(dot.column / (size - 1)) * 100}% ${(dot.row / (size - 1)) * 100}%`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
