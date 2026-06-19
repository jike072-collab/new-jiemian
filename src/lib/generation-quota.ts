import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

type GenerationBillableOperation = "cloud_image_generation" | "cloud_video_generation";

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

export type GenerationBillingIntent =
  | {
      kind: "image";
      providerId: string;
      mode: WorkspaceImageMode;
      ratio: string;
      quality: string;
      referenceImages: number;
    }
  | {
      kind: "video";
      providerId: string;
      mode: WorkspaceVideoMode;
      ratio: string;
      durationSeconds: number;
      referenceImages: number;
    };

export function generationBillingOperation(input: Pick<GenerationBillingIntent, "kind">): GenerationBillableOperation {
  return input.kind === "image" ? "cloud_image_generation" : "cloud_video_generation";
}

export function estimateGenerationQuota(input: GenerationBillingIntent) {
  return input.kind === "image"
    ? estimateImageGenerationQuota({
      mode: input.mode,
      quality: input.quality,
      referenceImages: input.referenceImages,
    })
    : estimateVideoGenerationQuota({
      mode: input.mode,
      durationSeconds: input.durationSeconds,
      referenceImages: input.referenceImages,
    });
}

export function generationBillingFingerprint(input: GenerationBillingIntent & {
  taskId: string;
  estimatedQuotaUnits: number;
}) {
  const parts = input.kind === "image"
    ? [
      input.kind,
      generationBillingOperation(input),
      input.taskId,
      input.providerId,
      input.mode,
      input.ratio,
      input.quality,
      Math.max(0, Math.trunc(input.referenceImages)),
      input.estimatedQuotaUnits,
    ]
    : [
      input.kind,
      generationBillingOperation(input),
      input.taskId,
      input.providerId,
      input.mode,
      input.ratio,
      Math.max(1, Math.floor(input.durationSeconds || 1)),
      Math.max(0, Math.trunc(input.referenceImages)),
      input.estimatedQuotaUnits,
    ];
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}
