import { randomUUID } from "node:crypto";

import {
  estimateGenerationQuota,
  generationBillingFingerprint,
} from "@/lib/generation-quota";

import { addJob, addLibraryItem, storeBytes, storeDataUrl, storeRemoteUrl, updateJob, updateLibraryItem } from "./library";
import { codeForUpstreamStatus, GenerationDiagnosticError } from "./error-diagnostics";
import { getTaskBillingService } from "./quota";
import { jimengVideoOptionsForModel, providerById } from "./providers";
import { createTunneltestReferenceImageUrl } from "./tunneltest-reference-images";
import { isTunnelTestRuntime } from "./tunneltest-limits";
import { type JobRecord, type LibraryItem, type ProviderConfig } from "./types";

type UploadedMedia = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type ProviderOutput = {
  url?: string;
  base64?: string;
  jobId?: string;
  status?: string;
  statusUrl?: string;
  mimeType?: string;
  error?: string;
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

const grokVideoDurations = new Set([6, 8, 10, 12, 15]);
const grokVideo10Ratios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
const grokVideo15Ratios = new Set(["16:9", "9:16"]);
const defaultVideoRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
const imageRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
const imageQualities = new Set(["1k", "2k", "4k"]);

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

function parseProviderOutput(payload: unknown): ProviderOutput {
  const root = asRecord(payload);
  const data = Array.isArray(root.data) ? root.data : [];
  const metadata = asRecord(root.metadata);
  const first = asRecord(data[0] || root.video || root.result || root.output || payload);
  const firstMetadata = asRecord(first.metadata);
  const status = firstString(first.status, root.status);
  const failed = normalizeStatus(status) === "failed";
  const error = firstString(
    asRecord(first.error).message,
    asRecord(root.error).message,
    first.error,
    root.error,
    first.message,
    root.message,
  );
  const url = firstString(
    first.url,
    first.image_url,
    first.video_url,
    first.output_url,
    first.download_url,
    first.result_url,
    firstMetadata.url,
    root.url,
    root.image_url,
    root.video_url,
    root.output_url,
    root.download_url,
    root.result_url,
    metadata.url,
  );
  const base64 = firstString(
    first.b64_json,
    first.base64,
    first.image_base64,
    root.b64_json,
    root.base64,
    root.image_base64,
  );
  return {
    url: failed ? "" : url,
    base64: failed ? "" : base64,
    jobId: firstString(first.task_id, first.id, first.video_id, root.task_id, root.id, root.video_id),
    status,
    statusUrl: firstString(first.status_url, root.status_url),
    mimeType: firstString(first.mime_type, root.mime_type),
    error: failed ? error || url || status : error,
  };
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
  return provider.id === "image-img2-4k" || provider.model === "image4k";
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

function deriveStatusUrl(apiUrl: string, jobId: string) {
  if (!jobId) return "";
  try {
    const parsed = new URL(apiUrl);
    const encodedJobId = encodeURIComponent(jobId);
    if (/\/videos\/generations\/?$/i.test(parsed.pathname)) {
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
  files: UploadedMedia[];
}) {
  if (!grokVideoDurations.has(input.duration)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      message: "当前 Grok 视频模型只支持 6、8、10、12、15 秒。",
      providerId: provider.id,
      model: provider.model,
    });
  }
  if (!grokVideoRatioOptions(provider).has(input.ratio)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      message: provider.model === "grok-video-1.5"
        ? "grok-video-1.5 只支持 16:9 和 9:16。"
        : "grok-video-1.0 不支持当前比例。",
      providerId: provider.id,
      model: provider.model,
    });
  }
  if (provider.model === "grok-video-1.5" && input.files.length !== 1) {
    throw new GenerationDiagnosticError({
      code: input.files.length ? "INPUT_INVALID_PARAMETERS" : "INPUT_MISSING_IMAGE",
      message: "grok-video-1.5 必须且只能上传 1 张参考图。",
      providerId: provider.id,
      model: provider.model,
    });
  }
  if (provider.model === "grok-video-1.0" && input.files.length > 7) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      message: "grok-video-1.0 最多支持 7 张参考图。",
      providerId: provider.id,
      model: provider.model,
    });
  }
}

function videoOptionsForProvider(provider: ProviderConfig) {
  return jimengVideoOptionsForModel(provider.model) || provider.videoOptions;
}

function validateVideoInput(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  ratio: string;
  duration: number;
  files: UploadedMedia[];
}) {
  if (!Number.isInteger(input.duration) || input.duration <= 0) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      message: "视频时长参数无效。",
      providerId: provider.id,
      model: provider.model,
    });
  }
  if (isGrokVideoProvider(provider)) {
    validateGrokVideoInput(provider, input);
    return;
  }
  const options = videoOptionsForProvider(provider);
  const allowedDurations = options?.durations?.length ? new Set(options.durations) : new Set([5, 8, 10, 15]);
  const allowedRatios = options?.ratios?.length ? new Set(options.ratios) : defaultVideoRatios;
  if (!allowedDurations.has(input.duration)) {
    throw new Error(`当前视频模型不支持 ${input.duration} 秒。`);
  }
  if (!allowedRatios.has(input.ratio)) {
    throw new Error(`当前视频模型不支持 ${input.ratio} 比例。`);
  }
  if (input.mode === "image-to-video") {
    const maxReferenceImages = options?.maxReferenceImages ?? 1;
    if (input.files.length > maxReferenceImages) {
      throw new Error(`当前视频模型最多支持 ${maxReferenceImages} 张参考图。`);
    }
  }
}

function validateImageInput(provider: ProviderConfig, input: {
  mode: "text-to-image" | "image-to-image";
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
}) {
  if (!input.prompt.trim()) throw new GenerationDiagnosticError({ code: "INPUT_MISSING_PROMPT", providerId: provider.id, model: provider.model });
  if (!imageRatios.has(input.ratio) || !imageQualities.has(input.quality)) {
    throw new GenerationDiagnosticError({
      code: "INPUT_INVALID_PARAMETERS",
      providerId: provider.id,
      model: provider.model,
    });
  }
  if (input.mode === "text-to-image" && input.files.length) {
    throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", providerId: provider.id, model: provider.model });
  }
  if (input.mode === "image-to-image" && !input.files.length) {
    throw new GenerationDiagnosticError({ code: "INPUT_MISSING_IMAGE", providerId: provider.id, model: provider.model });
  }
}

export async function assertVideoRequestReady(input: {
  providerId: string;
  mode: "text-to-video" | "image-to-video";
  prompt: string;
  ratio: string;
  duration: number;
  files: UploadedMedia[];
}) {
  const provider = await providerById(input.providerId);
  if (!input.prompt.trim()) throw new GenerationDiagnosticError({ code: "INPUT_MISSING_PROMPT", providerId: provider?.id, model: provider?.model });
  if (input.mode === "text-to-video" && input.files.length) {
    throw new GenerationDiagnosticError({ code: "INPUT_INVALID_PARAMETERS", providerId: provider?.id, model: provider?.model });
  }
  if (input.mode === "image-to-video" && !input.files.length) {
    throw new GenerationDiagnosticError({ code: "INPUT_MISSING_IMAGE", providerId: provider?.id, model: provider?.model });
  }
  const readyProvider = assertProviderReady(provider, "video", "MODEL_MISSING_VIDEO");
  validateVideoInput(readyProvider, input);
  return readyProvider;
}

function grokReferenceImageEndpoint(apiUrl: string) {
  try {
    const parsed = new URL(grokVideosEndpoint(apiUrl));
    parsed.pathname = parsed.pathname.replace(/\/videos\/?$/i, "/video-reference-images");
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function grokReferenceImageDataUri(file: UploadedMedia) {
  return `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;
}

function shouldInlineGrokReferenceImage(error: unknown) {
  if (!(error instanceof GenerationDiagnosticError)) return false;
  return error.upstreamStatus === 404
    && /video-reference-images|Invalid URL/i.test(error.message);
}

function grokStatusUrl(apiUrl: string, jobId: string) {
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

async function uploadGrokReferenceImage(provider: ProviderConfig, file: UploadedMedia, referenceBaseUrl?: string | null) {
  const tunneltestReferenceUrl = await createTunneltestReferenceImageUrl({
    baseUrl: referenceBaseUrl,
    bytes: file.bytes,
    mimeType: file.mimeType,
  });
  if (tunneltestReferenceUrl) return tunneltestReferenceUrl;

  const endpoint = grokReferenceImageEndpoint(provider.apiUrl);
  if (!endpoint) return grokReferenceImageDataUri(file);

  const dataUri = grokReferenceImageDataUri(file);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(provider),
      },
      body: JSON.stringify({
        image: dataUri,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const payload = await readProviderJson(response, provider);
    const url = firstString(asRecord(payload).url);
    if (!url) throw new Error("Grok 参考图上传未返回可用 URL。");
    return url;
  } catch (error) {
    if (shouldInlineGrokReferenceImage(error)) return dataUri;
    throw error;
  }
}

async function callGrokVideoProvider(provider: ProviderConfig, input: {
  mode: "text-to-video" | "image-to-video";
  prompt: string;
  ratio: string;
  duration: number;
  files: UploadedMedia[];
  referenceBaseUrl?: string | null;
}) {
  validateGrokVideoInput(provider, input);
  const form = new FormData();
  form.append("model", provider.model);
  form.append("prompt", input.prompt);
  form.append("seconds", String(input.duration));
  form.append("aspect_ratio", input.ratio);
  form.append("resolution", "720p");

  for (const file of input.files) {
    form.append("input_reference[image_url]", await uploadGrokReferenceImage(provider, file, input.referenceBaseUrl));
  }

  const response = await fetch(grokVideosEndpoint(provider.apiUrl), {
    method: "POST",
    headers: authHeaders(provider),
    body: form,
    signal: AbortSignal.timeout(180000),
  });
  return parseProviderOutput(await readProviderJson(response, provider));
}

async function outputToLibraryFromAuthenticatedUrl(provider: ProviderConfig, url: string, prefix: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`下载视频结果失败：HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type") || "video/mp4";
  return storeBytes(Buffer.from(await response.arrayBuffer()), mimeType, prefix);
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
  const text = await response.text().catch(() => "");
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
    const message = firstString(asRecord(record.error).message, record.message)
      || `供应商请求失败：HTTP ${response.status}`;
    throw new GenerationDiagnosticError({
      code: codeForUpstreamStatus(response.status),
      message,
      providerId: provider?.id,
      model: provider?.model,
      upstreamStatus: response.status,
      safeDetails: { upstreamStatus: response.status },
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

async function callImageProvider({
  provider,
  prompt,
  ratio,
  quality,
  files,
}: {
  provider: ProviderConfig;
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
}) {
  const size = ratioToSize(ratio);
  const useMultipart = files.length > 0;
  const apiUrl = imageEndpoint(provider, useMultipart);

  if (isImg2ImageProvider(provider) && !useMultipart) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(provider),
      },
      body: JSON.stringify({
        model: provider.model,
        prompt,
        size: img2ImageSize(ratio, quality),
      }),
      signal: AbortSignal.timeout(300000),
    });
    return parseProviderOutput(await readProviderJson(response, provider));
  }

  if (useMultipart) {
    const upscale = imageUpscaleValue(quality);
    const form = new FormData();
    form.append("model", provider.model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", size);
    form.append("quality", imageQualityLabel(quality));
    form.append("response_format", "url");
    if (upscale) form.append("upscale", upscale);
    files.forEach((file, index) => {
      form.append(
        index === 0 ? "image" : "image[]",
        new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
        file.fileName,
      );
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: authHeaders(provider),
      body: form,
      signal: AbortSignal.timeout(300000),
    });
    return parseProviderOutput(await readProviderJson(response, provider));
  }

  const upscale = imageUpscaleValue(quality);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(provider),
    },
    body: JSON.stringify({
      model: provider.model,
      prompt,
      size,
      quality: imageQualityLabel(quality),
      response_format: "url",
      ...(upscale ? { upscale } : {}),
    }),
    signal: AbortSignal.timeout(300000),
  });
  return parseProviderOutput(await readProviderJson(response, provider));
}

async function outputToLibrary(output: ProviderOutput, type: "image" | "video", prefix: string) {
  if (output.base64) {
    const stored = await storeBytes(
      Buffer.from(output.base64.replace(/^data:[^;]+;base64,/i, ""), "base64"),
      type === "image" ? "image/png" : "video/mp4",
      prefix,
    );
    return stored;
  }
  if (!output.url) throw new Error("供应商没有返回可识别的生成结果。");
  if (output.url.startsWith("data:")) return storeDataUrl(output.url, prefix);
  try {
    return await storeRemoteUrl(output.url, prefix, output.mimeType || (type === "image" ? "image/png" : "video/mp4"));
  } catch {
    return {
      url: output.url,
      mimeType: output.mimeType || (type === "image" ? "image/png" : "video/mp4"),
      sourceUrl: output.url,
    };
  }
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
  if (isTunnelTestRuntime()) return { ok: true };
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

async function claimGenerationBillingDispatch(input: {
  localUserId?: string | null;
  taskId?: string | null;
  idempotencyKey?: string | null;
  fingerprint: string;
  estimatedQuotaUnits: number;
}) {
  if (isTunnelTestRuntime()) return;
  if (!input.localUserId || !input.taskId || !input.idempotencyKey) {
    throw new Error("生成任务缺少有效额度预检。");
  }
  const billing = getTaskBillingService();
  const claimed = await billing.claimProviderDispatch({
    localUserId: input.localUserId,
    taskId: input.taskId,
    idempotencyKey: input.idempotencyKey,
    estimatedQuotaUnits: input.estimatedQuotaUnits,
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
  if (isTunnelTestRuntime()) return;
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
  if (isTunnelTestRuntime()) return;
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
  prompt: string;
  ratio: string;
  quality: string;
  files: UploadedMedia[];
  billingLocalUserId?: string | null;
  billingTaskId?: string | null;
  billingIdempotencyKey?: string | null;
  billingEstimatedQuotaUnits?: number | null;
}) {
  const provider = await providerById(input.providerId);
  const estimatedQuotaUnits = estimateGenerationQuota({
    kind: "image",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    quality: input.quality,
    referenceImages: input.files.length,
  });
  const billingFingerprint = generationBillingFingerprint({
    kind: "image",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    quality: input.quality,
    referenceImages: input.files.length,
    taskId: input.billingTaskId || "",
    estimatedQuotaUnits,
  });
  try {
    const readyProvider = assertProviderReady(provider, "image", "MODEL_MISSING_IMAGE");
    validateImageInput(readyProvider, input);
    await claimGenerationBillingDispatch({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      idempotencyKey: input.billingIdempotencyKey,
      fingerprint: billingFingerprint,
      estimatedQuotaUnits,
    });
    await markGenerationProviderStarted({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      upstreamModel: readyProvider.model,
    });

    const output = await callImageProvider({
      provider: readyProvider,
      prompt: input.prompt,
      ratio: input.ratio,
      quality: input.quality,
      files: input.files,
    });
    const stored = await outputToLibrary(output, "image", "image");
    const item = await addLibraryItem({
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
        ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
        ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
        billingEstimatedQuotaUnits: estimatedQuotaUnits,
        billingRequestFingerprint: billingFingerprint,
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
    return item;
  } catch (error) {
    if (!(error instanceof BillingSettlementRequiredError) && !(error instanceof BillingDispatchRejectedError)) {
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
  prompt: string;
  ratio: string;
  duration: number;
  files: UploadedMedia[];
  billingLocalUserId?: string | null;
  billingTaskId?: string | null;
  billingIdempotencyKey?: string | null;
  billingEstimatedQuotaUnits?: number | null;
  referenceBaseUrl?: string | null;
}) {
  const provider = await providerById(input.providerId);
  const estimatedQuotaUnits = estimateGenerationQuota({
    kind: "video",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    durationSeconds: input.duration,
    referenceImages: input.files.length,
  });
  const billingFingerprint = generationBillingFingerprint({
    kind: "video",
    providerId: input.providerId,
    mode: input.mode,
    ratio: input.ratio,
    durationSeconds: input.duration,
    referenceImages: input.files.length,
    taskId: input.billingTaskId || "",
    estimatedQuotaUnits,
  });
  try {
    const readyProvider = await assertVideoRequestReady(input);
    await claimGenerationBillingDispatch({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      idempotencyKey: input.billingIdempotencyKey,
      fingerprint: billingFingerprint,
      estimatedQuotaUnits,
    });
    await markGenerationProviderStarted({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      upstreamModel: readyProvider.model,
    });

    let output: ProviderOutput;
    if (isGrokVideoProvider(readyProvider)) {
      output = await callGrokVideoProvider(readyProvider, input);
    } else {
      const providerVideoOptions = videoOptionsForProvider(readyProvider);
      const resolution = providerVideoOptions?.resolution || "720p";
      const providerPayload: Record<string, string | number | string[]> = {
        model: readyProvider.model,
        prompt: input.prompt,
        duration: input.duration,
        seconds: input.duration,
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
          referenceImages: input.files.length,
          ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
          ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
          billingEstimatedQuotaUnits: estimatedQuotaUnits,
          billingRequestFingerprint: billingFingerprint,
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
        referenceImages: input.files.length,
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
    if (!(error instanceof BillingSettlementRequiredError) && !(error instanceof BillingDispatchRejectedError)) {
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

export async function refreshVideoJob(jobId: string, localUserId?: string | null) {
  const { readJobs } = await import("./library");
  const job = (await readJobs()).find((item) => item.id === jobId);
  if (!job) throw new Error("任务不存在。");
  const jobOwner = job.ownerLocalUserId || job.billing_local_user_id || null;
  if (localUserId && jobOwner && jobOwner !== localUserId) {
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

  const response = await fetch(job.statusUrl, {
    method: "GET",
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(60000),
  });
  const output = parseProviderOutput(await readProviderJson(response, provider));
  const status = normalizeStatus(output.status || "");

  if (normalizeStatus(output.status || "") === "failed") {
    const reason = output.error || output.status || "generation failed";
    await updateLibraryItem(job.libraryItemId, {
      status: "failed",
      error: reason,
    });
    await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "failed",
      reason,
      upstreamRequestId: output.jobId || null,
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || job.id,
    });
    return updateJob(job.id, {
      status: "failed",
      billing_state: job.billing_task_id ? job.billing_state || "prechecked" : job.billing_state,
      billing_last_error: reason,
      error: reason,
    });
  }

  if (output.url) {
    const outputUrl = absolutizeProviderUrl(provider, output.url);
    const stored = outputUrl.includes("/content")
      ? await outputToLibraryFromAuthenticatedUrl(provider, outputUrl, "video")
      : await outputToLibrary({ ...output, url: outputUrl }, "video", "video");
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      output: stored,
      ownerLocalUserId: job.ownerLocalUserId || job.billing_local_user_id || localUserId || null,
    } satisfies Partial<LibraryItem>);
    const updated = await updateJob(job.id, {
      status: "done",
      sourceUrl: outputUrl,
      billing_state: job.billing_task_id ? "settled" : job.billing_state,
      billing_last_error: null,
    });
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
    }
    return updated;
  }

  if (isGrokVideoProvider(provider) && status === "done" && !output.url) {
    const contentUrl = `${job.statusUrl.replace(/\/$/, "")}/content`;
    const stored = await outputToLibraryFromAuthenticatedUrl(provider, contentUrl, "video");
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      output: stored,
      ownerLocalUserId: job.ownerLocalUserId || job.billing_local_user_id || localUserId || null,
    } satisfies Partial<LibraryItem>);
    const updated = await updateJob(job.id, {
      status: "done",
      sourceUrl: contentUrl,
      billing_state: job.billing_task_id ? "settled" : job.billing_state,
      billing_last_error: null,
    });
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
    }
    return updated;
  }

  if (status === "failed") {
    await updateLibraryItem(job.libraryItemId, {
      status: "failed",
      error: "视频生成任务失败。",
    });
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
  }
  return updateJob(job.id, {
    status,
    billing_state: job.billing_task_id ? job.billing_state || "prechecked" : job.billing_state,
  });
}

export async function uploadedMediaFromForm(form: FormData, fieldName = "files") {
  const files = form.getAll(fieldName).filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 10) throw new Error("最多上传 10 张参考图片。");
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  for (const file of files) {
    if (!allowedTypes.has(file.type)) throw new Error("参考图片只支持 PNG、JPEG 和 WebP。");
    if (file.size > 10 * 1024 * 1024) throw new Error("单张参考图片不能超过 10MB。");
  }
  return Promise.all(files.map(async (file) => ({
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type || "application/octet-stream",
    fileName: file.name || "reference.png",
  })));
}
