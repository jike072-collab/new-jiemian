import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

type ImageGenerationBillableOperation = "cloud_image_generation" | "cloud_image_edit";
type GenerationBillableOperation = ImageGenerationBillableOperation | "cloud_video_generation";
type UpscaleBillableOperation = "cloud_image_upscale" | "cloud_video_upscale";

export function estimateImageGenerationQuota(input: {
  mode: WorkspaceImageMode;
  quality: string;
  referenceImages: number;
  model?: string | null;
}) {
  return applyBanana2Discount(applyImageQualityMultiplier(300, input.quality), input.model);
}

export function estimateImageGenerationTotalQuota(input: {
  quality: string;
  count: number;
  model?: string | null;
}) {
  const count = Math.min(Math.max(Math.round(Number(input.count) || 1), 1), 4);
  const base = count === 4 ? 1000 : 300 * count;
  return applyBanana2Discount(applyImageQualityMultiplier(base, input.quality), input.model);
}

export function estimateImageGenerationEntitlementUnits(input: { quality: string; count?: number }) {
  const count = Math.min(Math.max(Math.round(Number(input.count) || 1), 1), 4);
  const unitsPerImage = input.quality.trim().toLowerCase() === "4k" ? 2 : 1;
  return count * unitsPerImage;
}

export function estimateVideoGenerationQuota(input: {
  mode: WorkspaceVideoMode;
  durationSeconds: number;
  resolution: string;
  referenceImages: number;
  model?: string | null;
}) {
  const duration = Math.max(1, Math.floor(input.durationSeconds || 1));
  const base = duration * 100;
  let quota = base;
  if (duration >= 15) quota = Math.round(base * 0.8);
  else if (duration >= 12) quota = Math.round(base * 0.85);
  else if (duration >= 10) quota = Math.round(base * 0.9);
  return applyVideoModelPricing(quota, input.model, input.resolution);
}

export function estimateVideoGenerationEntitlementUnits(input: { resolution: string }) {
  return input.resolution.trim().toLowerCase() === "4k" ? 2 : 1;
}

export type GenerationBillingIntent =
  | {
      kind: "image";
      operation: ImageGenerationBillableOperation;
      providerId: string;
      mode: WorkspaceImageMode;
      ratio: string;
      quality: string;
      referenceImages: number;
      model?: string | null;
    }
  | {
      kind: "video";
      providerId: string;
      mode: WorkspaceVideoMode;
      ratio: string;
      durationSeconds: number;
      resolution: string;
      referenceImages: number;
      model?: string | null;
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
      model: input.model,
    })
    : estimateVideoGenerationQuota({
      mode: input.mode,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      referenceImages: input.referenceImages,
      model: input.model,
    });
}

export function generationBillingFingerprint(input: GenerationBillingIntent & {
  taskId: string;
  estimatedQuotaUnits: number;
}) {
  const parts = input.kind === "image"
    ? [
      input.kind,
      input.operation,
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
      input.model || "",
      input.mode,
      input.ratio,
      Math.max(1, Math.floor(input.durationSeconds || 1)),
      input.resolution.trim().toLowerCase(),
      Math.max(0, Math.trunc(input.referenceImages)),
      input.estimatedQuotaUnits,
  ];
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

export function estimateUpscaleQuota(input: {
  kind: "image" | "video";
  scale: string | number;
}) {
  const numericScale = Math.max(1, Math.trunc(Number(input.scale) || 1));
  if (input.kind === "image") {
    if (numericScale >= 4) return 350;
    if (numericScale >= 2) return 200;
    return 100;
  }
  if (numericScale >= 4) return 450;
  if (numericScale >= 2) return 300;
  return 200;
}

export function upscaleBillingOperation(input: { kind: "image" | "video" }): UpscaleBillableOperation {
  return input.kind === "image" ? "cloud_image_upscale" : "cloud_video_upscale";
}

export function upscaleBillingFingerprint(input: {
  kind: "image" | "video";
  scale: string | number;
  taskId: string;
  estimatedQuotaUnits: number;
}) {
  const parts = [
    `${input.kind}-upscale`,
    upscaleBillingOperation(input),
    input.taskId,
    Math.max(1, Math.trunc(Number(input.scale) || 1)),
    input.estimatedQuotaUnits,
  ];
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

function applyImageQualityMultiplier(base: number, quality: string) {
  if (quality === "4k") return Math.round(base * 1.2);
  if (quality === "2k") return Math.round(base * 1.1);
  return base;
}

function applyBanana2Discount(base: number, model?: string | null) {
  return String(model || "").trim().toLowerCase() === "banana2"
    ? Math.round(base * 0.85)
    : base;
}

function applyVideoModelPricing(base: number, model: string | null | undefined, resolution: string) {
  const normalizedModel = String(model || "").trim().toLowerCase();
  if (normalizedModel === "grok-video-1.0") return Math.round(base * 0.8);
  if (normalizedModel !== "veo-3.1-pro" && normalizedModel !== "veo-3.1-fast") return base;

  const normalizedResolution = resolution.trim().toLowerCase();
  const resolutionPercent = normalizedResolution === "4k" ? 120 : normalizedResolution === "1080p" ? 110 : 100;
  const modelPercent = normalizedModel === "veo-3.1-fast" ? 80 : 100;
  return Math.ceil((base * resolutionPercent * modelPercent) / 100_000) * 10;
}
