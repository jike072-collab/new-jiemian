"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

function createDotRippleDelays(size: number) {
  const center = (size - 1) / 2;
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const column = index % size;
    const distance = Math.hypot(row - center, column - center);
    const naturalOffset = (row * 17 + column * 29) % 34;
    return Math.round(distance * 58 + naturalOffset);
  });
}

const compactDotRippleDelays = createDotRippleDelays(8);
const fillDotRippleDelays = createDotRippleDelays(18);

export function DotRippleLoader({ fill = false, className }: { fill?: boolean; className?: string }) {
  const delays = fill ? fillDotRippleDelays : compactDotRippleDelays;
  return (
    <div className={cn("studio-dot-ripple-loader", fill && "is-fill", className)} aria-hidden="true">
      {delays.map((delay, index) => (
        <span
          key={index}
          style={{ "--dot-ripple-delay": `${delay}ms` } as CSSProperties}
        />
      ))}
    </div>
  );
}
