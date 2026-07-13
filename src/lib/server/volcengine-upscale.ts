import { createHash, createHmac, randomUUID } from "node:crypto";
import { extname } from "node:path";

import {
  estimateUpscaleQuota,
  upscaleBillingFingerprint,
} from "../generation-quota";
import {
  addJob,
  addLibraryItem,
  readJobs,
  readLibrary,
  storeRemoteUrl,
  updateJob,
  updateLibraryItem,
} from "./library";
import { codeForUpstreamStatus, GenerationDiagnosticError } from "./error-diagnostics";
import { assertFileFormatAllowed, assertFileSizeAllowed, publicUploadLimits } from "./media-upload-guard";
import { providerById } from "./providers";
import { getTaskBillingService } from "./quota";
import { assertStorageAllows } from "./storage-capacity";
import { type JobRecord, type ProviderConfig } from "./types";

export type UploadedUpscaleFile = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type TargetScale = 1 | 2 | 4;

type UpscaleKind = "image" | "video";

type UpscaleBillingInput = {
  billingLocalUserId?: string | null;
  billingTaskId?: string | null;
  billingIdempotencyKey?: string | null;
};

class UpscaleBillingSettlementRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpscaleBillingSettlementRequiredError";
  }
}

class UpscaleBillingDispatchRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpscaleBillingDispatchRejectedError";
  }
}

type VolcanoCredential = {
  accessKeyId: string;
  secretAccessKey: string;
};

const imagexDefaultEndpoint = "https://imagex.volcengineapi.com";
const vodDefaultEndpoint = "https://vod.volcengineapi.com";
const defaultRegion = "cn-north-1";
const imagexServiceName = "imagex";
const vodServiceName = "vod";
const imageUploadHostTimeoutMs = 90 * 1000;
const defaultUploadHostTimeoutMs = 30 * 60 * 1000;
const imageProcessRetryDelaysMs = [2_000, 5_000, 10_000];
const videoUploadRetryDelaysMs = [5_000, 15_000];
const resultDownloadRetryDelaysMs = [2_000, 5_000, 10_000];
let imageProcessQueue = Promise.resolve();

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function transientProviderError(error: unknown) {
  if (error instanceof GenerationDiagnosticError) {
    return ["PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK_ERROR", "PROVIDER_UPSTREAM_5XX"].includes(error.code);
  }
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /abort|timeout|timed out|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|socket|TLS|certificate/i.test(message);
}

async function retryTransientProviderCall<T>(
  action: (attempt: number) => Promise<T>,
  delaysMs: readonly number[],
  sleep: (delayMs: number) => Promise<void> = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      const retryDelayMs = delaysMs[attempt - 1];
      if (retryDelayMs === undefined || !transientProviderError(error)) throw error;
      console.warn(JSON.stringify({
        event: "upscale_provider_retry",
        attempt,
        nextAttempt: attempt + 1,
        delayMs: retryDelayMs,
        code: error instanceof GenerationDiagnosticError ? error.code : "PROVIDER_NETWORK_ERROR",
      }));
      await sleep(retryDelayMs);
    }
  }
}

async function serializeImageProcess<T>(action: () => Promise<T>) {
  const previous = imageProcessQueue;
  let release: () => void;
  imageProcessQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release!();
  }
}

export function defaultImagexOutputDomain(serviceId: string, region: string) {
  const normalizedServiceId = serviceId.trim();
  const normalizedRegion = region.trim();
  if (!normalizedServiceId || !normalizedRegion) return "";
  return `${normalizedServiceId}.veimagex-pub.${normalizedRegion}.volces.com`;
}

function defaultImagexUploadHost(serviceId: string) {
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) return "";
  return `${normalizedServiceId}.up.imagex-accelerate.volces.com`;
}

function imagexWorkflowTemplateId() {
  const configured = env("VOLCENGINE_IMAGEX_WORKFLOW_TEMPLATE_ID", "system_workflow_sr").trim();
  if (!configured || configured === "system_workflow_ai_super_resolution") return "system_workflow_sr";
  return configured;
}

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

function collectStrings(value: unknown, output: string[] = []) {
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
}

function parseJsonString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function targetLabel(scale: TargetScale) {
  if (scale === 4) return "4K";
  if (scale === 2) return "2K";
  return "1K";
}

function upscaleBillingEstimate(kind: UpscaleKind, scale: TargetScale) {
  return estimateUpscaleQuota({ kind, scale });
}

function upscaleBillingRequestFingerprint(kind: UpscaleKind, scale: TargetScale, taskId: string, estimatedQuotaUnits: number) {
  return upscaleBillingFingerprint({
    kind,
    scale,
    taskId,
    estimatedQuotaUnits,
  });
}

function invalidUpscalePrecheck() {
  return new GenerationDiagnosticError({
    code: "INPUT_INVALID_PARAMETERS",
    publicMessage: "额度预检已失效，请刷新后重新提交。",
  });
}

async function claimUpscaleBillingDispatch(input: {
  kind: UpscaleKind;
  scale: TargetScale;
  billing: UpscaleBillingInput;
}) {
  const localUserId = input.billing.billingLocalUserId || "";
  const taskId = input.billing.billingTaskId || "";
  const idempotencyKey = input.billing.billingIdempotencyKey || "";
  if (!localUserId || !taskId || !idempotencyKey) throw invalidUpscalePrecheck();
  const estimatedQuotaUnits = upscaleBillingEstimate(input.kind, input.scale);
  const claimed = await getTaskBillingService().claimProviderDispatch({
    localUserId,
    taskId,
    idempotencyKey,
    estimatedQuotaUnits,
    requestFingerprint: upscaleBillingRequestFingerprint(input.kind, input.scale, taskId, estimatedQuotaUnits),
  });
  if (!claimed.ok) throw new UpscaleBillingDispatchRejectedError(claimed.message);
  if (claimed.action !== "dispatching") throw new UpscaleBillingDispatchRejectedError("高清增强任务无法领取上游派发权限。");
  return estimatedQuotaUnits;
}

async function markUpscaleProviderStarted(input: {
  billing: UpscaleBillingInput;
  upstreamModel?: string | null;
}) {
  if (!input.billing.billingLocalUserId || !input.billing.billingTaskId) return;
  const result = await getTaskBillingService().markProviderStarted({
    localUserId: input.billing.billingLocalUserId,
    taskId: input.billing.billingTaskId,
    upstreamModel: input.upstreamModel || null,
  });
  if (!result.ok) throw new UpscaleBillingDispatchRejectedError(result.message);
}

async function acceptUpscaleBilling(input: {
  billing: UpscaleBillingInput;
  newApiTaskId?: string | null;
  upstreamModel?: string | null;
}) {
  if (!input.billing.billingLocalUserId || !input.billing.billingTaskId) return;
  const result = await getTaskBillingService().accept({
    localUserId: input.billing.billingLocalUserId,
    taskId: input.billing.billingTaskId,
    newApiTaskId: input.newApiTaskId || null,
    upstreamModel: input.upstreamModel || null,
  });
  if (!result.ok) throw new UpscaleBillingSettlementRequiredError(result.message);
}

async function settleUpscaleBilling(input: {
  billing: UpscaleBillingInput;
  estimatedQuotaUnits: number;
  outcome: "success" | "failed";
  reason?: string | null;
  newApiTaskId?: string | null;
  upstreamModel?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; message: string; action?: string }> {
  if (!input.billing.billingLocalUserId || !input.billing.billingTaskId) return { ok: true };
  try {
    if (input.outcome === "success") {
      const result = await getTaskBillingService().settleSuccess({
        localUserId: input.billing.billingLocalUserId,
        taskId: input.billing.billingTaskId,
        actualQuotaUnits: input.estimatedQuotaUnits,
        newApiTaskId: input.newApiTaskId || null,
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
      const result = await getTaskBillingService().fail({
        localUserId: input.billing.billingLocalUserId,
        taskId: input.billing.billingTaskId,
        reason: input.reason || "upscale failed",
        newApiTaskId: input.newApiTaskId || null,
        upstreamModel: input.upstreamModel || null,
      });
      if (!result.ok) return { ok: false, status: result.status, message: result.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 503, message: "Task billing settlement failed." };
  }
}

function videoTemplateId(scale: TargetScale) {
  if (scale === 4) return env("VOLCENGINE_VOD_TEMPLATE_4K", "feabc25e361e4c81b18849db2b206df3");
  if (scale === 2) return env("VOLCENGINE_VOD_TEMPLATE_2K", "966dad4845f24f1d8b3e4a5b68a88af2");
  return env("VOLCENGINE_VOD_TEMPLATE_1K", "d6743c0cf75742719f74e0d5ad2c9ed6");
}

function fileExtension(file: UploadedUpscaleFile) {
  if (file.mimeType === "image/png") return "png";
  if (file.mimeType === "image/webp") return "webp";
  if (file.mimeType === "video/webm") return "webm";
  if (file.mimeType === "video/quicktime") return "mov";
  if (file.mimeType === "video/mp4") return "mp4";
  const extension = extname(file.fileName).replace(/^\./, "").toLowerCase();
  return extension || (file.mimeType.startsWith("video/") ? "mp4" : "jpg");
}

function contentDispositionFileName(file: UploadedUpscaleFile) {
  const extension = fileExtension(file);
  const baseName = file.fileName
    .replace(/\.[^./\\]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "upload";
  return `${baseName}.${extension}`;
}

function contentDispositionHeader(file: UploadedUpscaleFile) {
  return `attachment; filename="${contentDispositionFileName(file)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
}

function parseCredential(provider: ProviderConfig | null): VolcanoCredential | null {
  const combined = (provider?.apiKey || env("VOLCENGINE_ACCESS_KEY_PAIR") || "").trim();
  const split = combined.split(/[:|,\s]+/).map((part) => part.trim()).filter(Boolean);
  const accessKeyId = split[0] || env("VOLCENGINE_ACCESS_KEY_ID") || env("VOLC_ACCESSKEY");
  const secretAccessKey = split[1] || env("VOLCENGINE_SECRET_ACCESS_KEY") || env("VOLC_SECRETKEY");
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey };
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function formatXDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeQuery(value: string) {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params: Record<string, string | number | boolean | undefined>) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => {
      const text = String(value ?? "");
      return `${encodeQuery(key)}=${encodeQuery(text)}`;
    })
    .sort()
    .join("&");
}

let crc32Table: Uint32Array | null = null;

function crc32Hex(buffer: Buffer) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      crc32Table[index] = value >>> 0;
    }
  }

  let crc = 0 ^ -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, "0");
}

async function openapiRequest<T>({
  endpoint,
  service,
  region = defaultRegion,
  credential,
  method,
  query,
  body,
  timeoutMs = 180000,
}: {
  endpoint: string;
  service: string;
  region?: string;
  credential: VolcanoCredential;
  method: "GET" | "POST";
  query: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const url = new URL(endpoint);
  const bodyText = body ? JSON.stringify(body) : "";
  const xDate = formatXDate();
  const shortDate = xDate.slice(0, 8);
  const bodySha = sha256(bodyText);
  const signedHeaders = method === "POST"
    ? "content-type;host;x-content-sha256;x-date"
    : "host;x-content-sha256;x-date";
  const canonicalHeaders = method === "POST"
    ? [
      "content-type:application/json",
      `host:${url.host}`,
      `x-content-sha256:${bodySha}`,
      `x-date:${xDate}`,
    ].join("\n")
    : [
      `host:${url.host}`,
      `x-content-sha256:${bodySha}`,
      `x-date:${xDate}`,
    ].join("\n");
  const canonicalRequest = [
    method,
    url.pathname || "/",
    canonicalQuery(query),
    canonicalHeaders,
    "",
    signedHeaders,
    bodySha,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const kDate = hmac(credential.secretAccessKey, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "request");
  const signature = hmacHex(kSigning, stringToSign);
  const headers: Record<string, string> = {
    Authorization: `HMAC-SHA256 Credential=${credential.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "X-Content-Sha256": bodySha,
    "X-Date": xDate,
  };
  if (method === "POST") headers["Content-Type"] = "application/json";
  url.search = canonicalQuery(query);

  const response = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? bodyText : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => "");
  let payload: unknown;
  try {
    payload = text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_NON_JSON_RESPONSE",
      upstreamStatus: response.status,
      safeDetails: {
        service,
        upstreamStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
      cause: error,
    });
  }
  const metadata = asRecord(asRecord(payload).ResponseMetadata);
  const error = asRecord(metadata.Error);
  if (!response.ok || Object.keys(error).length) {
    const message = firstString(error.Message, error.message, asRecord(payload).message)
      || `火山接口请求失败：HTTP ${response.status}`;
    throw new GenerationDiagnosticError({
      code: codeForUpstreamStatus(response.status || 502),
      message,
      upstreamStatus: response.status,
      safeDetails: {
        service,
        action: query.Action,
        upstreamStatus: response.status,
        errorCode: firstString(error.Code, error.code),
      },
    });
  }
  return payload as T;
}

function imageConfig(provider: ProviderConfig | null) {
  const credential = parseCredential(provider);
  const region = env("VOLCENGINE_REGION", defaultRegion);
  const serviceId = provider?.model || env("VOLCENGINE_IMAGEX_SERVICE_ID");
  return {
    credential,
    endpoint: provider?.apiUrl || env("VOLCENGINE_IMAGEX_ENDPOINT", imagexDefaultEndpoint),
    region,
    serviceId,
    uploadHost: env("VOLCENGINE_IMAGEX_UPLOAD_HOST") || defaultImagexUploadHost(serviceId),
    outputDomain: env("VOLCENGINE_IMAGEX_OUTPUT_DOMAIN") || defaultImagexOutputDomain(serviceId, region),
    outputTpl: env("VOLCENGINE_IMAGEX_OUTPUT_TPL"),
    workflowTemplateId: imagexWorkflowTemplateId(),
    modelId: env("VOLCENGINE_IMAGEX_MODEL_ID", "ai_sr_model_v2"),
  };
}

function videoConfig(provider: ProviderConfig | null) {
  const credential = parseCredential(provider);
  const spaceName = provider?.model || env("VOLCENGINE_VOD_SPACE_NAME");
  return {
    credential,
    endpoint: provider?.apiUrl || env("VOLCENGINE_VOD_ENDPOINT", vodDefaultEndpoint),
    region: env("VOLCENGINE_REGION", defaultRegion),
    spaceName,
    outputDomain: env("VOLCENGINE_VOD_OUTPUT_DOMAIN"),
    scene: env("VOLCENGINE_VOD_ENHANCE_SCENE", "common"),
  };
}

function providerReady(provider: ProviderConfig | null, kind: "image" | "video") {
  if (!provider?.enabled) return { ready: false, detail: kind === "image" ? "图片高清增强供应商未启用。" : "视频高清增强供应商未启用。" };
  if (kind === "image") {
    const config = imageConfig(provider);
    if (!config.credential) return { ready: false, detail: "图片高清增强缺少火山 AK/SK，请在后台 API Key 填 AK:SK。" };
    if (!config.serviceId) return { ready: false, detail: "图片高清增强缺少 ImageX ServiceId，请填在模型字段或 VOLCENGINE_IMAGEX_SERVICE_ID。" };
    if (!config.outputDomain) return { ready: false, detail: "图片高清增强缺少 VOLCENGINE_IMAGEX_OUTPUT_DOMAIN，请先在火山 ImageX 绑定输出域名。" };
    return { ready: true, detail: "火山 ImageX 图片高清增强已配置。" };
  }
  const config = videoConfig(provider);
  if (!config.credential) return { ready: false, detail: "视频高清增强缺少火山 AK/SK，请在后台 API Key 填 AK:SK。" };
  if (!config.spaceName) return { ready: false, detail: "视频高清增强缺少 VOD SpaceName，请填在模型字段或 VOLCENGINE_VOD_SPACE_NAME。" };
  return { ready: true, detail: "火山 VOD 视频高清增强已配置。" };
}

export async function readUpscaleStatus() {
  const [imageProvider, videoProvider] = await Promise.all([
    providerById("image-upscale"),
    providerById("video-upscale"),
  ]);
  return {
    image: providerReady(imageProvider, "image"),
    video: providerReady(videoProvider, "video"),
    uploadLimits: {
      imageUpscale: publicUploadLimits().imageUpscale,
      videoUpscale: publicUploadLimits().videoUpscale,
    },
  };
}

async function uploadByAddress(
  file: UploadedUpscaleFile,
  uploadHost: string,
  storeUri: string,
  auth: string,
  timeoutMs = defaultUploadHostTimeoutMs,
) {
  const url = `https://${uploadHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/upload/v1/${storeUri.replace(/^\/+/, "")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDispositionHeader(file),
      "Content-Crc32": crc32Hex(file.bytes),
      "Content-Length": String(file.bytes.length),
    },
    body: new Uint8Array(file.bytes),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new GenerationDiagnosticError({
      code: codeForUpstreamStatus(response.status),
      upstreamStatus: response.status,
      safeDetails: { step: "provider-upload", upstreamStatus: response.status },
    });
  }
}

function readImageDimensions(bytes: Buffer) {
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const value = bytes.readUInt32LE(21);
      return { width: 1 + (value & 0x3fff), height: 1 + ((value >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

async function uploadImageToImagex(file: UploadedUpscaleFile, config: ReturnType<typeof imageConfig>) {
  if (!config.credential) throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY" });
  if (!config.serviceId) throw new GenerationDiagnosticError({ code: "MODEL_MISSING_IMAGE_UPSCALE" });
  const extension = fileExtension(file);
  const storeKey = `upscale/${randomUUID()}.${extension}`;
  const apply = await openapiRequest<{
    Result?: {
      UploadAddress?: {
        StoreInfos?: Array<{ StoreUri?: string; Auth?: string }>;
        UploadHosts?: string[];
        SessionKey?: string;
      };
    };
  }>({
    endpoint: config.endpoint,
    service: imagexServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "ApplyImageUpload",
      Version: "2018-08-01",
      ServiceId: config.serviceId,
      UploadNum: 1,
      StoreKeys: storeKey,
      ...(config.uploadHost ? { UploadHost: config.uploadHost } : {}),
    },
  });
  const address = apply.Result?.UploadAddress;
  const storeInfo = address?.StoreInfos?.[0];
  const uploadHosts = uniqueStrings([
    config.uploadHost,
    ...(address?.UploadHosts || []),
  ]);
  if (!storeInfo?.StoreUri || !storeInfo.Auth || !uploadHosts.length || !address?.SessionKey) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_BAD_RESPONSE", safeDetails: { service: imagexServiceName, step: "apply-upload" } });
  }
  const imageSessionKey = address.SessionKey;
  let lastUploadError: unknown = null;
  for (const host of uploadHosts) {
    try {
      await uploadByAddress(file, host, storeInfo.StoreUri, storeInfo.Auth, imageUploadHostTimeoutMs);
      lastUploadError = null;
      break;
    } catch (error) {
      lastUploadError = error;
      console.warn(JSON.stringify({
        event: "imagex_upload_host_failed",
        host,
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
  if (lastUploadError) {
    throw new GenerationDiagnosticError({
      code: "PROVIDER_NETWORK_ERROR",
      cause: lastUploadError,
      safeDetails: {
        service: imagexServiceName,
        step: "upload",
        uploadHostsTried: uploadHosts.length,
      },
    });
  }
  await openapiRequest({
    endpoint: config.endpoint,
    service: imagexServiceName,
    region: config.region,
    credential: config.credential,
    method: "POST",
    query: {
      Action: "CommitImageUpload",
      Version: "2018-08-01",
      ServiceId: config.serviceId,
      SkipMeta: true,
    },
    body: {
      SessionKey: imageSessionKey,
      SuccessOids: [storeInfo.StoreUri],
    },
  }).catch(() => undefined);
  return storeKey;
}

async function imageResourceUrl(objectKey: string, config: ReturnType<typeof imageConfig>) {
  if (!config.credential) throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY" });
  if (!config.serviceId) throw new GenerationDiagnosticError({ code: "MODEL_MISSING_IMAGE_UPSCALE" });
  if (!config.outputDomain) {
    throw new GenerationDiagnosticError({ code: "RESULT_ASSET_MISSING", safeDetails: { missing: "VOLCENGINE_IMAGEX_OUTPUT_DOMAIN" } });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const response = await openapiRequest<{
    Result?: {
      URL?: string;
      url?: string;
      ObjURL?: string;
      obj_url?: string;
    };
  }>({
    endpoint: config.endpoint,
    service: imagexServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "GetResourceURL",
      Version: "2023-05-01",
      ServiceId: config.serviceId,
      Domain: config.outputDomain,
      URI: objectKey,
      Proto: "http",
      Timestamp: expiresAt,
      ...(config.outputTpl ? { Tpl: config.outputTpl } : {}),
    },
  });
  const result = response.Result || {};
  const urls = collectStrings(result)
    .filter((value) => /^https?:\/\//i.test(value))
    .sort((left, right) => Number(right.includes("sign=")) - Number(left.includes("sign=")));
  return firstString(...urls, result.URL, result.url, result.ObjURL, result.obj_url);
}

function imagexPublicResourceUrl(objectKey: string, config: ReturnType<typeof imageConfig>) {
  if (!config.outputDomain || !config.serviceId || !objectKey) return "";
  const tpl = config.outputTpl || `tplv-${config.serviceId}-image`;
  const suffix = tpl.endsWith(".image") ? tpl : `${tpl}.image`;
  return `http://${config.outputDomain}/${objectKey}~${suffix}`;
}

export async function upscaleImage(
  file: UploadedUpscaleFile,
  scale: TargetScale,
  ownerLocalUserId?: string | null,
  billing: UpscaleBillingInput = {},
) {
  const billingContext = {
    ...billing,
    billingLocalUserId: billing.billingLocalUserId || ownerLocalUserId || null,
  };
  let provider: ProviderConfig | null = null;
  let estimatedQuotaUnits = upscaleBillingEstimate("image", scale);
  try {
    await assertStorageAllows("image-upscale");
    provider = await providerById("image-upscale");
    const status = providerReady(provider, "image");
    if (!provider) throw new GenerationDiagnosticError({ code: "PROVIDER_NOT_CONFIGURED" });
    if (provider.endpointType !== "volcengine-imagex-upscale" || !status.ready) {
      throw new GenerationDiagnosticError({
        code: provider.enabled ? "PROVIDER_HEALTH_CHECK_FAILED" : "PROVIDER_DISABLED",
        providerId: provider.id,
        model: provider.model,
        safeDetails: { detail: status.detail },
      });
    }
    estimatedQuotaUnits = await claimUpscaleBillingDispatch({ kind: "image", scale, billing: billingContext });
    await markUpscaleProviderStarted({ billing: billingContext, upstreamModel: provider.model });
    const config = imageConfig(provider);
    const inputKey = await uploadImageToImagex(file, config);
    const workflowParameter = JSON.stringify({
      Input: {
        ObjectKey: inputKey.replace(/^tos-[^/]+\//, ""),
        DataType: "uri",
      },
      SrParam: {
        Mode: 0,
        Multiple: Math.max(1, scale),
        ShortMin: 16,
        ShortMax: 1440,
        LongMin: 16,
        LongMax: 2160,
        Policy: 0,
        SharpRatio: 1.0,
        DenoiseRatio: 0.7,
      },
    });
    const processed = await serializeImageProcess(() => retryTransientProviderCall(() => openapiRequest<{
      Result?: { Output?: string };
    }>({
      endpoint: config.endpoint,
      service: imagexServiceName,
      region: config.region,
      credential: config.credential!,
      method: "POST",
      query: {
        Action: "AIProcess",
        Version: "2023-05-01",
      },
      body: {
        ServiceId: config.serviceId,
        WorkflowTemplateId: config.workflowTemplateId,
        WorkflowParameter: workflowParameter,
      },
      timeoutMs: 10 * 60 * 1000,
    }), imageProcessRetryDelaysMs));
    const output = parseJsonString(processed.Result?.Output);
    const objectKey = firstString(output.ObjectKey, output.objectKey, output.URI, output.Uri);
    if (!objectKey) throw new GenerationDiagnosticError({ code: "PROVIDER_BAD_RESPONSE", providerId: provider.id, model: provider.model });
    const fullObjectKey = objectKey.startsWith("tos-") ? objectKey : `tos-cn-i-${config.serviceId}/${objectKey}`;
    const outputUris = uniqueStrings([fullObjectKey, objectKey, objectKey.replace(/^tos-[^/]+\//, "")]);
    const outputUrls = uniqueStrings((await Promise.all(outputUris.map(async (uri) => [
      await imageResourceUrl(uri, config).catch((error) => {
        console.warn(JSON.stringify({
          event: "imagex_resource_url_failed",
          uriKind: uri === objectKey ? "raw" : "compact",
          error: error instanceof Error ? error.message : "unknown",
        }));
        return "";
      }),
      imagexPublicResourceUrl(uri, config),
    ]))).flat());
    let outputUrl = "";
    let stored: Awaited<ReturnType<typeof storeRemoteUrl>> | null = null;
    let lastStoreError: unknown = null;
    for (const candidateUrl of outputUrls) {
      try {
        stored = await retryTransientProviderCall(
          () => storeRemoteUrl(candidateUrl, "image-upscale", "image/png"),
          resultDownloadRetryDelaysMs,
        );
        outputUrl = candidateUrl;
        break;
      } catch (error) {
        lastStoreError = error;
        const parsed = new URL(candidateUrl);
        console.warn(JSON.stringify({
          event: "imagex_resource_download_failed",
          host: parsed.host,
          hasSign: parsed.searchParams.has("sign"),
          hasTosPrefix: parsed.pathname.includes("/tos-cn-"),
          error: error instanceof Error ? error.message : "unknown",
        }));
      }
    }
    if (!stored && lastStoreError) throw lastStoreError;
    if (!stored || !outputUrl) throw new GenerationDiagnosticError({ code: "RESULT_ASSET_MISSING", providerId: provider.id, model: provider.model });
    const sourceDimensions = readImageDimensions(file.bytes);
    const item = await addLibraryItem({
      ownerLocalUserId: ownerLocalUserId || null,
      type: "image",
      mode: "image-upscale",
      title: `图片高清增强 ${targetLabel(scale)}`,
      prompt: file.fileName,
      providerId: provider.id,
      model: provider.model,
      status: "done",
      output: stored,
      params: {
        scale,
        target: targetLabel(scale),
        sourceName: file.fileName,
        volcObjectKey: objectKey,
        ...(billingContext.billingTaskId ? { billingTaskId: billingContext.billingTaskId } : {}),
        ...(billingContext.billingIdempotencyKey ? { billingIdempotencyKey: billingContext.billingIdempotencyKey } : {}),
        billingEstimatedQuotaUnits: estimatedQuotaUnits,
        ...(billingContext.billingTaskId ? {
          billingRequestFingerprint: upscaleBillingRequestFingerprint("image", scale, billingContext.billingTaskId, estimatedQuotaUnits),
        } : {}),
        ...(sourceDimensions ? {
          sourceWidth: sourceDimensions.width,
          sourceHeight: sourceDimensions.height,
        } : {}),
      },
    });
    await acceptUpscaleBilling({
      billing: billingContext,
      newApiTaskId: item.id,
      upstreamModel: provider.model,
    });
    const settled = await settleUpscaleBilling({
      billing: billingContext,
      estimatedQuotaUnits,
      outcome: "success",
      newApiTaskId: item.id,
      upstreamModel: provider.model,
    });
    if (!settled.ok) {
      throw new UpscaleBillingSettlementRequiredError(settled.status === 202 ? "高清增强已完成，但计费结算需要人工对账。" : settled.message);
    }
    return item;
  } catch (error) {
    if (!(error instanceof UpscaleBillingSettlementRequiredError) && !(error instanceof UpscaleBillingDispatchRejectedError)) {
      await settleUpscaleBilling({
        billing: billingContext,
        estimatedQuotaUnits,
        outcome: "failed",
        reason: error instanceof Error ? error.message : "upscale failed",
        upstreamModel: provider?.model || null,
      });
    }
    throw error;
  }
}

async function uploadVideoToVod(file: UploadedUpscaleFile, config: ReturnType<typeof videoConfig>) {
  if (!config.credential) throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY" });
  if (!config.spaceName) throw new GenerationDiagnosticError({ code: "MODEL_MISSING_VIDEO_UPSCALE" });
  const extension = `.${fileExtension(file)}`;
  const apply = await openapiRequest<{
    Result?: {
      Data?: {
        UploadAddress?: {
          StoreInfos?: Array<{ StoreUri?: string; Auth?: string }>;
          UploadHosts?: string[];
          SessionKey?: string;
        };
      };
    };
  }>({
    endpoint: config.endpoint,
    service: vodServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "ApplyUploadInfo",
      Version: "2022-01-01",
      SpaceName: config.spaceName,
      FileType: "media",
      FileExtension: extension,
      FileSize: file.bytes.length,
    },
  });
  const address = apply.Result?.Data?.UploadAddress;
  const storeInfo = address?.StoreInfos?.[0];
  const host = address?.UploadHosts?.[0];
  if (!storeInfo?.StoreUri || !storeInfo.Auth || !host || !address?.SessionKey) {
    throw new GenerationDiagnosticError({ code: "PROVIDER_BAD_RESPONSE", safeDetails: { service: vodServiceName, step: "apply-upload" } });
  }
  const videoSessionKey = address.SessionKey;
  await uploadByAddress(file, host, storeInfo.StoreUri, storeInfo.Auth);
  const commit = await openapiRequest<{
    Result?: {
      Data?: {
        Vid?: string;
        SourceInfo?: Record<string, unknown>;
      };
    };
  }>({
    endpoint: config.endpoint,
    service: vodServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "CommitUploadInfo",
      Version: "2022-01-01",
      SpaceName: config.spaceName,
      SessionKey: videoSessionKey,
      GetMetaMode: 1,
    },
  });
  const data = commit.Result?.Data;
  if (!data?.Vid) throw new GenerationDiagnosticError({ code: "PROVIDER_BAD_RESPONSE", safeDetails: { service: vodServiceName, step: "commit-upload" } });
  return { ...data, Vid: data.Vid };
}

export async function submitVideoUpscale(
  file: UploadedUpscaleFile,
  scale: TargetScale,
  ownerLocalUserId?: string | null,
  billing: UpscaleBillingInput = {},
) {
  const billingContext = {
    ...billing,
    billingLocalUserId: billing.billingLocalUserId || ownerLocalUserId || null,
  };
  let provider: ProviderConfig | null = null;
  let estimatedQuotaUnits = upscaleBillingEstimate("video", scale);
  let runId: string | null = null;
  try {
    await assertStorageAllows("video-upscale", { fresh: true });
    provider = await providerById("video-upscale");
    const status = providerReady(provider, "video");
    if (!provider) throw new GenerationDiagnosticError({ code: "PROVIDER_NOT_CONFIGURED" });
    if (provider.endpointType !== "volcengine-vod-upscale" || !status.ready) {
      throw new GenerationDiagnosticError({
        code: provider.enabled ? "PROVIDER_HEALTH_CHECK_FAILED" : "PROVIDER_DISABLED",
        providerId: provider.id,
        model: provider.model,
        safeDetails: { detail: status.detail },
      });
    }
    estimatedQuotaUnits = await claimUpscaleBillingDispatch({ kind: "video", scale, billing: billingContext });
    await markUpscaleProviderStarted({ billing: billingContext, upstreamModel: provider.model });
    const config = videoConfig(provider);
    const uploaded = await retryTransientProviderCall(
      () => uploadVideoToVod(file, config),
      videoUploadRetryDelaysMs,
    );
    const vid = uploaded.Vid;
    const sourceInfo = asRecord(uploaded.SourceInfo);
    const start = await openapiRequest<{ Result?: { RunId?: string } }>({
      endpoint: config.endpoint,
      service: vodServiceName,
      region: config.region,
      credential: config.credential!,
      method: "POST",
      query: {
        Action: "StartExecution",
        Version: "2025-01-01",
      },
      body: {
        Input: {
          Type: "Vid",
          Vid: vid,
        },
        Operation: {
          Type: "Template",
          Template: {
            Type: "Enhance",
            Enhance: {
              TemplateId: videoTemplateId(scale),
            },
          },
        },
        Control: {
          ClientToken: randomUUID(),
        },
      },
    });
    runId = start.Result?.RunId || null;
    if (!runId) {
      throw new GenerationDiagnosticError({
        code: "PROVIDER_BAD_RESPONSE",
        providerId: provider.id,
        model: provider.model,
        safeDetails: { service: vodServiceName, step: "start-execution" },
      });
    }
    const item = await addLibraryItem({
      ownerLocalUserId: ownerLocalUserId || null,
      type: "video",
      mode: "video-upscale",
      title: `视频高清增强 ${targetLabel(scale)}`,
      prompt: file.fileName,
      providerId: provider.id,
      model: provider.model,
      status: "generating",
      params: {
        scale,
        target: targetLabel(scale),
        sourceName: file.fileName,
        volcVid: vid,
        volcRunId: runId,
        volcTemplateId: videoTemplateId(scale),
        ...(billingContext.billingTaskId ? { billingTaskId: billingContext.billingTaskId } : {}),
        ...(billingContext.billingIdempotencyKey ? { billingIdempotencyKey: billingContext.billingIdempotencyKey } : {}),
        billingEstimatedQuotaUnits: estimatedQuotaUnits,
        ...(billingContext.billingTaskId ? {
          billingRequestFingerprint: upscaleBillingRequestFingerprint("video", scale, billingContext.billingTaskId, estimatedQuotaUnits),
        } : {}),
        ...(typeof sourceInfo.Width === "number" ? { sourceWidth: sourceInfo.Width } : {}),
        ...(typeof sourceInfo.Height === "number" ? { sourceHeight: sourceInfo.Height } : {}),
        ...(typeof sourceInfo.Duration === "number" ? { sourceDuration: sourceInfo.Duration } : {}),
      },
    });
    const job = await addJob({
      id: runId,
      libraryItemId: item.id,
      type: "video",
      ownerLocalUserId: ownerLocalUserId || null,
      providerId: provider.id,
      status: "generating",
      statusUrl: "volcengine:vod:GetExecution",
      sourceUrl: vid,
      billing_task_id: billingContext.billingTaskId || null,
      billing_local_user_id: billingContext.billingLocalUserId || null,
      billing_idempotency_key: billingContext.billingIdempotencyKey || null,
      billing_estimated_quota_units: estimatedQuotaUnits,
      billing_state: billingContext.billingTaskId ? "accepted" : undefined,
      billing_last_error: null,
    });
    await acceptUpscaleBilling({
      billing: billingContext,
      newApiTaskId: runId,
      upstreamModel: provider.model,
    });
    return { item, job };
  } catch (error) {
    if (!(error instanceof UpscaleBillingSettlementRequiredError) && !(error instanceof UpscaleBillingDispatchRejectedError)) {
      await settleUpscaleBilling({
        billing: billingContext,
        estimatedQuotaUnits,
        outcome: "failed",
        reason: error instanceof Error ? error.message : "upscale failed",
        newApiTaskId: runId,
        upstreamModel: provider?.model || null,
      });
    }
    throw error;
  }
}

function normalizeVolcStatus(value: unknown): JobRecord["status"] {
  const status = String(value || "").toLowerCase();
  if (["success", "succeeded", "done", "completed", "finished", "finish"].includes(status)) return "done";
  if (["failed", "failure", "terminated", "error", "errored", "canceled", "cancelled"].includes(status)) return "failed";
  if (["running", "processing", "executing", "in_progress"].includes(status)) return "generating";
  return "queued";
}

type VideoOutputCandidate = {
  url: string;
  storeUri: string;
  vid: string;
  fileId: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  score: number;
  path: string;
};

function collectNestedRecords(
  value: unknown,
  path = "result",
  depth = 0,
  seen = new Set<unknown>(),
  output: Array<{ path: string; record: Record<string, unknown> }> = [],
) {
  if (depth > 6 || !value || typeof value !== "object") return output;
  if (seen.has(value)) return output;
  seen.add(value);

  const record = typeof value === "string" ? parseJsonString(value) : asRecord(value);
  if (!Object.keys(record).length) return output;
  output.push({ path, record });

  for (const [key, nested] of Object.entries(record)) {
    const nextPath = `${path}.${key}`;
    if (typeof nested === "string") {
      const nestedRecord = parseJsonString(nested);
      if (Object.keys(nestedRecord).length) collectNestedRecords(nestedRecord, nextPath, depth + 1, seen, output);
      continue;
    }
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => collectNestedRecords(item, `${nextPath}[${index}]`, depth + 1, seen, output));
      continue;
    }
    collectNestedRecords(nested, nextPath, depth + 1, seen, output);
  }
  return output;
}

function scoreVideoOutputCandidate(path: string, input: Omit<VideoOutputCandidate, "score" | "path">) {
  let score = 0;
  const lowerPath = path.toLowerCase();
  if (input.url) score += 24;
  if (input.storeUri) score += 20;
  if (input.fileId) score += 18;
  if (input.vid) score += 8;
  if (Number.isFinite(input.width) && Number(input.width) > 0) score += 2;
  if (Number.isFinite(input.height) && Number(input.height) > 0) score += 2;
  if (Number.isFinite(input.duration) && Number(input.duration) > 0) score += 2;
  if (/\b(output|outputs|result|results|file|files|media|playinfo|product|products|enhance|transcode)\b/.test(lowerPath)) score += 12;
  if (/\b(task|template|data)\b/.test(lowerPath)) score += 3;
  if (/\b(input|source)\b/.test(lowerPath)) score -= 10;
  if (path === "result" && !input.url && !input.storeUri && !input.fileId) score -= 10;
  return score;
}

function findVideoOutputFile(result: Record<string, unknown>) {
  const candidates = collectNestedRecords(result)
    .map(({ path, record }) => {
      const videoStream = asRecord(record.VideoStreamMeta || record.VideoMeta || record.MediaInfo || record.Video || record.StreamMeta);
      const candidate = {
        url: firstString(
          record.URL,
          record.Url,
          record.url,
          record.PlayUrl,
          record.PlayURL,
          record.MainPlayUrl,
          record.DownloadUrl,
          record.DownloadURL,
          record.MediaUrl,
          record.mediaUrl,
        ),
        storeUri: firstString(
          record.StoreUri,
          record.StoreURI,
          record.OutputStoreUri,
          record.ResultStoreUri,
          record.FileName,
          record.fileName,
          record.FilePath,
          record.filePath,
          record.Uri,
        ),
        vid: firstString(
          record.OutputVid,
          record.ResultVid,
          record.Vid,
          record.vid,
          record.VideoId,
          record.videoId,
          record.MediaId,
          record.mediaId,
        ),
        fileId: firstString(
          record.OutputFileId,
          record.ResultFileId,
          record.FileId,
          record.fileId,
          record.FileID,
          record.fileID,
        ),
        size: Number(record.Size),
        duration: Number(record.Duration),
        width: Number(videoStream.Width),
        height: Number(videoStream.Height),
        score: 0,
        path,
      } satisfies VideoOutputCandidate;
      candidate.score = scoreVideoOutputCandidate(path, candidate);
      return candidate;
    })
    .filter((candidate) => candidate.url || candidate.storeUri || candidate.vid || candidate.fileId)
    .sort((left, right) => right.score - left.score || left.path.length - right.path.length);
  const best = candidates[0];
  if (!best) return null;
  return {
    url: best.url,
    storeUri: best.storeUri,
    vid: best.vid,
    fileId: best.fileId,
    size: Number.isFinite(best.size) ? best.size : undefined,
    duration: Number.isFinite(best.duration) ? best.duration : undefined,
    width: Number.isFinite(best.width) ? best.width : undefined,
    height: Number.isFinite(best.height) ? best.height : undefined,
  };
}

function fileUrlFromStoreUri(storeUri: string, outputDomain: string) {
  if (!storeUri || !outputDomain) return "";
  if (/^https?:\/\//i.test(storeUri)) return storeUri;
  const proto = env("VOLCENGINE_VOD_OUTPUT_PROTO", "http").toLowerCase() === "https" ? "https" : "http";
  return `${proto}://${outputDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${storeUri.replace(/^\/+/, "")}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function playInfoCandidates(result: Record<string, unknown>) {
  const direct = asRecord(result);
  const items = Array.isArray(result.PlayInfoList)
    ? result.PlayInfoList.map(asRecord)
    : [];
  const nested = asRecord(result.PlayInfo);
  const adaptive = asRecord(result.AdaptiveBitrateStreamingInfo);
  const candidates = [direct, nested, adaptive, ...items];
  return candidates.sort((left, right) => {
    const leftDefinition = String(left.Definition || left.definition || "").toLowerCase();
    const rightDefinition = String(right.Definition || right.definition || "").toLowerCase();
    return Number(rightDefinition === "oe") - Number(leftDefinition === "oe");
  });
}

function findVodPlayInfoUrl(result: Record<string, unknown>) {
  for (const candidate of playInfoCandidates(result)) {
    const url = firstString(
      candidate.MainPlayUrl,
      candidate.main_play_url,
      candidate.PlayUrl,
      candidate.PlayURL,
      candidate.Url,
      candidate.URL,
      candidate.DownloadUrl,
      candidate.DownloadURL,
      candidate.BackupPlayUrl,
      candidate.backup_play_url,
    );
    if (url) return url;
  }
  return "";
}

function playInfoLookupVid(result: Record<string, unknown>, outputVid?: string) {
  return firstString(
    outputVid,
    asRecord(result.Input).Vid,
    asRecord(result.Input).vid,
    result.Vid,
    result.vid,
  );
}

async function publishVodMedia(vid: string, config: ReturnType<typeof videoConfig>) {
  if (!vid || !config.credential) return;
  await openapiRequest({
    endpoint: config.endpoint,
    service: vodServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "UpdateMediaPublishStatus",
      Version: "2020-08-01",
      Vid: vid,
      Status: "Published",
    },
  });
}

async function vodPlayInfoUrl(vid: string, config: ReturnType<typeof videoConfig>) {
  if (!vid) return "";
  if (!config.credential) throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY" });
  await publishVodMedia(vid, config).catch(() => undefined);
  const response = await openapiRequest<{ Result?: Record<string, unknown> }>({
    endpoint: config.endpoint,
    service: vodServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "GetPlayInfo",
      Version: "2020-08-01",
      Vid: vid,
      FileType: "video",
      Format: "mp4",
      Ssl: env("VOLCENGINE_VOD_OUTPUT_PROTO", "http").toLowerCase() === "https" ? "1" : "0",
    },
  });
  return findVodPlayInfoUrl(response.Result || {});
}

function billingFromJob(job: JobRecord): UpscaleBillingInput {
  return {
    billingLocalUserId: job.billing_local_user_id || job.ownerLocalUserId || null,
    billingTaskId: job.billing_task_id || null,
    billingIdempotencyKey: job.billing_idempotency_key || null,
  };
}

function estimatedQuotaFromJob(job: JobRecord) {
  return Number.isInteger(job.billing_estimated_quota_units)
    ? Math.max(0, job.billing_estimated_quota_units as number)
    : 0;
}

export async function refreshVideoUpscaleJob(jobId: string, localUserId?: string | null) {
  const job = (await readJobs()).find((item) => item.id === jobId);
  if (!job) throw new GenerationDiagnosticError({ code: "TASK_POLL_FAILED", status: 404 });
  const jobOwner = job.ownerLocalUserId || job.billing_local_user_id || null;
  if (localUserId && jobOwner && jobOwner !== localUserId) throw new GenerationDiagnosticError({ code: "TASK_POLL_FAILED", status: 404 });
  if (job.status === "done" || job.status === "failed") return job;

  const provider = await providerById(job.providerId);
  const config = videoConfig(provider);
  if (!config.credential) throw new GenerationDiagnosticError({ code: "PROVIDER_MISSING_API_KEY", providerId: provider?.id, model: provider?.model });
  const response = await openapiRequest<{ Result?: Record<string, unknown> }>({
    endpoint: config.endpoint,
    service: vodServiceName,
    region: config.region,
    credential: config.credential,
    method: "GET",
    query: {
      Action: "GetExecution",
      Version: "2025-01-01",
      RunId: job.id,
    },
  });
  const result = response.Result || {};
  const status = normalizeVolcStatus(result.Status);
  if (status === "done") {
    const output = findVideoOutputFile(result);
    const playInfoVid = playInfoLookupVid(result, output?.vid);
    const playInfoUrl = await vodPlayInfoUrl(playInfoVid, config).catch(() => "");
    const outputUrls = uniqueStrings([
      playInfoUrl,
      output?.url || "",
      fileUrlFromStoreUri(output?.storeUri || "", config.outputDomain),
    ]);
    let outputUrl = "";
    let stored: Awaited<ReturnType<typeof storeRemoteUrl>> | null = null;
    for (const candidateUrl of outputUrls) {
      try {
        stored = await retryTransientProviderCall(
          () => storeRemoteUrl(candidateUrl, "video-upscale", "video/mp4"),
          resultDownloadRetryDelaysMs,
        );
        outputUrl = candidateUrl;
        break;
      } catch {
        outputUrl = "";
      }
    }
    if (!outputUrl) {
      const message = "视频高清增强已完成，但火山 VOD 空间没有可用播放域名。请在 VOD 空间配置并启用播放域名，然后把该域名写入 VOLCENGINE_VOD_OUTPUT_DOMAIN。";
      await updateLibraryItem(job.libraryItemId, { status: "failed", error: message });
      const updated = await updateJob(job.id, { status: "failed", error: message }) || job;
      await settleUpscaleBilling({
        billing: billingFromJob(job),
        estimatedQuotaUnits: estimatedQuotaFromJob(job),
        outcome: "failed",
        reason: message,
        newApiTaskId: job.id,
        upstreamModel: provider?.model || null,
      });
      return updated;
    }
    if (!stored) {
      const message = "Video upscale completed, but result download failed.";
      await updateLibraryItem(job.libraryItemId, { status: "failed", error: message });
      const updated = await updateJob(job.id, { status: "failed", error: message }) || job;
      await settleUpscaleBilling({
        billing: billingFromJob(job),
        estimatedQuotaUnits: estimatedQuotaFromJob(job),
        outcome: "failed",
        reason: message,
        newApiTaskId: job.id,
        upstreamModel: provider?.model || null,
      });
      return updated;
    }
    const currentItem = (await readLibrary()).find((item) => item.id === job.libraryItemId);
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      error: undefined,
      output: stored,
      params: {
        ...(currentItem?.params || {}),
        ...(output?.vid ? { volcOutputVid: output.vid } : {}),
        ...(output?.fileId ? { volcOutputFileId: output.fileId } : {}),
        ...(output?.storeUri ? { volcOutputStoreUri: output.storeUri } : {}),
        ...(output?.width && Number.isFinite(output.width) ? { outputWidth: output.width } : {}),
        ...(output?.height && Number.isFinite(output.height) ? { outputHeight: output.height } : {}),
        ...(output?.duration ? { outputDuration: output.duration } : {}),
      },
    });
    let updated = await updateJob(job.id, {
      status: "done",
      sourceUrl: outputUrl,
      billing_state: job.billing_task_id ? job.billing_state || "accepted" : job.billing_state,
      billing_last_error: null,
    }) || job;
    const settled = await settleUpscaleBilling({
      billing: billingFromJob(job),
      estimatedQuotaUnits: estimatedQuotaFromJob(job),
      outcome: "success",
      newApiTaskId: job.id,
      upstreamModel: provider?.model || null,
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
  if (status === "failed") {
    const message = firstString(result.Code, asRecord(result).Message) || "视频高清增强任务失败。";
    await updateLibraryItem(job.libraryItemId, { status: "failed", error: message });
    const updated = await updateJob(job.id, { status: "failed", error: message }) || job;
    await settleUpscaleBilling({
      billing: billingFromJob(job),
      estimatedQuotaUnits: estimatedQuotaFromJob(job),
      outcome: "failed",
      reason: message,
      newApiTaskId: job.id,
      upstreamModel: provider?.model || null,
    });
    return updated;
  }
  await updateLibraryItem(job.libraryItemId, { status });
  return await updateJob(job.id, { status }) || job;
}

export async function uploadedUpscaleFile(
  form: FormData,
  kind: "image" | "video",
): Promise<UploadedUpscaleFile> {
  const value = form.get("file");
  if (!(value instanceof File) || value.size === 0) throw new GenerationDiagnosticError({ code: "UPLOAD_NOT_FOUND" });
  const uploadKind = kind === "image" ? "image-upscale" : "video-upscale";
  assertFileSizeAllowed(value, uploadKind);
  if (kind === "video") {
    await assertStorageAllows("video-upload", { fresh: true });
  }
  const mimeType = await assertFileFormatAllowed(value, uploadKind);
  return {
    bytes: Buffer.from(await value.arrayBuffer()),
    mimeType,
    fileName: value.name || (kind === "image" ? "image.png" : "video.mp4"),
  };
}

export const volcengineUpscaleInternalsForTests = {
  collectNestedRecords,
  findVideoOutputFile,
  playInfoLookupVid,
  retryTransientProviderCall,
  scoreVideoOutputCandidate,
  serializeImageProcess,
  transientProviderError,
};
