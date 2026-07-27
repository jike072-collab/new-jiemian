import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { parseBuffer } from "music-metadata";

import {
  estimateGenerationQuota,
  estimateImageGenerationEntitlementUnits,
  estimateImageGenerationTotalQuota,
  estimateVideoGenerationEntitlementUnits,
  generationBillingFingerprint,
  isVideoGenerationPricingPending,
} from "../generation-quota";
import { getMembershipService } from "./membership";

import { addJob, addLibraryItem, readLibraryMetadataForOwner, storeDataUrl, storeRemoteUrl, updateJob, updateLibraryItem } from "./library";
import { codeForUpstreamStatus, GenerationDiagnosticError } from "./error-diagnostics";
import {
  assertFileFormatAllowed,
  assertFileSizeAllowed,
} from "./media-upload-guard";
import { assertStorageAllows } from "./storage-capacity";
import { storeRemoteUrlStreamed } from "./remote-media-download";
import { getTaskBillingService } from "./quota";
import {
  clmmSeedanceVideoOptionsForModel,
  clmmSeedanceVideoMySecondsForModel,
  clmmSeedanceVideoRequestSecondsForModel,
  providerById,
  seedanceVideoOptionsForModel,
  seedanceVideoRequestSecondsForModel,
} from "./providers";
import { storeProviderReference } from "./provider-reference";
import { type JobRecord, type LibraryItem, type ProviderConfig } from "./types";

type UploadedMedia = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  mediaType?: "image" | "video" | "audio";
  durationSeconds?: number;
};

type ProviderOutput = {
  url?: string;
  base64?: string;
  jobId?: string;
  status?: string;
  progress?: number;
  statusUrl?: string;
  mimeType?: string;
};

class BillingSettlementRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingSettlementRequiredError";
  }
}

class BillingDispatchRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingDispatchRejectedError";
  }
}

const duplicateImageDispatchWaitMs = 180000;
const duplicateImageDispatchPollMs = 2000;
const imageProviderRequestTimeoutMs = 600000;
const getTokenBananaPollIntervalMs = 2800;
const getTokenBananaTaskAttempts = 3;
const getTokenBananaPeakTaskAttempts = 8;
const seedanceVideoResultDownloadOptions = { timeoutMs: 900_000, idleTimeoutMs: 300_000 };

const grokVideo10Durations = new Set([6, 8, 10, 12, 15]);
const grokVideo15Durations = new Set([6, 8, 10, 12, 15]);
const grokVideo10Ratios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
const grokVideo15Ratios = new Set(["16:9", "9:16"]);
const defaultVideoRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedString(value: unknown, fields: string[]): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedString(item, fields);
      if (found) return found;
    }
    return "";
  }
  const record = asRecord(value);
  for (const field of ["data", "task", "result", "output", "video"]) {
    const nested = record[field];
    if (nested && typeof nested === "object") {
      const found = nestedString(nested, fields);
      if (found) return found;
    }
  }
  const direct = firstString(...fields.map((field) => record[field]));
  if (direct) return direct;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = nestedString(nested, fields);
      if (found) return found;
    }
  }
  return "";
}

type OutputUrlCandidate = {
  url: string;
  field: string;
  path: string;
  index: number;
};

const outputUrlFieldPriority: Record<string, number> = {
  video_url: 120,
  image_url: 115,
  download_url: 110,
  file_url: 105,
  result_url: 100,
  output_url: 90,
  content_url: 80,
  url: 50,
};

function normalizeOutputUrlField(field: string) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function collectOutputUrlCandidates(value: unknown, path = "root", candidates: OutputUrlCandidate[] = []) {
  if (!value || typeof value !== "object") return candidates;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectOutputUrlCandidates(item, `${path}[${index}]`, candidates));
    return candidates;
  }
  for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${field}`;
    const normalizedField = normalizeOutputUrlField(field);
    if (
      typeof child === "string"
      && /^https?:\/\//i.test(child.trim())
      && outputUrlFieldPriority[normalizedField] !== undefined
    ) {
      candidates.push({
        url: child.trim(),
        field: normalizedField,
        path: childPath,
        index: candidates.length,
      });
    }
    collectOutputUrlCandidates(child, childPath, candidates);
  }
  return candidates;
}

function outputUrlCandidateScore(candidate: OutputUrlCandidate) {
  let score = outputUrlFieldPriority[candidate.field] ?? 0;
  if (/\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(candidate.url)) score += 30;
  if (/\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(candidate.url)) score += 20;
  if (/(?:^|[._])status(?:[._]|$)/i.test(candidate.path)) score -= 50;
  score -= Math.min(candidate.path.split(/[.\[\]]/).filter(Boolean).length, 12);
  return score;
}

function bestOutputUrl(payload: unknown) {
  return collectOutputUrlCandidates(payload)
    .map((candidate) => ({ candidate, score: outputUrlCandidateScore(candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.index - right.candidate.index)[0]
    ?.candidate.url || "";
}

function parseProviderOutput(payload: unknown): ProviderOutput {
  const root = asRecord(payload);
  const data = root.data;
  const metadata = asRecord(root.metadata);
  const first = asRecord((Array.isArray(data) ? data[0] : data) || root.video || root.result || root.output || payload);
  const firstMetadata = asRecord(first.metadata);
  const candidateUrl = bestOutputUrl(payload) || firstString(
    first.video_url,
    first.download_url,
    first.result_url,
    first.output_url,
    first.image_url,
    firstMetadata.video_url,
    firstMetadata.download_url,
    firstMetadata.result_url,
    firstMetadata.output_url,
    root.video_url,
    root.download_url,
    root.result_url,
    root.output_url,
    root.image_url,
    first.url,
    firstMetadata.url,
    root.url,
    metadata.url,
  );
  const url = /^(?:https?:\/\/|\/)/i.test(candidateUrl) ? candidateUrl : "";
  const base64 = firstString(
    first.b64_json,
    first.base64,
    first.image_base64,
    root.b64_json,
    root.base64,
    root.image_base64,
  );
  const progressValue = Number(root.progress ?? first.progress);
  return {
    url,
    base64,
    jobId: nestedString(payload, ["taskId", "task_id", "id", "video_id"]),
    status: nestedString(payload, ["status"]),
    ...(Number.isFinite(progressValue) ? { progress: Math.min(Math.max(progressValue, 0), 100) } : {}),
    statusUrl: nestedString(payload, ["status_url"]),
    mimeType: nestedString(payload, ["mime_type"]),
  };
}

function looksLikeOpenAiImageModel(model: string) {
  return model.trim().toLowerCase().startsWith("gpt-image");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasProviderOutput(output: ProviderOutput) {
  return Boolean(output.url || output.base64 || output.jobId || output.statusUrl || output.status);
}

function parseImageProviderOutputs(payload: unknown): ProviderOutput[] {
  const root = asRecord(payload);
  const data = Array.isArray(root.data) ? root.data : [];
  if (!data.length) {
    const fallback = parseProviderOutput(payload);
    return hasProviderOutput(fallback) ? [fallback] : [];
  }
  const outputs = data
    .map((entry) => parseProviderOutput({ ...root, data: [entry] }))
    .filter(hasProviderOutput);
  if (outputs.length) return outputs;
  const fallback = parseProviderOutput(payload);
  return hasProviderOutput(fallback) ? [fallback] : [];
}

function authHeaders(provider: ProviderConfig) {
  return { Authorization: `Bearer ${provider.apiKey}` };
}

function assertProviderReady(
  provider: ProviderConfig | null | undefined,
  expectedKind: ProviderConfig["kind"],
  modelMissingCode: "MODEL_MISSING_IMAGE" | "MODEL_MISSING_VIDEO",
) {
  if (!provider || provider.kind !== expectedKind) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_NOT_CONFIGURED" });
  }
  if (!provider.enabled) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_DISABLED", providerId: provider.id, model: provider.model });
  }
  if (!provider.apiUrl.trim()) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_ENDPOINT", providerId: provider.id, model: provider.model });
  }
  try {
    const url = new URL(provider.apiUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch (error) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_INVALID_ENDPOINT",
      providerId: provider.id,
      model: provider.model,
      cause: error,
    });
  }
  if (!provider.apiKey.trim()) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY", providerId: provider.id, model: provider.model });
  }
  if (!provider.model.trim()) {
    throw new GenerationDiagnosticError({ code: modelMissingCode, providerId: provider.id });
  }
  return provider;
}

function ratioToSize(ratio: string) {
  if (ratio === "16:9") return "1536x864";
  if (ratio === "9:16") return "864x1536";
  if (ratio === "4:3") return "1344x1024";
  if (ratio === "3:4") return "1024x1344";
  return "1024x1024";
}

function ratioTo720pSize(ratio: string) {
  if (ratio === "16:9") return "1280x720";
  if (ratio === "9:16") return "720x1280";
  return "720x720";
}

function imageQualityLabel(quality: string) {
  return quality === "4k" || quality === "2k" ? "high" : "standard";
}

function imageUpscaleValue(quality: string) {
  return quality === "4k" ? "4k" : quality === "2k" ? "2k" : "";
}

function isImg2ImageProvider(provider: ProviderConfig) {
  return provider.model === "image4k";
}

function isGetTokenBananaProvider(provider: ProviderConfig) {
  return provider.endpointType === "gettoken-banana";
}

function isGetTokenVeoProvider(provider: ProviderConfig) {
  return provider.endpointType === "gettoken-veo";
}

function isRedbirdSeedanceProvider(provider: ProviderConfig) {
  return Boolean(seedanceVideoOptionsForModel(provider.model));
}

function isClmmSeedanceProvider(provider: ProviderConfig) {
  return provider.id === "video-seedance-new" || provider.id.startsWith("video-seedance-new::model::");
}

function isSeedanceTaskProvider(provider: ProviderConfig) {
  return isRedbirdSeedanceProvider(provider) || isClmmSeedanceProvider(provider);
}

function mediaFiles(input: { files: UploadedMedia[] }, mediaType: "image" | "video" | "audio") {
  return input.files.filter((file) => (file.mediaType || "image") === mediaType);
}

const clmmReferenceTokenPattern = /@(Image|Video|Audio)(\d+)/g;

function resolveClmmSeedanceReferences(provider: ProviderConfig, input: {
  prompt: string;
  files: UploadedMedia[];
}) {
  const matches = [...input.prompt.matchAll(clmmReferenceTokenPattern)];
  if (!matches.length) return input;

  const mediaTypes = {
    Image: "image",
    Video: "video",
    Audio: "audio",
  } as const;
  const filesByType = {
    image: mediaFiles(input, "image"),
    video: mediaFiles(input, "video"),
    audio: mediaFiles(input, "audio"),
  } as const;
  const selectedIndexes = {
    image: new Set<number>(),
    video: new Set<number>(),
    audio: new Set<number>(),
  };

  for (const match of matches) {
    const mediaType = mediaTypes[match[1] as keyof typeof mediaTypes];
    const index = Number(match[2]) - 1;
    if (!Number.isInteger(index) || index < 0 || !filesByType[mediaType][index]) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        providerId: provider.id,
        model: provider.model,
        publicMessage: `提示词中的 @${match[1]}${match[2]} 没有对应的参考素材。`,
      });
    }
    selectedIndexes[mediaType].add(index);
  }

  const compactIndexes = {
    image: new Map<number, number>(),
    video: new Map<number, number>(),
    audio: new Map<number, number>(),
  };
  const selectedFiles = (Object.keys(filesByType) as Array<keyof typeof filesByType>).flatMap((mediaType) => {
    const indexes = selectedIndexes[mediaType].size
      ? [...selectedIndexes[mediaType]].sort((left, right) => left - right)
      : filesByType[mediaType].map((_, index) => index);
    indexes.forEach((index, compactIndex) => compactIndexes[mediaType].set(index, compactIndex));
    return indexes.map((index) => filesByType[mediaType][index]);
  });
  const prompt = input.prompt.replace(clmmReferenceTokenPattern, (token, label: keyof typeof mediaTypes, rawIndex: string) => {
    const mediaType = mediaTypes[label];
    const compactIndex = compactIndexes[mediaType].get(Number(rawIndex) - 1);
    return compactIndex === undefined ? token : `@${label}${compactIndex + 1}`;
  });

  return { prompt, files: selectedFiles };
}

function redbirdVideoPayload(provider: ProviderConfig, input: {
  prompt: string;
  ratio: string;
  duration: number;
  files?: UploadedMedia[];
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
}) {
  return {
    model: provider.model,
    prompt: input.prompt,
    aspect_ratio: input.ratio,
    resolution: "720p",
    seconds: String(input.duration),
    ...(input.imageUrls?.length
      ? { images: input.imageUrls }
      : input.files?.length ? { images: input.files.map((file) => `data:${file.mimeType};base64,${file.bytes.toString("base64")}`) } : {}),
    ...(input.videoUrls?.length ? { videos: input.videoUrls } : {}),
    ...(input.audioUrls?.length ? { audios: input.audioUrls } : {}),
  };
}

function clmmSeedanceVideoPayload(provider: ProviderConfig, input: {
  prompt: string;
  ratio: string;
  duration: number;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
}) {
  const mySeconds = clmmSeedanceVideoMySecondsForModel(provider.model);
  return {
    model: provider.model,
    prompt: input.prompt,
    aspect_ratio: input.ratio,
    resolution: "720p",
    size: ratioTo720pSize(input.ratio),
    seconds: String(clmmSeedanceVideoRequestSecondsForModel(provider.model, input.duration)),
    ...(mySeconds ? { mySeconds: String(mySeconds) } : {}),
    ...(input.imageUrls?.length ? { reference_image_urls: input.imageUrls } : {}),
    ...(input.videoUrls?.length ? { reference_videos: input.videoUrls } : {}),
    ...(input.audioUrls?.length ? { reference_audios: input.audioUrls } : {}),
  };
}

async function prepareRedbirdReferenceUrls(files: UploadedMedia[]) {
  return Promise.all(files.map(async (file) => (await storeProviderReference(file)).url));
}

const getTokenVeoQueryWarmupMs = 30 * 60 * 1000;

function validIsoTimestamp(value: string | null | undefined) {
  if (!value?.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= 24 * 60 * 60 * 1000;
}

function shouldKeepGetTokenVeoJobPending(status: number, createdAt: string, now = Date.now()) {
  if (status !== 400) return false;
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) && now - createdAtMs < getTokenVeoQueryWarmupMs;
}

function getTokenBananaBaseUrl(provider: ProviderConfig) {
  return provider.apiUrl.replace(/\/+$/, "");
}

function getTokenBananaModelPath(provider: ProviderConfig) {
  if (provider.model === "banana2") return "banana2";
  if (provider.model === "banana-pro") return "banana_pro";
  throw new GenerationDiagnosticError({
    code: "MODEL_MISSING_IMAGE",
    providerId: provider.id,
    model: provider.model,
    publicMessage: "当前 Banana 图片模型配置无效。",
  });
}

function getTokenBananaSubmitEndpoint(provider: ProviderConfig, useEdits: boolean) {
  const mode = useEdits ? "image-to-image" : "text-to-image";
  return `${getTokenBananaBaseUrl(provider)}/${getTokenBananaModelPath(provider)}/${mode}`;
}

function getTokenBananaQueryEndpoint(provider: ProviderConfig) {
  return `${getTokenBananaBaseUrl(provider)}/query`;
}

function getTokenVeoModelPath(provider: ProviderConfig) {
  if (provider.model === "veo-3.1-pro") return "veo3.1-pro";
  if (provider.model === "veo-3.1-fast") return "veo3.1-fast";
  throw new GenerationDiagnosticError({
    code: "MODEL_MISSING_VIDEO",
    providerId: provider.id,
    model: provider.model,
    publicMessage: "当前 Veo 视频模型配置无效。",
  });
}

function getTokenVeoSubmitEndpoint(provider: ProviderConfig, mode: "text-to-video" | "image-to-video") {
  return `${getTokenBananaBaseUrl(provider)}/${getTokenVeoModelPath(provider)}/${mode}`;
}

function getTokenVeoQueryEndpoint(provider: ProviderConfig) {
  return `${getTokenBananaBaseUrl(provider)}/query`;
}

async function uploadGetTokenVeoReferenceImage(provider: ProviderConfig, file: UploadedMedia) {
  if (file.bytes.byteLength > 10 * 1024 * 1024) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "Veo 参考图不能超过 10MB。",
    });
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
  const response = await fetchProviderWithNetworkRetry(`${getTokenBananaBaseUrl(provider)}/media/upload/binary`, {
    method: "POST",
    headers: authHeaders(provider),
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const payload = await readProviderJson(response, provider);
  const data = asRecord(asRecord(payload).data);
  const url = firstString(data.download_url, data.url, asRecord(payload).download_url, asRecord(payload).url);
  if (!url) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "Veo 参考图上传未返回可用 URL。",
    });
  }
  return url;
}

async function callGetTokenVeoProvider(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  referenceMode?: "single" | "first-last";
  prompt: string;
  ratio: string;
  duration: number;
  resolution: string;
  files: UploadedMedia[];
}) {
  if (input.prompt.trim().length < 5 || input.prompt.length > 8000) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "Veo 视频提示词长度需要在 5 到 8000 个字符之间。",
    });
  }
  const imageUrls = input.mode === "image-to-video"
    ? await Promise.all(input.files.map((file) => uploadGetTokenVeoReferenceImage(provider, file)))
    : [];
  const isFirstLast = input.referenceMode === "first-last";
  const submitEndpoint = isFirstLast
    ? `${getTokenBananaBaseUrl(provider)}/${getTokenVeoModelPath(provider)}/start-end-to-video`
    : getTokenVeoSubmitEndpoint(provider, input.mode);
  const response = await fetchProviderWithNetworkRetry(submitEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(provider),
    },
    body: JSON.stringify({
      prompt: input.prompt,
      aspectRatio: input.ratio,
      duration: String(input.duration),
      resolution: input.resolution,
      clientTaskId: randomUUID(),
      ...(isFirstLast
        ? { firstFrameUrl: imageUrls[0], lastFrameUrl: imageUrls[1] }
        : imageUrls.length ? { imageUrls } : {}),
    }),
    signal: AbortSignal.timeout(180000),
  });
  const payload = await readProviderJson(response, provider);
  const output = parseProviderOutput(payload);
  const taskId = output.jobId;
  if (!taskId) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "Veo 视频任务没有返回任务编号。",
    });
  }
  return {
    ...output,
    jobId: taskId,
    statusUrl: getTokenVeoQueryEndpoint(provider),
  };
}

function getTokenTaskStatus(payload: unknown) {
  return firstString(asRecord(payload).status).toUpperCase();
}

function getTokenTaskError(payload: unknown) {
  const root = asRecord(payload);
  const failedReason = asRecord(root.failedReason);
  return firstString(root.errorMessage, failedReason.message, root.errorCode, failedReason.code)
    || "GetToken Banana 任务执行失败。";
}

function getTokenVeoVideoResultUrl(payload: unknown) {
  const results = Array.isArray(asRecord(payload).results) ? asRecord(payload).results as unknown[] : [];
  for (const item of results) {
    const result = asRecord(item);
    const url = firstString(result.url);
    const outputType = firstString(result.outputType, result.output_type).trim().toLowerCase().replace(/^\./, "");
    if (url && (["mp4", "webm", "mov"].includes(outputType) || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url))) {
      return url;
    }
  }
  return "";
}

function isGetTokenTaskSuccess(status: string) {
  return ["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(status);
}

function isGetTokenTaskFailure(status: string) {
  return ["FAILED", "FAILURE", "FAIL", "ERROR", "TIMEOUT", "TIMED_OUT", "EXPIRED", "CANCELED", "CANCELLED"].includes(status);
}

async function callGetTokenBananaTask(input: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  clientTaskId: string;
  onTaskAccepted?: (taskId: string) => Promise<void>;
}) {
  if (!["1k", "2k", "4k"].includes(input.quality)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: input.provider.id,
      model: input.provider.model,
      publicMessage: "Banana 图片模型只支持 1K、2K 和 4K。",
    });
  }
  const useEdits = input.files.length > 0;
  const response = await fetchProviderWithNetworkRetry(getTokenBananaSubmitEndpoint(input.provider, useEdits), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(input.provider),
    },
    body: JSON.stringify({
      prompt: input.prompt,
      aspectRatio: input.ratio,
      resolution: input.quality,
      clientTaskId: input.clientTaskId,
      ...(useEdits ? {
        imageUrls: input.files.map((file) => `data:${file.mimeType};base64,${file.bytes.toString("base64")}`),
      } : {}),
    }),
    signal: AbortSignal.timeout(imageProviderRequestTimeoutMs),
  });
  let payload = await readProviderJson(response, input.provider);
  const taskId = firstString(asRecord(payload).taskId, asRecord(payload).task_id);
  if (!taskId) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: input.provider.id,
      model: input.provider.model,
      publicMessage: "GetToken Banana 没有返回任务编号。",
    });
  }
  await input.onTaskAccepted?.(taskId);

  const deadline = Date.now() + imageProviderRequestTimeoutMs;
  while (Date.now() < deadline) {
    const status = getTokenTaskStatus(payload);
    const output = parseProviderOutput(payload);
    if ((isGetTokenTaskSuccess(status) || (!status && output.url)) && output.url) {
      return { ...output, jobId: taskId, status: status || "SUCCESS" };
    }
    if (isGetTokenTaskFailure(status)) {
      throw new GenerationDiagnosticError({
        code: "TASK_CREATE_FAILED",
        providerId: input.provider.id,
        model: input.provider.model,
        message: getTokenTaskError(payload),
        safeDetails: { upstreamTaskId: taskId },
      });
    }
    await wait(getTokenBananaPollIntervalMs);
    try {
      const queryResponse = await fetchProviderWithNetworkRetry(getTokenBananaQueryEndpoint(input.provider), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(input.provider),
        },
        body: JSON.stringify({ taskId }),
        signal: AbortSignal.timeout(imageProviderRequestTimeoutMs),
      });
      payload = await readProviderJson(queryResponse, input.provider);
    } catch (error) {
      if (!isRetryableGetTokenBananaError(error) && !isProviderNetworkFetchError(error)) throw error;
    }
  }
  throw new GenerationDiagnosticError({
    code: "PROVIDER_TIMEOUT",
    providerId: input.provider.id,
    model: input.provider.model,
    publicMessage: "GetToken Banana 生成超时，请稍后在作品库查看。",
    safeDetails: { upstreamTaskId: taskId },
  });
}

function isRetryableGetTokenBananaError(error: unknown) {
  if (isProviderNetworkFetchError(error)) return true;
  if (!(error instanceof GenerationDiagnosticError)) return false;
  if (error.upstreamStatus === 429 || (error.upstreamStatus !== undefined && error.upstreamStatus >= 500)) {
    return true;
  }
  return error.code === "TASK_CREATE_FAILED"
    && /all channels failed|no available account|status 5\d\d|temporarily unavailable|\bunavailable\b/i.test(error.message);
}

function isGetTokenBananaPeakCapacityError(error: unknown) {
  return error instanceof GenerationDiagnosticError
    && /no available account|status 599[^]*\bunavailable\b|temporarily unavailable/i.test(error.message);
}

async function callGetTokenBananaTaskWithRetry(
  input: Omit<Parameters<typeof callGetTokenBananaTask>[0], "clientTaskId">,
) {
  let clientTaskId = randomUUID();
  let lastError: unknown;
  for (let attempt = 1; attempt <= getTokenBananaPeakTaskAttempts; attempt += 1) {
    let upstreamTaskId = "";
    try {
      return await callGetTokenBananaTask({
        ...input,
        clientTaskId,
        onTaskAccepted: async (taskId) => {
          upstreamTaskId = taskId;
          await input.onTaskAccepted?.(taskId);
        },
      });
    } catch (error) {
      lastError = error;
      const acceptedTerminalFailure = Boolean(upstreamTaskId)
        && error instanceof GenerationDiagnosticError
        && error.code === "TASK_CREATE_FAILED";
      const peakCapacityError = isGetTokenBananaPeakCapacityError(error);
      const maximumAttempts = acceptedTerminalFailure
        ? getTokenBananaTaskAttempts
        : peakCapacityError ? getTokenBananaPeakTaskAttempts : getTokenBananaTaskAttempts;
      if (attempt >= maximumAttempts || (!acceptedTerminalFailure && !isRetryableGetTokenBananaError(error))) throw error;
      if (acceptedTerminalFailure) clientTaskId = randomUUID();
      const delayMs = peakCapacityError
        ? Math.min(1500 * (2 ** (attempt - 1)), 15000) + Math.floor(Math.random() * 1000)
        : (attempt * 750) + Math.floor(Math.random() * 250);
      await wait(delayMs);
    }
  }
  throw lastError;
}

async function callGetTokenBananaProvider(input: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  count: number;
  maxCount?: number;
  onTaskAccepted?: (taskId: string) => Promise<void>;
}) {
  const outputCount = Math.min(Math.max(Math.round(input.count || 1), 1), input.maxCount || 4);
  return Promise.all(Array.from({ length: outputCount }, () => callGetTokenBananaTaskWithRetry(input)));
}

function img2ImageSize(ratio: string, quality: string) {
  const multiplier = quality === "4k" ? 4 : quality === "2k" ? 2 : 1;
  const [width, height] = ratioToSize(ratio).split("x").map((value) => Number(value));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return ratioToSize(ratio);
  return `${width * multiplier}x${height * multiplier}`;
}

function normalizeStatus(value: string) {
  const status = value.toLowerCase();
  if (["done", "completed", "succeeded", "success"].includes(status)) return "done";
  if (["failed", "error", "cancelled", "canceled", "expired"].includes(status)) return "failed";
  if (["generating", "processing", "running", "in_progress"].includes(status)) return "generating";
  return "queued";
}

function canUseSeedanceStatusFallback(provider: ProviderConfig, statusUrl: string) {
  if (!isSeedanceTaskProvider(provider)) return false;
  try {
    const endpoint = new URL(statusUrl);
    const configured = new URL(provider.apiUrl);
    return ["http:", "https:"].includes(endpoint.protocol)
      && endpoint.protocol === configured.protocol
      && endpoint.hostname === configured.hostname;
  } catch {
    return false;
  }
}

function fetchSeedanceStatusViaIpv4(provider: ProviderConfig, rawUrl: string) {
  const url = new URL(rawUrl);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const request = requestImpl({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      family: 4,
      servername: url.hostname,
      headers: authHeaders(provider),
      timeout: 60_000,
    }, (incoming) => {
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status: incoming.statusCode || 0,
        statusText: incoming.statusMessage,
        headers: incoming.headers as HeadersInit,
      }));
    });
    request.on("timeout", () => request.destroy(new Error("Seedance status request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchVideoJobStatus(provider: ProviderConfig, statusUrl: string, getTokenVeo: boolean, jobId: string) {
  try {
    return await fetch(statusUrl, {
      method: getTokenVeo ? "POST" : "GET",
      headers: {
        ...(getTokenVeo ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(provider),
      },
      ...(getTokenVeo ? { body: JSON.stringify({ taskId: jobId }) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (!getTokenVeo && canUseSeedanceStatusFallback(provider, statusUrl)) {
      return fetchSeedanceStatusViaIpv4(provider, statusUrl);
    }
    throw error;
  }
}

function videoJobFailureMessage(payload: unknown) {
  const reason = nestedString(payload, ["error", "error_message", "message", "detail", "fail_reason", "failed_reason", "reason"]);
  if (/moderation|content[_\s-]*policy|safety/i.test(reason)) return "视频内容未通过上游审核。";
  if (/timeout|timed[_\s-]*out/i.test(reason)) return "视频生成任务超时。";
  return "视频生成任务失败。";
}

function canAccessVideoJob(jobOwner: string | null, localUserId: string | null, allowedOwnerIds: readonly string[] = []) {
  if (!localUserId || !jobOwner) return true;
  return jobOwner === localUserId || allowedOwnerIds.includes(jobOwner);
}

function deriveStatusUrl(apiUrl: string, jobId: string) {
  if (!jobId) return "";
  try {
    const parsed = new URL(apiUrl);
    const encodedJobId = encodeURIComponent(jobId);
    if (/\/video\/generations\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/video\/generations\/?$/i, `/video/generations/${encodedJobId}`);
    } else if (/\/videos\/generations\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/videos\/generations\/?$/i, `/videos/${encodedJobId}`);
    } else if (/\/videos\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, `/videos/${encodedJobId}`);
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isGrokVideoProvider(provider: ProviderConfig) {
  return provider.endpointType === "grok-videos" || provider.model.startsWith("grok-video-");
}

function grokVideosEndpoint(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/v1/videos";
    } else if (!/\/videos\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/videos";
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return apiUrl;
  }
}

function grokVideoGenerationsEndpoint(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    if (isLocalOpenAiCompatibleEndpoint(apiUrl)) {
      if (parsed.pathname === "/" || parsed.pathname === "") {
        parsed.pathname = "/v1/video/generations";
      } else if (/\/videos\/generations\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/videos\/generations\/?$/i, "/video/generations");
      } else if (/\/video\/generations\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/video\/generations\/?$/i, "/video/generations");
      } else if (/\/videos\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, "/video/generations");
      } else if (/\/video\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/video\/?$/i, "/video/generations");
      } else {
        parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/video/generations";
      }
      parsed.search = "";
      return parsed.toString();
    }
    const direct = new URL(grokVideosEndpoint(apiUrl));
    if (/\/videos\/generations\/?$/i.test(direct.pathname)) {
      direct.search = "";
      return direct.toString();
    }
    direct.pathname = direct.pathname.replace(/\/videos\/?$/i, "/videos/generations");
    direct.search = "";
    return direct.toString();
  } catch {
    return apiUrl;
  }
}

function grokStatusUrl(apiUrl: string, jobId: string) {
  if (!jobId) return "";
  try {
    const encodedJobId = encodeURIComponent(jobId);
    if (isLocalOpenAiCompatibleEndpoint(apiUrl)) {
      const parsed = new URL(grokVideoGenerationsEndpoint(apiUrl));
      parsed.pathname = parsed.pathname.replace(/\/video\/generations\/?$/i, `/video/generations/${encodedJobId}`);
      parsed.search = "";
      return parsed.toString();
    }
    const parsed = new URL(grokVideosEndpoint(apiUrl));
    parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, `/videos/${encodedJobId}`);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function grokOpenAiVideoStatusUrl(apiUrl: string, jobId: string) {
  if (!jobId) return "";
  try {
    const parsed = new URL(grokVideosEndpoint(apiUrl));
    parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, `/videos/${encodeURIComponent(jobId)}`);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function absolutizeProviderUrl(provider: ProviderConfig, value: string) {
  if (!value.startsWith("/")) return value;
  try {
    const parsed = new URL(provider.apiUrl);
    return `${parsed.origin}${value}`;
  } catch {
    return value;
  }
}

function grokVideoRatioOptions(provider: ProviderConfig) {
  return provider.model === "grok-video-1.5" ? grokVideo15Ratios : grokVideo10Ratios;
}

function validateGrokVideoInput(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  ratio: string;
  duration: number;
  resolution?: string;
  files: UploadedMedia[];
}) {
  const allowedDurations = provider.model === "grok-video-1.5" ? grokVideo15Durations : grokVideo10Durations;
  if (!allowedDurations.has(input.duration)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: provider.model === "grok-video-1.5"
        ? "当前 Grok 视频 1.5 只支持 6、8、10、12、15 秒。"
        : "当前 Grok 视频模型只支持 6、8、10、12、15 秒。",
    });
  }
  if (!grokVideoRatioOptions(provider).has(input.ratio)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: provider.model === "grok-video-1.5"
        ? "grok-video-1.5 只支持 16:9 和 9:16。"
        : "grok-video-1.0 不支持当前比例。",
    });
  }
  if (input.resolution && input.resolution !== "720p") {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "当前 Grok 视频模型固定使用 720P。",
    });
  }
  if (provider.model === "grok-video-1.5" && input.files.length !== 1) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "grok-video-1.5 必须且只能上传 1 张参考图。",
    });
  }
  if (provider.model === "grok-video-1.0" && input.files.length > 7) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: "grok-video-1.0 最多支持 7 张参考图。",
    });
  }
}

function videoOptionsForProvider(provider: ProviderConfig) {
  return seedanceVideoOptionsForModel(provider.model)
    || clmmSeedanceVideoOptionsForModel(provider.model)
    || provider.videoOptions;
}

function validateVideoInput(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  referenceMode?: "single" | "first-last";
  ratio: string;
  duration: number;
  resolution: string;
  files: UploadedMedia[];
}) {
  const referenceImages = mediaFiles(input, "image");
  const referenceVideos = mediaFiles(input, "video");
  const referenceAudios = mediaFiles(input, "audio");
  if (isGrokVideoProvider(provider)) {
    if (referenceVideos.length || referenceAudios.length) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        providerId: provider.id,
        model: provider.model,
        publicMessage: "当前 Grok 视频模型只支持参考图。",
      });
    }
    validateGrokVideoInput(provider, { ...input, files: referenceImages });
    return;
  }
  const options = videoOptionsForProvider(provider);
  const requiredReferenceMedia = options?.requiredReferenceMedia || [];
  for (const [mediaType, label, count] of [
    ["image", "参考图", referenceImages.length],
    ["video", "参考视频", referenceVideos.length],
    ["audio", "参考音频", referenceAudios.length],
  ] as const) {
    if (requiredReferenceMedia.includes(mediaType) && !count) {
      throw new GenerationDiagnosticError({
        code: "INPUT_MISSING_IMAGE",
        providerId: provider.id,
        model: provider.model,
        publicMessage: `当前模型需要上传${label}。`,
      });
    }
  }
  const allowedDurations = options?.durations?.length ? new Set(options.durations) : new Set([5, 8, 10, 15]);
  const allowedRatios = options?.ratios?.length ? new Set(options.ratios) : defaultVideoRatios;
  const allowedResolutions = options?.resolutions?.length
    ? new Set(options.resolutions)
    : new Set([options?.resolution || "720p"]);
  if (!allowedDurations.has(input.duration)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: `当前视频模型不支持 ${input.duration} 秒。`,
    });
  }
  if (!allowedRatios.has(input.ratio)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: `当前视频模型不支持 ${input.ratio} 比例。`,
    });
  }
  if (!allowedResolutions.has(input.resolution)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: `当前视频模型不支持 ${input.resolution} 清晰度。`,
    });
  }
  if (input.referenceMode === "first-last") {
    if (provider.model !== "veo-3.1-pro" || input.mode !== "image-to-video" || referenceImages.length !== 2 || referenceVideos.length || referenceAudios.length) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        providerId: provider.id,
        model: provider.model,
        publicMessage: "Veo 3.1 Pro 首尾帧视频必须上传首帧图和尾帧图。",
      });
    }
  }
  if (input.mode === "image-to-video") {
    const maxReferenceImages = input.referenceMode === "first-last"
      ? 2
      : isGetTokenVeoProvider(provider) ? 1 : options?.maxReferenceImages ?? 1;
    if (referenceImages.length > maxReferenceImages) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        providerId: provider.id,
        model: provider.model,
        publicMessage: `当前视频模型最多支持 ${maxReferenceImages} 张参考图。`,
      });
    }
  }
  const maxReferenceVideos = options?.maxReferenceVideos ?? 0;
  const maxReferenceAudios = options?.maxReferenceAudios ?? 0;
  if (referenceVideos.length > maxReferenceVideos) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: maxReferenceVideos ? `当前视频模型最多支持 ${maxReferenceVideos} 个参考视频。` : "当前视频模型不支持参考视频。",
    });
  }
  if (referenceAudios.length > maxReferenceAudios) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
      publicMessage: maxReferenceAudios ? `当前视频模型最多支持 ${maxReferenceAudios} 个参考音频。` : "当前视频模型不支持参考音频。",
    });
  }
  const maxReferenceDurationSeconds = options?.maxReferenceDurationSeconds ?? 15;
  for (const [label, files] of [["视频", referenceVideos], ["音频", referenceAudios]] as const) {
    const totalDuration = files.reduce((total, file) => total + (file.durationSeconds || 0), 0);
    if (totalDuration > maxReferenceDurationSeconds + 0.05) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        providerId: provider.id,
        model: provider.model,
        publicMessage: `参考${label}总时长不能超过 ${maxReferenceDurationSeconds} 秒。`,
      });
    }
  }
}

function grokReferenceImageEndpoint(apiUrl: string) {
  try {
    const parsed = new URL(grokVideosEndpoint(apiUrl));
    parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, "/video-reference-images");
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "https://api.manxiaobai.online/v1/video-reference-images";
  }
}

function isLocalOpenAiCompatibleEndpoint(apiUrl: string) {
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

async function uploadGrokReferenceImage(provider: ProviderConfig, file: UploadedMedia) {
  const response = await fetch(grokReferenceImageEndpoint(provider.apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(provider),
    },
    body: JSON.stringify({
      image: `data:${file.mimeType};base64,${file.bytes.toString("base64")}`,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await readProviderJson(response, provider);
  const url = firstString(asRecord(payload).url);
  if (!url) throw new Error("Grok 参考图上传未返回可用 URL。");
  return url;
}

async function callOpenAiCompatibleGrokVideoProvider(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  prompt: string;
  ratio: string;
  duration: number;
  files: UploadedMedia[];
}) {
  const payload: Record<string, string | number> = {
    model: provider.model,
    prompt: input.prompt,
    seconds: String(input.duration),
    aspect_ratio: input.ratio,
    resolution: "720p",
    response_format: "url",
  };
  if (input.files.length) {
    const [file] = input.files;
    payload.image = `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchProviderWithNetworkRetry(grokVideosEndpoint(provider.apiUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(provider),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180000),
      });
      const output = parseProviderOutput(await readProviderJson(response, provider));
      return {
        ...output,
        statusUrl: output.statusUrl || grokOpenAiVideoStatusUrl(provider.apiUrl, output.jobId || ""),
      };
    } catch (error) {
      lastError = error;
      if (attempt >= 3 || !isTemporaryProviderSaturation(error)) throw error;
      await wait(750 * attempt);
    }
  }
  throw lastError;
}

async function callGrokVideoProvider(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  prompt: string;
  ratio: string;
  duration: number;
  files: UploadedMedia[];
}) {
  validateGrokVideoInput(provider, input);
  if (isLocalOpenAiCompatibleEndpoint(provider.apiUrl)) {
    return callOpenAiCompatibleGrokVideoProvider(provider, input);
  }

  const form = new FormData();
  form.append("model", provider.model);
  form.append("prompt", input.prompt);
  form.append("seconds", String(input.duration));
  form.append("aspect_ratio", input.ratio);
  form.append("resolution", "720p");

  for (const file of input.files) {
    form.append("input_reference[image_url]", await uploadGrokReferenceImage(provider, file));
  }

  const response = await fetch(grokVideosEndpoint(provider.apiUrl), {
    method: "POST",
    headers: authHeaders(provider),
    body: form,
    signal: AbortSignal.timeout(180000),
  });
  return parseProviderOutput(await readProviderJson(response, provider));
}

async function outputToLibraryFromAuthenticatedUrl(
  provider: ProviderConfig,
  url: string,
  prefix: string,
  timeoutOptions?: Pick<Parameters<typeof storeRemoteUrlStreamed>[1], "timeoutMs" | "idleTimeoutMs">,
) {
  return storeRemoteUrlStreamed(url, {
    prefix,
    fallbackMime: "video/mp4",
    headers: authHeaders(provider),
    ...timeoutOptions,
  });
}

const providerJsonDefaultLimitBytes = 16 * 1024 * 1024;
const providerJsonErrorLimitBytes = 1 * 1024 * 1024;
const providerJsonHardLimitBytes = 64 * 1024 * 1024;

function providerPayloadCode(payload: unknown) {
  const record = asRecord(payload);
  const directCode = firstString(asRecord(record.error).code, record.code, asRecord(record.data).code).toLowerCase();
  if (directCode !== "fail_to_fetch_task") return directCode;
  const wrappedMessage = firstString(asRecord(record.error).message, record.message, asRecord(record.data).message);
  if (!wrappedMessage.startsWith("{")) return directCode;
  try {
    const nested = JSON.parse(wrappedMessage);
    return firstString(asRecord(nested).code, asRecord(asRecord(nested).error).code, asRecord(asRecord(nested).data).code).toLowerCase() || directCode;
  } catch {
    return directCode;
  }
}

function providerCodeForResponse(status: number, payload: unknown) {
  const upstreamCode = providerPayloadCode(payload);
  if (upstreamCode === "upstream_load_saturated") return "PROVIDER_RATE_LIMITED" as const;
  return codeForUpstreamStatus(status);
}

function isTemporaryProviderSaturation(error: unknown) {
  return error instanceof GenerationDiagnosticError
    && error.code === "PROVIDER_RATE_LIMITED"
    && error.safeDetails.upstreamCode === "upstream_load_saturated";
}

async function readBoundedText(response: Response, limitBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  let totalBytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        throw new Error("Provider JSON response exceeded the safe size limit.");
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isProviderNetworkFetchError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  const cause = error.cause instanceof Error ? error.cause : null;
  const message = `${error.message} ${cause?.message || ""} ${String((cause as { code?: unknown } | null)?.code || "")}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|socket|network/i.test(message);
}

async function fetchProviderWithNetworkRetry(input: string | URL | Request, init: RequestInit, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isProviderNetworkFetchError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function imageEndpoint(provider: ProviderConfig, useEdits: boolean) {
  const target = useEdits ? "edits" : "generations";
  if (/\/images\/(?:edits|generations)\/?$/i.test(provider.apiUrl)) {
    return provider.apiUrl.replace(/\/images\/(?:edits|generations)\/?$/i, `/images/${target}`);
  }
  const configuredForTarget = useEdits
    ? provider.endpointType === "images-edits"
    : provider.endpointType === "images-generations";
  if (configuredForTarget) return provider.apiUrl;
  throw new Error(`当前图片接口地址无法自动切换为 images/${target}。请在供应商后台填写标准 OpenAI-compatible 图片接口地址。`);
}

async function readProviderJson(response: Response, provider?: ProviderConfig) {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength ? Number(contentLength) : NaN;
  const limitBytes = response.ok ? providerJsonDefaultLimitBytes : providerJsonErrorLimitBytes;
  if (Number.isFinite(declaredLength) && declaredLength > providerJsonHardLimitBytes) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: { upstreamStatus: response.status, contentLength: "exceeded-hard-limit" },
    });
  }
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: {
        upstreamStatus: response.status,
        contentType: response.headers.get("content-type") || "",
        responseLimitBytes: limitBytes,
        contentLength: "exceeded-limit",
      },
    });
  }
  let text = "";
  try {
    text = await readBoundedText(response, limitBytes);
  } catch (error) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_BAD_RESPONSE",
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: {
        upstreamStatus: response.status,
        contentType: response.headers.get("content-type") || "",
        responseLimitBytes: limitBytes,
      },
      cause: error,
    });
  }
  if (!response.ok) {
    if (!text.trim()) {
      throw new GenerationDiagnosticError({
        code: codeForUpstreamStatus(response.status),
        providerId: provider?.id,
        model: provider?.model,
        upstreamStatus: response.status,
        safeDetails: { upstreamStatus: response.status },
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
    const record = asRecord(payload);
    const upstreamCode = providerPayloadCode(payload);
    const message = firstString(asRecord(record.error).message, record.message)
      || `供应商请求失败：HTTP ${response.status}`;
    throw new GenerationDiagnosticError({
      code: providerCodeForResponse(response.status, payload),
      message,
      publicMessage: upstreamCode === "upstream_load_saturated" ? "当前视频通道繁忙，已自动重试，请稍后再试。" : undefined,
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: { upstreamStatus: response.status, ...(upstreamCode ? { upstreamCode } : {}) },
    });
  }
  if (!text.trim()) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_EMPTY_RESPONSE",
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: { upstreamStatus: response.status },
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_NON_JSON_RESPONSE",
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: {
        upstreamStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
      cause: error,
    });
  }
  return payload;
}

type ProviderOutputStoragePlan =
  | { mode: "data-url"; dataUrl: string }
  | { mode: "remote-url"; url: string; fallbackMime: string };

function unsupportedVideoBase64Error(output: ProviderOutput, type: "image" | "video") {
  return new GenerationDiagnosticError({
    code: "PROVIDER_BAD_RESPONSE",
    message: "供应商返回了不受支持的视频 Base64 结果。",
    safeDetails: {
      outputType: type,
      responseFormat: output.base64 ? "video-base64" : "video-data-url",
      mimeType: output.mimeType || "video/mp4",
    },
  });
}

function planProviderOutputStorage(output: ProviderOutput, type: "image" | "video"): ProviderOutputStoragePlan {
  const fallbackMime = output.mimeType || (type === "image" ? "image/png" : "video/mp4");
  if (type === "video") {
    if (output.url) {
      if (output.url.startsWith("data:")) throw unsupportedVideoBase64Error(output, type);
      return {
        mode: "remote-url",
        url: output.url,
        fallbackMime,
      };
    }
    if (output.base64) throw unsupportedVideoBase64Error(output, type);
  }
  if (output.base64) {
    return {
      mode: "data-url",
      dataUrl: /^data:/i.test(output.base64)
        ? output.base64
        : `data:${fallbackMime};base64,${output.base64}`,
    };
  }
  if (!output.url) throw new Error("供应商没有返回可识别的生成结果。");
  if (output.url.startsWith("data:")) {
    return {
      mode: "data-url",
      dataUrl: output.url,
    };
  }
  return {
    mode: "remote-url",
    url: output.url,
    fallbackMime,
  };
}

async function callImageProvider({
  provider,
  prompt,
  ratio,
  quality,
  files,
  count,
  maxCount,
  onTaskAccepted,
}: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  count: number;
  maxCount?: number;
  onTaskAccepted?: (taskId: string) => Promise<void>;
}) {
  try {
    return await callImageProviderOnce({ provider, prompt, ratio, quality, files, count, maxCount, onTaskAccepted });
  } catch (error) {
    if (isGetTokenBananaProvider(provider)) throw error;
    const transientStatus = error instanceof GenerationDiagnosticError
      && [429, 502, 503].includes(error.upstreamStatus || 0);
    const stalledBeforeGeneration = error instanceof GenerationDiagnosticError
      && error.upstreamStatus === 504
      && /pre_resolve_stall_timeout|no image_ref_resolve_start/i.test(error.message);
    if (!transientStatus && !stalledBeforeGeneration) throw error;
    await wait(1000);
    return callImageProviderOnce({ provider, prompt, ratio, quality, files, count, maxCount, onTaskAccepted });
  }
}

async function callImageProviderOnce({
  provider,
  prompt,
  ratio,
  quality,
  files,
  count,
  maxCount,
  onTaskAccepted,
}: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  count: number;
  maxCount?: number;
  onTaskAccepted?: (taskId: string) => Promise<void>;
}) {
  const size = ratioToSize(ratio);
  const useMultipart = files.length > 0;
  const outputCount = Math.min(Math.max(Math.round(count || 1), 1), maxCount || 4);

  if (isGetTokenBananaProvider(provider)) {
    return callGetTokenBananaProvider({ provider, prompt, ratio, quality, files, count: outputCount, maxCount, onTaskAccepted });
  }

  const apiUrl = imageEndpoint(provider, useMultipart);

  if (isImg2ImageProvider(provider) && !useMultipart) {
    const response = await fetchProviderWithNetworkRetry(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(provider),
      },
      body: JSON.stringify({
        model: provider.model,
        prompt,
        size: img2ImageSize(ratio, quality),
        n: outputCount,
      }),
      signal: AbortSignal.timeout(imageProviderRequestTimeoutMs),
    });
    return parseImageProviderOutputs(await readProviderJson(response, provider));
  }

  if (useMultipart) {
    const upscale = imageUpscaleValue(quality);
    const form = new FormData();
    form.append("model", provider.model);
    form.append("prompt", prompt);
    form.append("n", String(outputCount));
    form.append("size", size);
    form.append("quality", imageQualityLabel(quality));
    form.append("response_format", looksLikeOpenAiImageModel(provider.model) ? "b64_json" : "url");
    if (upscale) form.append("upscale", upscale);
    files.forEach((file) => {
      form.append(
        "image[]",
        new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
        file.fileName,
      );
    });

    const response = await fetchProviderWithNetworkRetry(apiUrl, {
      method: "POST",
      headers: authHeaders(provider),
      body: form,
      signal: AbortSignal.timeout(imageProviderRequestTimeoutMs),
    });
    return parseImageProviderOutputs(await readProviderJson(response, provider));
  }

  const upscale = imageUpscaleValue(quality);
  const response = await fetchProviderWithNetworkRetry(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(provider),
    },
    body: JSON.stringify({
      model: provider.model,
      prompt,
      n: outputCount,
      size,
      quality: imageQualityLabel(quality),
      response_format: looksLikeOpenAiImageModel(provider.model) ? "b64_json" : "url",
      ...(upscale ? { upscale } : {}),
    }),
    signal: AbortSignal.timeout(imageProviderRequestTimeoutMs),
  });
  return parseImageProviderOutputs(await readProviderJson(response, provider));
}

async function collectImageProviderOutputs(input: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  count: number;
  maxCount?: number;
  onTaskAccepted?: (taskId: string) => Promise<void>;
}) {
  const maxCount = input.maxCount || 4;
  const targetCount = Math.min(Math.max(Math.round(input.count || 1), 1), maxCount);
  const outputs = await callImageProvider({ ...input, count: targetCount });
  if (outputs.length >= targetCount) return outputs.slice(0, targetCount);

  const missingCount = targetCount - outputs.length;
  const refillOutputs = await callImageProvider({ ...input, count: missingCount });
  return [...outputs, ...refillOutputs].slice(0, targetCount);
}

async function findExistingImageItemsForBillingTask(localUserId?: string | null, taskId?: string | null) {
  if (!localUserId || !taskId) return [];
  const items = await readLibraryMetadataForOwner(localUserId);
  return items
    .filter((item) => (
      item.type === "image"
      && item.status === "done"
      && item.params?.billingTaskId === taskId
      && item.output?.url
    ))
    .sort((a, b) => {
      const leftIndex = Number(a.params?.imageBatchIndex || 0);
      const rightIndex = Number(b.params?.imageBatchIndex || 0);
      if (leftIndex || rightIndex) return leftIndex - rightIndex;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

async function waitForExistingImageItemsForBillingTask(input: {
  localUserId?: string | null;
  taskId?: string | null;
  expectedCount: number;
  maxCount?: number;
}) {
  const expectedCount = Math.min(Math.max(Math.round(input.expectedCount || 1), 1), input.maxCount || 4);
  const deadline = Date.now() + duplicateImageDispatchWaitMs;
  while (Date.now() <= deadline) {
    const items = await findExistingImageItemsForBillingTask(input.localUserId, input.taskId);
    if (items.length >= expectedCount) return items.slice(0, expectedCount);
    if (items.length > 0 && expectedCount === 1) return items.slice(0, 1);
    await wait(duplicateImageDispatchPollMs);
  }
  return findExistingImageItemsForBillingTask(input.localUserId, input.taskId);
}

async function outputToLibrary(output: ProviderOutput, type: "image" | "video", prefix: string) {
  await assertStorageAllows(type === "video" ? "video-media-write" : "image-media-write", { fresh: true });
  const plan = planProviderOutputStorage(output, type);
  if (plan.mode === "data-url") return storeDataUrl(plan.dataUrl, prefix);
  return storeRemoteUrl(plan.url, prefix, plan.fallbackMime);
}

async function settleGeneratedTaskBilling(input: {
  localUserId?: string | null;
  taskId?: string | null;
  estimatedQuotaUnits?: number | null;
  outcome: "success" | "failed";
  reason?: string | null;
  upstreamRequestId?: string | null;
  upstreamModel?: string | null;
  newApiTaskId?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; message: string; action?: string }> {
  if (!input.localUserId || !input.taskId) return { ok: true };
  const billing = getTaskBillingService();
  const actualQuotaUnits = Number.isInteger(input.estimatedQuotaUnits)
    ? Math.max(0, input.estimatedQuotaUnits as number)
    : 0;
  try {
    if (input.outcome === "success") {
      const result = await billing.settleSuccess({
        localUserId: input.localUserId,
        taskId: input.taskId,
        actualQuotaUnits,
        newApiTaskId: input.newApiTaskId || null,
        upstreamRequestId: input.upstreamRequestId || null,
        upstreamModel: input.upstreamModel || null,
      });
      if (!result.ok) return { ok: false, status: result.status, message: result.message };
      if (result.action === "reconciliation_required") {
        return {
          ok: false,
          status: 202,
          message: result.record.last_error || "Task billing requires reconciliation.",
          action: result.action,
        };
      }
    } else {
      const result = await billing.fail({
        localUserId: input.localUserId,
        taskId: input.taskId,
        reason: input.reason || "generation failed",
        newApiTaskId: input.newApiTaskId || null,
        upstreamRequestId: input.upstreamRequestId || null,
        upstreamModel: input.upstreamModel || null,
      });
      if (!result.ok) return { ok: false, status: result.status, message: result.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 503, message: "Task billing settlement failed." };
  }
}

async function restoreMembershipEntitlementOnFailure(input: {
  localUserId?: string | null;
  taskId?: string | null;
  operation?: "cloud_image_generation" | "cloud_image_edit" | "cloud_video_generation" | "cloud_image_upscale" | "cloud_video_upscale" | "prompt_optimize" | null;
  amount?: number | null;
}) {
  if (!input.localUserId || !input.taskId || !input.operation) return;
  const requestedAmount = Math.round(Number(input.amount) || 0);
  if (requestedAmount <= 0) return;
  const kind = input.operation === "cloud_video_generation"
    ? "video_generation"
    : input.operation === "cloud_video_upscale"
      ? "video_upscale"
      : input.operation === "cloud_image_upscale"
        ? "image_upscale"
        : input.operation === "cloud_image_edit"
          ? "image_edit"
          : input.operation === "prompt_optimize"
            ? "prompt_optimize"
            : "image_generation";
  await getMembershipService().restoreEntitlement({
    localUserId: input.localUserId,
    kind,
    amount: Math.min(Math.max(requestedAmount, 1), 8),
    idempotencyKey: `membership:restore:${kind}:${input.taskId}`,
    taskId: input.taskId,
  }).catch(() => undefined);
}

export async function failVideoGenerationBeforeSubmit(input: {
  localUserId?: string | null;
  taskId?: string | null;
  estimatedQuotaUnits?: number | null;
  membershipEntitlementAmount?: number | null;
  reason?: string | null;
}) {
  await restoreMembershipEntitlementOnFailure({
    localUserId: input.localUserId,
    taskId: input.taskId,
    operation: "cloud_video_generation",
    amount: input.membershipEntitlementAmount,
  });
  return settleGeneratedTaskBilling({
    localUserId: input.localUserId,
    taskId: input.taskId,
    estimatedQuotaUnits: input.estimatedQuotaUnits,
    outcome: "failed",
    reason: input.reason || "video upload validation failed",
  });
}

export async function failImageGenerationBeforeSubmit(input: {
  localUserId?: string | null;
  taskId?: string | null;
  operation?: "cloud_image_generation" | "cloud_image_edit" | null;
  estimatedQuotaUnits?: number | null;
  membershipEntitlementAmount?: number | null;
  reason?: string | null;
}) {
  const operation = input.operation === "cloud_image_edit" ? "cloud_image_edit" : "cloud_image_generation";
  await restoreMembershipEntitlementOnFailure({
    localUserId: input.localUserId,
    taskId: input.taskId,
    operation,
    amount: input.membershipEntitlementAmount,
  });
  return settleGeneratedTaskBilling({
    localUserId: input.localUserId,
    taskId: input.taskId,
    estimatedQuotaUnits: input.estimatedQuotaUnits,
    outcome: "failed",
    reason: input.reason || "image generation rejected before provider submission",
  });
}

async function claimGenerationBillingDispatch(input: {
  localUserId?: string | null;
  taskId?: string | null;
  idempotencyKey?: string | null;
  fingerprint: string;
  estimatedQuotaUnits: number;
  membershipEntitlementAmount?: number | null;
}) {
  if (!input.localUserId || !input.taskId || !input.idempotencyKey) {
    throw new Error("生成任务缺少有效额度预检。");
  }
  const billing = getTaskBillingService();
  const claimed = await billing.claimProviderDispatch({
    localUserId: input.localUserId,
    taskId: input.taskId,
    idempotencyKey: input.idempotencyKey,
    estimatedQuotaUnits: input.estimatedQuotaUnits,
    membershipEntitlementAmount: input.membershipEntitlementAmount,
    requestFingerprint: input.fingerprint,
  });
  if (!claimed.ok) throw new BillingDispatchRejectedError(claimed.message);
  if (claimed.action !== "dispatching") throw new BillingDispatchRejectedError("生成任务无法领取上游派发权限。");
}

async function markGenerationProviderStarted(input: {
  localUserId?: string | null;
  taskId?: string | null;
  upstreamModel?: string | null;
}) {
  if (!input.localUserId || !input.taskId) return;
  const result = await getTaskBillingService().markProviderStarted({
    localUserId: input.localUserId,
    taskId: input.taskId,
    upstreamModel: input.upstreamModel || null,
  });
  if (!result.ok) throw new BillingDispatchRejectedError(result.message);
}

async function acceptGenerationBilling(input: {
  localUserId?: string | null;
  taskId?: string | null;
  newApiTaskId?: string | null;
  upstreamModel?: string | null;
}) {
  if (!input.localUserId || !input.taskId) return;
  const result = await getTaskBillingService().accept({
    localUserId: input.localUserId,
    taskId: input.taskId,
    newApiTaskId: input.newApiTaskId || null,
    upstreamModel: input.upstreamModel || null,
  });
  if (!result.ok) throw new BillingSettlementRequiredError(result.message);
}

export async function generateImage(input: {
  providerId: string;
  mode: "text-to-image" | "image-to-image";
  operation?: "cloud_image_generation" | "cloud_image_edit" | null;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  count?: number | null;
  batchId?: string | null;
  batchTotal?: number | null;
  batchStyleIndex?: number | null;
  pageIndex?: number | null;
  billingLocalUserId?: string | null;
  billingTaskId?: string | null;
  billingIdempotencyKey?: string | null;
  billingEstimatedQuotaUnits?: number | null;
  billingMode?: "standard" | "internal_free";
  canvasScope?: "personal" | "shared";
  canvasRequestedAt?: string | null;
}) {
  const provider = await providerById(input.providerId);
  const billingMode = input.billingMode === "internal_free" ? "internal_free" : "standard";
  const maxOutputCount = billingMode === "internal_free" ? 8 : 4;
  const outputCount = Math.min(Math.max(Math.round(Number(input.count) || 1), 1), maxOutputCount);
  const imageOperation = input.operation === "cloud_image_edit" ? "cloud_image_edit" : "cloud_image_generation";
  const rawEstimatedQuotaUnits = estimateImageGenerationTotalQuota({
    quality: input.quality,
    count: outputCount,
    model: provider?.model,
  });
  const estimatedQuotaUnits = billingMode === "internal_free" ? 0 : rawEstimatedQuotaUnits;
  const membershipEntitlementAmount = billingMode === "internal_free" ? 0 : estimateImageGenerationEntitlementUnits({
    quality: input.quality,
    count: outputCount,
  });
  const billingFingerprint = generationBillingFingerprint({
    kind: "image",
    operation: imageOperation,
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    quality: input.quality,
    referenceImages: input.files.length,
    taskId: input.billingTaskId || "",
    estimatedQuotaUnits,
  });
  try {
    await assertStorageAllows("image-generation");
    const readyProvider = assertProviderReady(provider, "image", "MODEL_MISSING_IMAGE");
    if (!input.prompt.trim()) throw new GenerationDiagnosticError({ code: "INPUT_MISSING_PROMPT", providerId: readyProvider.id, model: readyProvider.model });
    if (input.mode === "image-to-image" && !input.files.length) {
      throw new GenerationDiagnosticError({ code: "INPUT_MISSING_IMAGE", providerId: readyProvider.id, model: readyProvider.model });
    }
    await claimGenerationBillingDispatch({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      idempotencyKey: input.billingIdempotencyKey,
      fingerprint: billingFingerprint,
      estimatedQuotaUnits,
      membershipEntitlementAmount,
    });
    await markGenerationProviderStarted({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      upstreamModel: readyProvider.model,
    });

    const output = await collectImageProviderOutputs({
      provider: readyProvider,
      prompt: input.prompt,
      ratio: input.ratio,
      quality: input.quality,
      files: input.files,
      count: outputCount,
      maxCount: maxOutputCount,
      onTaskAccepted: (taskId) => acceptGenerationBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        newApiTaskId: taskId,
        upstreamModel: readyProvider.model,
      }),
    });
    if (!output.length) throw new Error("Image provider returned no outputs.");
    const providerOutputCount = output.length;
    const providerQuotaUnits = billingMode === "internal_free" ? 0 : estimateImageGenerationTotalQuota({
      quality: input.quality,
      count: providerOutputCount,
      model: readyProvider.model,
    });
    const batchTotal = Number.isFinite(Number(input.batchTotal)) && Number(input.batchTotal) > 1
      ? Math.min(Math.max(Math.round(Number(input.batchTotal)), 1), 10)
      : Math.min(Math.max(Math.max(providerOutputCount, outputCount), 1), maxOutputCount);
    const itemResults = await Promise.allSettled(output.map(async (entry, index) => {
      const stored = await outputToLibrary(entry, "image", "image");
      return addLibraryItem({
      ownerLocalUserId: input.billingLocalUserId || null,
      type: "image",
      mode: input.mode,
      title: input.prompt.slice(0, 42) || "图片生成",
      prompt: input.prompt,
      providerId: readyProvider.id,
      model: readyProvider.model,
      status: "done",
      output: stored,
      params: {
        ratio: input.ratio,
        quality: input.quality,
        referenceImages: input.files.length,
        ...(input.batchId ? { imageBatchId: input.batchId } : {}),
        ...(batchTotal > 1 || Number.isInteger(input.pageIndex) ? { imageBatchTotal: batchTotal, imageBatchIndex: index + 1 } : {}),
        ...(Number.isInteger(input.batchStyleIndex) ? { imageBatchStyleIndex: Number(input.batchStyleIndex) } : {}),
        ...(Number.isInteger(input.pageIndex) ? { imagePageIndex: Number(input.pageIndex) } : {}),
        ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
        ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
        billingOperation: imageOperation,
        billingEstimatedQuotaUnits: providerQuotaUnits,
        billingRequestFingerprint: billingFingerprint,
        canvasScope: input.canvasScope === "shared" ? "shared" : "personal",
        ...(validIsoTimestamp(input.canvasRequestedAt) ? { canvasRequestedAt: input.canvasRequestedAt! } : {}),
        ...(providerOutputCount !== outputCount ? { partialBatch: true, requestedBatchTotal: outputCount } : {}),
      },
      });
    }));
    const items = itemResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!items.length) {
      const rejected = itemResults.find((result) => result.status === "rejected");
      throw rejected?.reason instanceof Error ? rejected.reason : new Error("Image results could not be saved.");
    }
    const actualOutputCount = items.length;
    const actualQuotaUnits = billingMode === "internal_free" ? 0 : estimateImageGenerationTotalQuota({
      quality: input.quality,
      count: actualOutputCount,
      model: readyProvider.model,
    });
    if (actualOutputCount < outputCount) {
      await restoreMembershipEntitlementOnFailure({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        operation: imageOperation,
        amount: estimateImageGenerationEntitlementUnits({
          quality: input.quality,
          count: outputCount - actualOutputCount,
        }),
      });
    }
    await acceptGenerationBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      newApiTaskId: output[0]?.jobId || items[0]?.id,
      upstreamModel: readyProvider.model,
    });
    const settled = await settleGeneratedTaskBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      estimatedQuotaUnits: actualQuotaUnits,
      outcome: "success",
      upstreamModel: readyProvider.model,
      newApiTaskId: output[0]?.jobId || items[0]?.id,
    });
    if (!settled.ok && settled.status !== 202) {
      throw new BillingSettlementRequiredError(settled.message);
    }
    return items;
  } catch (error) {
    if (error instanceof BillingDispatchRejectedError) {
      const existingItems = await waitForExistingImageItemsForBillingTask({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        expectedCount: outputCount,
        maxCount: maxOutputCount,
      });
      if (existingItems.length) return existingItems;
      await restoreMembershipEntitlementOnFailure({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        operation: imageOperation,
        amount: membershipEntitlementAmount,
      });
      throw new GenerationDiagnosticError({
        code: "TASK_CREATE_FAILED",
        status: 409,
        message: error.message,
        publicMessage: "当前任务已在生成中，请稍候在作品库查看结果。",
      });
    }
    if (!(error instanceof BillingSettlementRequiredError) && !(error instanceof BillingDispatchRejectedError)) {
      await restoreMembershipEntitlementOnFailure({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        operation: imageOperation,
        amount: membershipEntitlementAmount,
      });
      await settleGeneratedTaskBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        estimatedQuotaUnits,
        outcome: "failed",
        reason: error instanceof Error ? error.message : "generation failed",
        upstreamModel: provider?.model || null,
      });
    }
    throw error;
  }
}

export async function submitVideo(input: {
  providerId: string;
  mode: "text-to-video" | "image-to-video";
  referenceMode?: "single" | "first-last";
  prompt: string;
  ratio: string;
  duration: number;
  resolution: string;
  files: UploadedMedia[];
  billingLocalUserId?: string | null;
  billingTaskId?: string | null;
  billingIdempotencyKey?: string | null;
  billingEstimatedQuotaUnits?: number | null;
  billingMode?: "standard" | "internal_free";
  canvasScope?: "personal" | "shared";
  canvasRequestedAt?: string | null;
}) {
  const provider = await providerById(input.providerId);
  const referenceImageCount = mediaFiles(input, "image").length;
  if (isVideoGenerationPricingPending(provider?.model)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider?.id,
      model: provider?.model,
      publicMessage: "当前 Seedance 模型价格待定，暂未开放生成。",
    });
  }
  const rawEstimatedQuotaUnits = estimateGenerationQuota({
    kind: "video",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    durationSeconds: input.duration,
    resolution: input.resolution,
    referenceImages: referenceImageCount,
    model: provider?.model,
  });
  const billingMode = input.billingMode === "internal_free" ? "internal_free" : "standard";
  const estimatedQuotaUnits = billingMode === "internal_free" ? 0 : rawEstimatedQuotaUnits;
  const billingFingerprint = generationBillingFingerprint({
    kind: "video",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    durationSeconds: input.duration,
    resolution: input.resolution,
    referenceImages: referenceImageCount,
    model: provider?.model,
    taskId: input.billingTaskId || "",
    estimatedQuotaUnits,
  });
  const membershipEntitlementAmount = billingMode === "internal_free" ? 0 : estimateVideoGenerationEntitlementUnits({
    resolution: input.resolution,
    model: provider?.model,
    durationSeconds: input.duration,
  });
  try {
    await assertStorageAllows("video-generation", { fresh: true });
    if (!input.prompt.trim()) throw new GenerationDiagnosticError({ code: "INPUT_MISSING_PROMPT", providerId: provider?.id, model: provider?.model });
    if (input.mode === "text-to-video" && input.files.length) {
      throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", providerId: provider?.id, model: provider?.model });
    }
    if (input.mode === "image-to-video") {
      if (!input.files.length) {
        throw new GenerationDiagnosticError({ code: "INPUT_MISSING_IMAGE", providerId: provider?.id, model: provider?.model });
      }
    }

    const readyProvider = assertProviderReady(provider, "video", "MODEL_MISSING_VIDEO");
    const providerInput = isClmmSeedanceProvider(readyProvider)
      ? { ...input, ...resolveClmmSeedanceReferences(readyProvider, input) }
      : input;
    const effectiveReferenceImageCount = mediaFiles(providerInput, "image").length;
    const effectiveReferenceVideoCount = mediaFiles(providerInput, "video").length;
    const effectiveReferenceAudioCount = mediaFiles(providerInput, "audio").length;
    validateVideoInput(readyProvider, providerInput);
    await claimGenerationBillingDispatch({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      idempotencyKey: input.billingIdempotencyKey,
      fingerprint: billingFingerprint,
      estimatedQuotaUnits,
      membershipEntitlementAmount,
    });
    await markGenerationProviderStarted({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      upstreamModel: readyProvider.model,
    });

    let output: ProviderOutput;
    if (isGetTokenVeoProvider(readyProvider)) {
      output = await callGetTokenVeoProvider(readyProvider, input);
    } else if (isGrokVideoProvider(readyProvider)) {
      output = await callGrokVideoProvider(readyProvider, { ...input, files: mediaFiles(input, "image") });
    } else if (isRedbirdSeedanceProvider(readyProvider) || isClmmSeedanceProvider(readyProvider)) {
      const referenceImages = mediaFiles(providerInput, "image");
      const referenceVideos = mediaFiles(providerInput, "video");
      const referenceAudios = mediaFiles(providerInput, "audio");
      const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        prepareRedbirdReferenceUrls(referenceImages),
        prepareRedbirdReferenceUrls(referenceVideos),
        prepareRedbirdReferenceUrls(referenceAudios),
      ]);
      const response = await fetch(readyProvider.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(readyProvider),
        },
        body: JSON.stringify(isClmmSeedanceProvider(readyProvider)
          ? clmmSeedanceVideoPayload(readyProvider, { ...providerInput, imageUrls, videoUrls, audioUrls })
          : redbirdVideoPayload(readyProvider, { ...providerInput, files: referenceImages, imageUrls, videoUrls, audioUrls })),
        signal: AbortSignal.timeout(180000),
      });
      const payload = await readProviderJson(response, readyProvider);
      output = parseProviderOutput(payload);
      if (!output.url && !output.jobId) {
        const root = asRecord(payload);
        throw new GenerationDiagnosticError({
          code: "PROVIDER_BAD_RESPONSE",
          message: firstString(asRecord(root.error).message, root.message, root.fail_reason) || "Redbird video response did not contain a task id.",
          publicMessage: "上游未创建视频任务，请稍后重试。",
          providerId: readyProvider.id,
          model: readyProvider.model,
          safeDetails: { responseKeys: Object.keys(root).slice(0, 12) },
        });
      }
    } else {
      const providerVideoOptions = videoOptionsForProvider(readyProvider);
      const resolution = input.resolution || providerVideoOptions?.resolution || "720p";
      const providerPayload: Record<string, string | number | string[]> = {
        model: readyProvider.model,
        prompt: input.prompt,
        duration: input.duration,
        seconds: seedanceVideoRequestSecondsForModel(readyProvider.model, input.duration),
        aspect_ratio: input.ratio,
        size: resolution === "720p" ? ratioTo720pSize(input.ratio) : ratioToSize(input.ratio),
        resolution,
        response_format: "url",
      };
      if (input.mode === "image-to-video") {
        const [file] = input.files;
        providerPayload.image = [`data:${file.mimeType};base64,${file.bytes.toString("base64")}`];
      }

      const response = await fetch(readyProvider.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(readyProvider),
        },
        body: JSON.stringify(providerPayload),
        signal: AbortSignal.timeout(180000),
      });
      output = parseProviderOutput(await readProviderJson(response, readyProvider));
    }

    if (output.url) {
      const outputUrl = absolutizeProviderUrl(readyProvider, output.url);
      const stored = isGrokVideoProvider(readyProvider) && outputUrl.includes("/content")
        ? await outputToLibraryFromAuthenticatedUrl(readyProvider, outputUrl, "video")
        : await outputToLibrary({ ...output, url: outputUrl }, "video", "video");
      const item = await addLibraryItem({
        ownerLocalUserId: input.billingLocalUserId || null,
        type: "video",
        mode: input.mode,
        title: input.prompt.slice(0, 42) || "视频生成",
        prompt: input.prompt,
        providerId: readyProvider.id,
        model: readyProvider.model,
        status: "done",
        output: stored,
        params: {
          ratio: input.ratio,
          duration: input.duration,
          resolution: input.resolution,
          referenceImages: effectiveReferenceImageCount,
          referenceVideos: effectiveReferenceVideoCount,
          referenceAudios: effectiveReferenceAudioCount,
          ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
          ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
          billingEstimatedQuotaUnits: estimatedQuotaUnits,
          billingRequestFingerprint: billingFingerprint,
          canvasScope: input.canvasScope === "shared" ? "shared" : "personal",
          ...(validIsoTimestamp(input.canvasRequestedAt) ? { canvasRequestedAt: input.canvasRequestedAt! } : {}),
        },
      });
      await acceptGenerationBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        newApiTaskId: output.jobId || item.id,
        upstreamModel: readyProvider.model,
      });
      const settled = await settleGeneratedTaskBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        estimatedQuotaUnits,
        outcome: "success",
        upstreamModel: readyProvider.model,
        newApiTaskId: output.jobId || item.id,
      });
      if (!settled.ok) {
        throw new BillingSettlementRequiredError(settled.status === 202 ? "生成已完成，但计费结算需要人工对账。" : settled.message);
      }
      return { item, job: null };
    }

    const item = await addLibraryItem({
      ownerLocalUserId: input.billingLocalUserId || null,
      type: "video",
      mode: input.mode,
      title: input.prompt.slice(0, 42) || "视频生成",
      prompt: input.prompt,
      providerId: readyProvider.id,
      model: readyProvider.model,
      status: normalizeStatus(output.status || ""),
      params: {
        ratio: input.ratio,
        duration: input.duration,
        resolution: input.resolution,
        referenceImages: effectiveReferenceImageCount,
        referenceVideos: effectiveReferenceVideoCount,
        referenceAudios: effectiveReferenceAudioCount,
        ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
        canvasScope: input.canvasScope === "shared" ? "shared" : "personal",
        ...(validIsoTimestamp(input.canvasRequestedAt) ? { canvasRequestedAt: input.canvasRequestedAt! } : {}),
      },
    });
    const jobId = output.jobId || randomUUID();
    await acceptGenerationBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      newApiTaskId: jobId,
      upstreamModel: readyProvider.model,
    });
    const job = await addJob({
      id: jobId,
      libraryItemId: item.id,
      type: "video",
      ownerLocalUserId: input.billingLocalUserId || null,
      providerId: readyProvider.id,
      status: normalizeStatus(output.status || ""),
      progress: output.progress,
      statusUrl: output.statusUrl
        ? absolutizeProviderUrl(readyProvider, output.statusUrl)
        : isGrokVideoProvider(readyProvider) ? grokStatusUrl(readyProvider.apiUrl, jobId) : deriveStatusUrl(readyProvider.apiUrl, jobId),
      billing_task_id: input.billingTaskId || null,
      billing_local_user_id: input.billingLocalUserId || null,
      billing_idempotency_key: input.billingIdempotencyKey || null,
      billing_estimated_quota_units: estimatedQuotaUnits,
      billing_state: input.billingTaskId ? "accepted" : undefined,
      billing_last_error: null,
    });
    return { item, job };
  } catch (error) {
    if (error instanceof BillingDispatchRejectedError) {
      await restoreMembershipEntitlementOnFailure({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        operation: "cloud_video_generation",
        amount: membershipEntitlementAmount,
      });
      throw new GenerationDiagnosticError({
        code: "TASK_CREATE_FAILED",
        status: 409,
        message: error.message,
        publicMessage: "当前任务已在生成中，请稍候在作品库查看结果。",
      });
    }
    if (!(error instanceof BillingSettlementRequiredError) && !(error instanceof BillingDispatchRejectedError)) {
      await restoreMembershipEntitlementOnFailure({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        operation: "cloud_video_generation",
        amount: membershipEntitlementAmount,
      });
      await settleGeneratedTaskBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        estimatedQuotaUnits,
        outcome: "failed",
        reason: error instanceof Error ? error.message : "generation failed",
        upstreamModel: provider?.model || null,
      });
    }
    throw error;
  }
}

async function reconcileFinalizedVideoJob(job: JobRecord, localUserId?: string | null) {
  const billingLocalUserId = job.billing_local_user_id || job.ownerLocalUserId || localUserId || null;
  if (!job.billing_task_id || !billingLocalUserId) return;
  if (job.status === "done") {
    const settled = await settleGeneratedTaskBilling({
      localUserId: billingLocalUserId,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "success",
      upstreamModel: null,
      newApiTaskId: job.id,
    });
    if (!settled.ok) {
      await updateJob(job.id, {
        billing_state: "reconciliation_required",
        billing_last_error: settled.message,
      });
    }
  } else if (job.status === "failed") {
    await settleGeneratedTaskBilling({
      localUserId: billingLocalUserId,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "failed",
      reason: job.billing_last_error || "generation failed",
      upstreamModel: null,
      newApiTaskId: job.id,
    });
  }
}

export async function refreshVideoJob(jobId: string, localUserId?: string | null, allowedOwnerIds: readonly string[] = []) {
  const { readJobs } = await import("./library");
  const job = (await readJobs()).find((item: JobRecord) => item.id === jobId);
  if (!job) throw new Error("任务不存在。");
  const jobOwner = job.ownerLocalUserId || job.billing_local_user_id || null;
  if (!canAccessVideoJob(jobOwner, localUserId || null, allowedOwnerIds)) {
    throw new Error("任务不存在。");
  }
  if (job.status === "done" || job.status === "failed") {
    await reconcileFinalizedVideoJob(job, localUserId);
    return job;
  }
  if (job.providerId === "video-upscale") {
    const { refreshVideoUpscaleJob } = await import("./volcengine-upscale");
    return refreshVideoUpscaleJob(jobId, localUserId);
  }

  const provider = await providerById(job.providerId);
  if (!provider || !provider.apiKey) throw new Error("视频供应商未配置。");
  if (!job.statusUrl) return job;

  const getTokenVeo = isGetTokenVeoProvider(provider);
  const response = await fetchVideoJobStatus(provider, job.statusUrl, getTokenVeo, job.id);
  if (isSeedanceTaskProvider(provider) && response.status === 404) {
    await response.body?.cancel();
    await updateLibraryItem(job.libraryItemId, {
      status: "failed",
      error: "视频生成任务未找到。",
    });
    const updated = await updateJob(job.id, {
      status: "failed",
      error: "视频生成任务未找到。",
      billing_state: job.billing_task_id ? job.billing_state || "prechecked" : job.billing_state,
    }) || job;
    await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "failed",
      reason: "upstream task not found",
      upstreamModel: provider.model,
      newApiTaskId: job.id,
    });
    return updated;
  }
  if (getTokenVeo && shouldKeepGetTokenVeoJobPending(response.status, job.createdAt)) {
    await response.body?.cancel();
    return job;
  }
  let payload: unknown;
  if (getTokenVeo && response.status === 400) {
    await response.body?.cancel();
    payload = { status: "FAILED", errorCode: "RESULT_EXPIRED" };
  } else {
    payload = await readProviderJson(response, provider);
  }
  let output = parseProviderOutput(payload);
  let status: JobRecord["status"] = normalizeStatus(output.status || "");
  if (getTokenVeo) {
    const videoUrl = getTokenVeoVideoResultUrl(payload);
    output = { ...output, url: videoUrl };
    if (status === "done" && !videoUrl) status = "failed";
  }

  if (status === "failed") {
    const failureMessage = videoJobFailureMessage(payload);
    await updateLibraryItem(job.libraryItemId, {
      status: "failed",
      error: failureMessage,
    });
    const updated = await updateJob(job.id, {
      status,
      progress: output.progress,
      error: failureMessage,
      billing_state: job.billing_task_id ? job.billing_state || "prechecked" : job.billing_state,
    }) || job;
    await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "failed",
      reason: output.status || "generation failed",
      upstreamRequestId: output.jobId || null,
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || job.id,
    });
    return updated;
  }

  if (output.url) {
    const outputUrl = absolutizeProviderUrl(provider, output.url);
    const stored = outputUrl.includes("/content")
      ? await outputToLibraryFromAuthenticatedUrl(provider, outputUrl, "video", isSeedanceTaskProvider(provider) ? seedanceVideoResultDownloadOptions : undefined)
      : isSeedanceTaskProvider(provider)
        ? await storeRemoteUrlStreamed(outputUrl, { prefix: "video", fallbackMime: "video/mp4", trustedProviderResultHost: true, ...seedanceVideoResultDownloadOptions })
        : await outputToLibrary({ ...output, url: outputUrl }, "video", "video");
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      output: stored,
    } satisfies Partial<LibraryItem>);
    let updated = await updateJob(job.id, {
      status: "done",
      progress: 100,
      billing_state: job.billing_task_id ? job.billing_state || "accepted" : job.billing_state,
      billing_last_error: null,
    }) || job;
    const settled = await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "success",
      upstreamRequestId: output.jobId || null,
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || job.id,
    });
    if (!settled.ok) {
      await updateJob(job.id, {
        billing_state: "reconciliation_required",
        billing_last_error: settled.message,
      });
    } else if (job.billing_task_id) {
      updated = await updateJob(job.id, {
        billing_state: "settled",
        billing_last_error: null,
      }) || updated;
    }
    return updated;
  }

  if (isGrokVideoProvider(provider) && status === "done" && !output.url) {
    const contentUrl = `${job.statusUrl.replace(/\/$/, "")}/content`;
    const stored = await outputToLibraryFromAuthenticatedUrl(provider, contentUrl, "video");
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      output: stored,
    } satisfies Partial<LibraryItem>);
    let updated = await updateJob(job.id, {
      status: "done",
      progress: 100,
      billing_state: job.billing_task_id ? job.billing_state || "accepted" : job.billing_state,
      billing_last_error: null,
    }) || job;
    const settled = await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "success",
      upstreamRequestId: output.jobId || null,
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || job.id,
    });
    if (!settled.ok) {
      await updateJob(job.id, {
        billing_state: "reconciliation_required",
        billing_last_error: settled.message,
      });
    } else if (job.billing_task_id) {
      updated = await updateJob(job.id, {
        billing_state: "settled",
        billing_last_error: null,
      }) || updated;
    }
    return updated;
  }

  return updateJob(job.id, {
    status,
    progress: output.progress,
    billing_state: job.billing_task_id ? job.billing_state || "prechecked" : job.billing_state,
  });
}

function selectPendingVideoJobsForOwner(jobs: JobRecord[], ownerId: string, limit: number) {
  return jobs
    .filter((job: JobRecord) => (
      job.type === "video"
      && job.status !== "done"
      && job.status !== "failed"
      && (job.ownerLocalUserId === ownerId || job.billing_local_user_id === ownerId)
    ))
    // Rotate recovery toward jobs that have waited the longest since their last status check.
    .sort((a: JobRecord, b: JobRecord) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(1, Math.min(10, Math.floor(limit))));
}

export async function refreshPendingVideoJobsForOwner(localUserId: string, limit = 3) {
  const ownerId = localUserId.trim();
  if (!ownerId) return;
  const { readJobs } = await import("./library");
  const jobs = selectPendingVideoJobsForOwner(await readJobs(), ownerId, limit);
  for (const job of jobs) {
    await refreshVideoJob(job.id, ownerId).catch(() => undefined);
  }
}

export async function uploadedMediaFromForm(
  form: FormData,
  fieldName = "files",
  operation: "reference-image-upload" | "video-generation-upload" | "video-reference-upload" | "audio-reference-upload" = "reference-image-upload",
) {
  const files = form.getAll(fieldName).filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 10) throw new Error("最多上传 10 个参考素材。");
  if (operation !== "reference-image-upload" && files.length) {
    await assertStorageAllows("video-upload", { fresh: true });
  }
  const uploadKind = operation === "video-reference-upload"
    ? "reference-video"
    : operation === "audio-reference-upload" ? "reference-audio" : "reference-image";
  const mediaType = operation === "video-reference-upload"
    ? "video"
    : operation === "audio-reference-upload" ? "audio" : "image";
  const output: UploadedMedia[] = [];
  for (const file of files) {
    let mimeType: string;
    if (uploadKind === "reference-image") {
      assertFileSizeAllowed(file, "reference-image");
      mimeType = await assertFileFormatAllowed(file, "reference-image");
    } else {
      assertFileSizeAllowed(file, uploadKind);
      mimeType = await assertFileFormatAllowed(file, uploadKind);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (mediaType === "image") {
      if (operation === "video-generation-upload") {
        const sharp = (await import("sharp")).default;
        const metadata = await sharp(bytes).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        if (width < 300 || height < 300 || width > 6000 || height > 6000) {
          throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", publicMessage: "参考图每条边需在 300-6000 像素之间。" });
        }
        const aspectRatio = width / height;
        if (aspectRatio < 0.4 || aspectRatio > 2.5) {
          throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", publicMessage: "参考图宽高比需在 0.4-2.5 之间。" });
        }
      }
      output.push({ bytes, mimeType, fileName: file.name || "reference.png", mediaType });
      continue;
    }
    const metadata = await parseBuffer(bytes, { mimeType, size: bytes.length }, { duration: true, skipCovers: true });
    const durationSeconds = metadata.format.duration || 0;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", publicMessage: `无法读取参考${mediaType === "video" ? "视频" : "音频"}时长。` });
    }
    output.push({ bytes, mimeType, fileName: file.name || `reference.${mediaType === "video" ? "mp4" : "mp3"}`, mediaType, durationSeconds });
  }
  return output;
}

export const providerCallInternalsForTests = {
  validateVideoInput,
  validateGrokVideoInput,
  selectPendingVideoJobsForOwner,
  canUseSeedanceStatusFallback,
  seedanceVideoResultDownloadOptions,
  callOpenAiCompatibleGrokVideoProvider,
  callImageProviderOnce,
  collectImageProviderOutputs,
  callGetTokenBananaProvider,
  callGetTokenVeoProvider,
  getTokenBananaQueryEndpoint,
  getTokenBananaSubmitEndpoint,
  getTokenVeoQueryEndpoint,
  getTokenVeoSubmitEndpoint,
  isGetTokenBananaProvider,
  isGetTokenVeoProvider,
  isRedbirdSeedanceProvider,
  isClmmSeedanceProvider,
  resolveClmmSeedanceReferences,
  redbirdVideoPayload,
  clmmSeedanceVideoPayload,
  shouldKeepGetTokenVeoJobPending,
  getTokenVeoVideoResultUrl,
  isImg2ImageProvider,
  isLocalOpenAiCompatibleEndpoint,
  parseProviderOutput,
  videoJobFailureMessage,
  canAccessVideoJob,
  parseImageProviderOutputs,
  planProviderOutputStorage,
  readProviderJson,
  outputToLibrary,
  providerJsonDefaultLimitBytes,
  providerJsonErrorLimitBytes,
  providerJsonHardLimitBytes,
};
