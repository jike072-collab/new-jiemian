import { createElement, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type MotionTag = "div" | "main" | "section" | "article";

type MotionPrimitiveProps = HTMLAttributes<HTMLElement> & {
  as?: MotionTag;
};

function MotionPrimitive({
  as,
  children,
  className,
  ...props
}: MotionPrimitiveProps) {
  return createElement(as ?? "div", { className, ...props }, children);
}

export function PageReveal({
  className,
  ...props
}: MotionPrimitiveProps) {
  return <MotionPrimitive className={cn("motion-page-reveal", className)} {...props} />;
}

export function ResultReveal({
  className,
  ...props
}: MotionPrimitiveProps) {
  return <MotionPrimitive className={cn("motion-result-reveal", className)} {...props} />;
}

export function SkeletonShimmer({
  className,
  ...props
}: MotionPrimitiveProps) {
  return <MotionPrimitive aria-hidden className={cn("motion-skeleton-shimmer", className)} {...props} />;
}
