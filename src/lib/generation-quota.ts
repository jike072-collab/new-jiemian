import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

type ImageGenerationBillableOperation = "cloud_image_generation" | "cloud_image_edit";
type GenerationBillableOperation = ImageGenerationBillableOperation | "cloud_video_generation";
type UpscaleBillableOperation = "cloud_image_upscale" | "cloud_video_upscale";

export function isVideoGenerationPricingPending(model?: string | null) {
  const normalized = String(model || "").trim().toLowerCase();
  if (seedanceVideoQuota(normalized, 15) !== null) return false;
  return normalized.includes("seedance")
    || normalized.startsWith("sdquan-")
    || normalized === "quanneng2.0"
    || normalized === "quanneng2.0-9tu"
    || normalized === "b-quannengship2.0"
    || normalized === "video-2.0-fast-720p";
}

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
  const seedanceQuota = seedanceVideoQuota(input.model, duration);
  if (seedanceQuota !== null) return seedanceQuota;
  const base = duration * 100;
  let quota = base;
  if (duration >= 15) quota = Math.round(base * 0.8);
  else if (duration >= 12) quota = Math.round(base * 0.85);
  else if (duration >= 10) quota = Math.round(base * 0.9);
  return applyVideoModelPricing(quota, input.model, input.resolution);
}

export function estimateVideoGenerationEntitlementUnits(input: { resolution: string; model?: string | null; durationSeconds?: number }) {
  const normalizedModel = String(input.model || "").trim().toLowerCase();
  const duration = Math.max(1, Math.floor(input.durationSeconds || 15));
  if (normalizedModel === "sdquan-2" || normalizedModel === "seedance-2.0-930" || normalizedModel === "video-standard-720p") return 3;
  if (normalizedModel === "seedance2.0-9tu-manxue" || normalizedModel === "video-standard-720p-fast") return 2;
  if (normalizedModel === "seedance-fast-720p-pf" || normalizedModel === "seedance-2.0-720p-pf") return duration >= 10 ? 2 : 1;
  if (normalizedModel === "seedance2.0 720p-933-pro-gz-15s") return 3;
  if (/seedance[-_ ]*2(?:\.0)?.*(?:720|1080)\s*p/.test(normalizedModel)) {
    if (normalizedModel.includes("933") || normalizedModel.includes("1080")) return 3;
    return /\d+s/.test(normalizedModel) || duration > 10 ? 2 : 1;
  }
  if (normalizedModel === "b-quannengship2.0") return 2;
  if (normalizedModel === "quanneng2.0") return duration >= 15 ? 2 : 1;
  if (normalizedModel === "sdquan-2-miao" || normalizedModel === "doubao-seedance-2-0-260128-grid") {
    return duration >= 10 ? 2 : 1;
  }
  if (normalizedModel === "doubao-seedance-2.0-fast-260128-grid") return 3;
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

function seedanceVideoQuota(model: string | null | undefined, duration: number) {
  const normalizedModel = String(model || "").trim().toLowerCase();
  if (normalizedModel === "sdquan-2") return 1740;
  if (normalizedModel === "seedance-fast-720p-pf") return duration * 70;
  if (normalizedModel === "seedance-2.0-930") return 1350;
  if (normalizedModel === "seedance2.0-9tu-manxue") return 840;
  if (normalizedModel === "video-standard-720p") return 1560;
  if (normalizedModel === "video-standard-720p-fast") return 1200;
  if (normalizedModel === "seedance-2.0-720p-pf") return duration * 100;
  if (normalizedModel === "mg-seedance2.0 -720p mini") return duration * 60;
  if (normalizedModel === "mg-seedance2.0 -720p fast") return duration * 80;
  if (normalizedModel === "mg-seedance2.0 -720p pro") return duration * 100;
  if (normalizedModel === "mg-seedance2.0 -1080p") return duration * 100;
  if (normalizedModel === "mg-seedance2.0 -720p-gz-15s") return 800;
  if (normalizedModel === "seedance2.0 720p-fast-gz-15s") return 1200;
  if (normalizedModel === "seedance2.0 720p-pro-gz-15s") return 1400;
  if (normalizedModel === "seedance2.0 720p-933-pro-gz-15s") return 1500;
  if (normalizedModel === "quanneng2.0-9tu") return 300;
  if (normalizedModel === "video-2.0-fast-720p") return duration >= 15 ? 650 : 550;
  if (normalizedModel === "b-quannengship2.0") return duration >= 15 ? 850 : duration >= 10 ? 750 : 650;
  if (normalizedModel === "quanneng2.0") return duration >= 15 ? 900 : 800;
  if (normalizedModel === "sdquan-2-miao") return duration * 100;
  if (normalizedModel === "doubao-seedance-2.0-fast-260128-grid") return 1200;
  if (normalizedModel === "doubao-seedance-2-0-260128-grid") return 1400;
  if (/seedance[-_ ]*2(?:\.0)?.*(?:720|1080)\s*p/.test(normalizedModel)) {
    const fixed = /(?:^|[-_ ])\d+s(?:$|[-_ ])/i.test(normalizedModel);
    if (normalizedModel.includes("933")) return 1500;
    if (normalizedModel.includes("1080")) return fixed ? 1500 : duration * 100;
    if (normalizedModel.includes("mini")) return duration * 60;
    if (normalizedModel.includes("fast")) return fixed ? 1200 : duration * 80;
    if (normalizedModel.includes("pro")) return fixed ? 1400 : duration * 100;
  }
  return null;
}
