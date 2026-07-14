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
    return {
      row,
      column,
      rippleDelay: Math.round(distance * 58 + naturalOffset),
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
            "--dot-reveal-delay": `${dot.revealDelay}ms`,
            "--dot-image-position": `${(dot.column / (size - 1)) * 100}% ${(dot.row / (size - 1)) * 100}%`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
