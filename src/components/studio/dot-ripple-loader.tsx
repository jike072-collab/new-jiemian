"use client";

import { useEffect, useRef, type CSSProperties } from "react";

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
    const ellipse = Math.max(0, 1 - Math.hypot((x - 0.52) / 0.76, (y - 0.55) / 0.68));
    const core = ellipse ** 1.25;
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
const staticDotFieldDurationMs = 7200;
const staticDotFieldFrameIntervalMs = 1000 / 30;

function StaticDotField({ classes, expanded }: { classes: string; expanded: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return undefined;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    const gridSize = expanded ? 26 : 20;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let visible = document.visibilityState !== "hidden";
    let animationFrame = 0;
    let lastFrameAt = 0;
    let fieldColor = "";
    const startedAt = performance.now();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      fieldColor = getComputedStyle(canvas).color;
    };

    const draw = (progress: number) => {
      context.clearRect(0, 0, width, height);
      const angle = progress * Math.PI * 2;
      const hotspotX = 0.5 + Math.cos(angle) * 0.24 + Math.cos(angle * 2 + 0.8) * 0.045;
      const hotspotY = 0.52 + Math.sin(angle) * 0.23;
      const cellWidth = width / gridSize;
      const cellHeight = height / gridSize;
      const maxRadius = expanded ? 2.55 : 2.25;
      const minColumn = Math.max(0, Math.floor((hotspotX - 0.31) * gridSize));
      const maxColumn = Math.min(gridSize - 1, Math.ceil((hotspotX + 0.31) * gridSize));
      const minRow = Math.max(0, Math.floor((hotspotY - 0.29) * gridSize));
      const maxRow = Math.min(gridSize - 1, Math.ceil((hotspotY + 0.29) * gridSize));
      context.fillStyle = fieldColor;

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const x = (column + 0.5) / gridSize;
          const y = (row + 0.5) / gridSize;
          const distance = Math.hypot((x - hotspotX) / 0.31, (y - hotspotY) / 0.29);
          if (distance >= 1) continue;
          const linearInfluence = 1 - distance;
          const influence = linearInfluence * linearInfluence * (3 - 2 * linearInfluence);
          const radius = 0.9 + influence * (maxRadius - 0.9);
          context.globalAlpha = 0.08 + influence * 0.86;
          context.beginPath();
          context.arc((column + 0.5) * cellWidth, (row + 0.5) * cellHeight, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };

    const tick = (now: number) => {
      animationFrame = 0;
      if (now - lastFrameAt >= staticDotFieldFrameIntervalMs) {
        lastFrameAt = now;
        draw(((now - startedAt) % staticDotFieldDurationMs) / staticDotFieldDurationMs);
      }
      if (visible) animationFrame = window.requestAnimationFrame(tick);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(reducedMotion ? 0.18 : ((performance.now() - startedAt) % staticDotFieldDurationMs) / staticDotFieldDurationMs);
    });
    const handleVisibilityChange = () => {
      const nextVisible = document.visibilityState !== "hidden";
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible && animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else if (visible && !reducedMotion && !animationFrame) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };
    resizeObserver.observe(container);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    resize();
    draw(0.18);
    if (!reducedMotion) animationFrame = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [expanded]);

  return (
    <div className={classes} aria-hidden="true">
      <canvas ref={canvasRef} className="studio-dot-ripple-loader__field" />
    </div>
  );
}

export function DotRippleLoader({
  fill = false,
  expanded = false,
  staticField = false,
  imageSource,
  className,
}: {
  fill?: boolean;
  expanded?: boolean;
  staticField?: boolean;
  imageSource?: string;
  className?: string;
}) {
  const classes = cn(
    "studio-dot-ripple-loader",
    fill && "is-fill",
    fill && !imageSource && "is-vector-field",
    fill && staticField && "is-static-field",
    fill && expanded && "is-expanded-field",
    imageSource && "has-image-fragments",
    className,
  );

  if (fill && staticField && !imageSource) {
    return <StaticDotField classes={classes} expanded={expanded} />;
  }

  let dots = compactDotRippleDots;
  let size = 8;
  if (fill) {
    dots = expanded ? expandedFillDotRippleDots : fillDotRippleDots;
    size = expanded ? 26 : 18;
  }
  return (
    <div
      className={classes}
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
