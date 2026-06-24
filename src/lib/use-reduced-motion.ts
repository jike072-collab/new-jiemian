"use client";

import { useSyncExternalStore } from "react";

import { reducedMotionQuery } from "@/lib/motion-tokens";

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function getServerSnapshot() {
  return false;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
