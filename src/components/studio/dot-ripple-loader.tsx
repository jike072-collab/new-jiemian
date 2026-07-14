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
      rippleDelay: Math.round(distance * 58 + naturalOffset),
      revealDelay: Math.round(distance * 19 + naturalOffset * 0.3),
    };
  });
}

const compactDotRippleDots = createDotRippleDots(8);
const fillDotRippleDots = createDotRippleDots(20);

export function DotRippleLoader({ fill = false, className }: { fill?: boolean; className?: string }) {
  const dots = fill ? fillDotRippleDots : compactDotRippleDots;
  return (
    <div className={cn("studio-dot-ripple-loader", fill && "is-fill", className)} aria-hidden="true">
      {dots.map((dot, index) => (
        <span
          key={index}
          style={{
            "--dot-ripple-delay": `${dot.rippleDelay}ms`,
            "--dot-reveal-delay": `${dot.revealDelay}ms`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
