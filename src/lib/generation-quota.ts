import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

export function estimateImageGenerationQuota(input: {
  mode: WorkspaceImageMode;
  quality: string;
  referenceImages: number;
}) {
  const base = input.quality === "2k" ? 80 : 40;
  const referenceCost = input.mode === "image-to-image" ? Math.min(40, Math.max(0, input.referenceImages) * 8) : 0;
  return Math.max(20, base + referenceCost);
}

export function estimateVideoGenerationQuota(input: {
  mode: WorkspaceVideoMode;
  durationSeconds: number;
  referenceImages: number;
}) {
  const duration = Math.max(1, Math.floor(input.durationSeconds || 1));
  const perSecond = input.mode === "image-to-video" ? 28 : 20;
  const referenceCost = input.mode === "image-to-video" ? Math.min(50, Math.max(0, input.referenceImages) * 12) : 0;
  return Math.max(30, duration * perSecond + referenceCost);
}
