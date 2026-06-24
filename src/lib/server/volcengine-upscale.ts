import { createHash, createHmac, randomUUID } from "node:crypto";
import { extname } from "node:path";

import {
  addJob,
  addLibraryItem,
  readJobs,
  readLibrary,
  storeRemoteUrl,
  updateJob,
  updateLibraryItem,
} from "./library";
import { providerById } from "./providers";
import { type JobRecord, type ProviderConfig } from "./types";

export type UploadedUpscaleFile = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type TargetScale = 1 | 2 | 4;

type VolcanoCredential = {
  accessKeyId: string;
  secretAccessKey: string;
};

const imagexDefaultEndpoint = "https://imagex.volcengineapi.com";
const vodDefaultEndpoint = "https://vod.volcengineapi.com";
const defaultRegion = "cn-north-1";
const imagexServiceName = "imagex";
const vodServiceName = "vod";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
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
  const payload = await response.json().catch(() => ({}));
  const metadata = asRecord(asRecord(payload).ResponseMetadata);
  const error = asRecord(metadata.Error);
  if (!response.ok || Object.keys(error).length) {
    const message = firstString(error.Message, error.message, asRecord(payload).message)
      || `火山接口请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function imageConfig(provider: ProviderConfig | null) {
  const credential = parseCredential(provider);
  const serviceId = provider?.model || env("VOLCENGINE_IMAGEX_SERVICE_ID");
  return {
    credential,
    endpoint: provider?.apiUrl || env("VOLCENGINE_IMAGEX_ENDPOINT", imagexDefaultEndpoint),
    region: env("VOLCENGINE_REGION", defaultRegion),
    serviceId,
    outputDomain: env("VOLCENGINE_IMAGEX_OUTPUT_DOMAIN"),
    outputTpl: env("VOLCENGINE_IMAGEX_OUTPUT_TPL"),
    workflowTemplateId: env("VOLCENGINE_IMAGEX_WORKFLOW_TEMPLATE_ID", "system_workflow_ai_super_resolution"),
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
  if (!provider?.enabled) return { ready: false, detail: kind === "image" ? "图片高清供应商未启用。" : "视频高清供应商未启用。" };
  if (kind === "image") {
    const config = imageConfig(provider);
    if (!config.credential) return { ready: false, detail: "图片高清缺少火山 AK/SK，请在后台 API Key 填 AK:SK。" };
    if (!config.serviceId) return { ready: false, detail: "图片高清缺少 ImageX ServiceId，请填在模型字段或 VOLCENGINE_IMAGEX_SERVICE_ID。" };
    return { ready: true, detail: "火山 ImageX 图片高清已配置。" };
  }
  const config = videoConfig(provider);
  if (!config.credential) return { ready: false, detail: "视频高清缺少火山 AK/SK，请在后台 API Key 填 AK:SK。" };
  if (!config.spaceName) return { ready: false, detail: "视频高清缺少 VOD SpaceName，请填在模型字段或 VOLCENGINE_VOD_SPACE_NAME。" };
  return { ready: true, detail: "火山 VOD 视频高清已配置。" };
}

export async function readUpscaleStatus() {
  const [imageProvider, videoProvider] = await Promise.all([
    providerById("image-upscale"),
    providerById("video-upscale"),
  ]);
  return {
    image: providerReady(imageProvider, "image"),
    video: providerReady(videoProvider, "video"),
  };
}

async function uploadByAddress(file: UploadedUpscaleFile, uploadHost: string, storeUri: string, auth: string) {
  const url = `https://${uploadHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${storeUri.replace(/^\/+/, "")}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": file.mimeType || "application/octet-stream",
    },
    body: new Uint8Array(file.bytes),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`上传到火山失败：HTTP ${response.status}`);
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
  if (!config.credential || !config.serviceId) throw new Error("图片高清火山配置不完整。");
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
    },
  });
  const address = apply.Result?.UploadAddress;
  const storeInfo = address?.StoreInfos?.[0];
  const host = address?.UploadHosts?.[0];
  if (!storeInfo?.StoreUri || !storeInfo.Auth || !host || !address?.SessionKey) {
    throw new Error("火山 ImageX 未返回完整上传地址。");
  }
  const imageSessionKey = address.SessionKey;
  await uploadByAddress(file, host, storeInfo.StoreUri, storeInfo.Auth);
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
  if (!config.credential || !config.serviceId) throw new Error("图片高清火山配置不完整。");
  if (!config.outputDomain) {
    throw new Error("图片高清结果已生成，但缺少 VOLCENGINE_IMAGEX_OUTPUT_DOMAIN，无法自动取回结果图。");
  }
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
      Proto: "https",
      Format: "image",
      ...(config.outputTpl ? { Tpl: config.outputTpl } : {}),
    },
  });
  const result = response.Result || {};
  return firstString(result.URL, result.url, result.ObjURL, result.obj_url);
}

export async function upscaleImage(file: UploadedUpscaleFile, scale: TargetScale) {
  const provider = await providerById("image-upscale");
  const status = providerReady(provider, "image");
  if (!provider || provider.endpointType !== "volcengine-imagex-upscale" || !status.ready) throw new Error(status.detail);
  const config = imageConfig(provider);
  const inputKey = await uploadImageToImagex(file, config);
  const workflowParameter = JSON.stringify({
    Input: {
      ObjectKey: inputKey.replace(/^tos-[^/]+\//, ""),
      DataType: "uri",
    },
    GenDREnhanceParam: {
      ModelId: config.modelId,
      Multiple: Math.max(1, scale),
    },
  });
  const processed = await openapiRequest<{
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
  });
  const output = parseJsonString(processed.Result?.Output);
  const objectKey = firstString(output.ObjectKey, output.objectKey, output.URI, output.Uri);
  if (!objectKey) throw new Error("火山 ImageX 未返回结果图 URI。");
  const outputUrl = await imageResourceUrl(objectKey, config);
  if (!outputUrl) throw new Error("火山 ImageX 未返回可访问的结果图 URL。");
  const stored = await storeRemoteUrl(outputUrl, "image-upscale", "image/png");
  const sourceDimensions = readImageDimensions(file.bytes);
  return addLibraryItem({
    type: "image",
    mode: "image-upscale",
    title: `图片高清 ${targetLabel(scale)}`,
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
      ...(sourceDimensions ? {
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
      } : {}),
    },
  });
}

async function uploadVideoToVod(file: UploadedUpscaleFile, config: ReturnType<typeof videoConfig>) {
  if (!config.credential || !config.spaceName) throw new Error("视频高清火山配置不完整。");
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
    throw new Error("火山 VOD 未返回完整上传地址。");
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
  if (!data?.Vid) throw new Error("火山 VOD 上传确认后未返回 Vid。");
  return { ...data, Vid: data.Vid };
}

export async function submitVideoUpscale(file: UploadedUpscaleFile, scale: TargetScale) {
  const provider = await providerById("video-upscale");
  const status = providerReady(provider, "video");
  if (!provider || provider.endpointType !== "volcengine-vod-upscale" || !status.ready) throw new Error(status.detail);
  const config = videoConfig(provider);
  const uploaded = await uploadVideoToVod(file, config);
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
  const runId = start.Result?.RunId;
  if (!runId) throw new Error("火山 VOD 未返回视频高清任务 RunId。");
  const item = await addLibraryItem({
    type: "video",
    mode: "video-upscale",
    title: `视频高清 ${targetLabel(scale)}`,
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
      ...(typeof sourceInfo.Width === "number" ? { sourceWidth: sourceInfo.Width } : {}),
      ...(typeof sourceInfo.Height === "number" ? { sourceHeight: sourceInfo.Height } : {}),
      ...(typeof sourceInfo.Duration === "number" ? { sourceDuration: sourceInfo.Duration } : {}),
    },
  });
  const job = await addJob({
    id: runId,
    libraryItemId: item.id,
    type: "video",
    providerId: provider.id,
    status: "generating",
    statusUrl: "volcengine:vod:GetExecution",
    sourceUrl: vid,
  });
  return { item, job };
}

function normalizeVolcStatus(value: unknown): JobRecord["status"] {
  const status = String(value || "").toLowerCase();
  if (status === "success" || status === "done" || status === "completed") return "done";
  if (status === "failed" || status === "terminated" || status === "error") return "failed";
  if (status === "running") return "generating";
  return "queued";
}

function findVideoOutputFile(result: Record<string, unknown>) {
  const output = asRecord(result.Output);
  const task = asRecord(output.Task);
  const enhance = asRecord(task.Enhance);
  const template = asRecord(output.Template);
  const templateEnhance = asRecord(template.Enhance);
  const candidates = [
    enhance,
    templateEnhance,
    asRecord(template.TranscodeVideo),
    asRecord(template.ByteHD),
    asRecord(enhance.File),
    asRecord(templateEnhance.File),
    asRecord(task.File),
    asRecord(output.File),
  ];
  for (const candidate of candidates) {
    const url = firstString(candidate.URL, candidate.Url, candidate.url, candidate.PlayUrl, candidate.PlayURL, candidate.DownloadUrl, candidate.DownloadURL);
    const storeUri = firstString(candidate.StoreUri, candidate.StoreURI, candidate.FileName, candidate.fileName);
    const vid = firstString(candidate.Vid, candidate.vid);
    const fileId = firstString(candidate.FileId, candidate.fileId);
    const size = Number(candidate.Size);
    const duration = Number(candidate.Duration);
    const videoStream = asRecord(candidate.VideoStreamMeta);
    if (url || storeUri || vid || fileId) {
      return {
        url,
        storeUri,
        vid,
        fileId,
        size: Number.isFinite(size) ? size : undefined,
        duration: Number.isFinite(duration) ? duration : undefined,
        width: Number(videoStream.Width),
        height: Number(videoStream.Height),
      };
    }
  }
  return null;
}

function fileUrlFromStoreUri(storeUri: string, outputDomain: string) {
  if (!storeUri || !outputDomain) return "";
  if (/^https?:\/\//i.test(storeUri)) return storeUri;
  return `https://${outputDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${storeUri.replace(/^\/+/, "")}`;
}

export async function refreshVideoUpscaleJob(jobId: string, localUserId?: string | null) {
  const job = (await readJobs()).find((item) => item.id === jobId);
  if (!job) throw new Error("任务不存在。");
  const jobOwner = job.ownerLocalUserId || job.billing_local_user_id || null;
  if (localUserId && jobOwner && jobOwner !== localUserId) throw new Error("任务不存在。");
  if (job.status === "done" || job.status === "failed") return job;

  const provider = await providerById(job.providerId);
  const config = videoConfig(provider);
  if (!config.credential) throw new Error("视频高清缺少火山 AK/SK。");
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
    const outputUrl = output?.url || fileUrlFromStoreUri(output?.storeUri || "", config.outputDomain);
    if (!outputUrl) {
      const message = "视频高清已完成，但缺少可下载结果地址。请配置 VOLCENGINE_VOD_OUTPUT_DOMAIN 或使用 VOD 播放地址接口。";
      await updateLibraryItem(job.libraryItemId, { status: "failed", error: message });
      return await updateJob(job.id, { status: "failed", error: message }) || job;
    }
    const stored = await storeRemoteUrl(outputUrl, "video-upscale", "video/mp4");
    const currentItem = (await readLibrary()).find((item) => item.id === job.libraryItemId);
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
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
    return await updateJob(job.id, { status: "done", sourceUrl: outputUrl }) || job;
  }
  if (status === "failed") {
    const message = firstString(result.Code, asRecord(result).Message) || "视频高清任务失败。";
    await updateLibraryItem(job.libraryItemId, { status: "failed", error: message });
    return await updateJob(job.id, { status: "failed", error: message }) || job;
  }
  await updateLibraryItem(job.libraryItemId, { status });
  return await updateJob(job.id, { status }) || job;
}

export async function uploadedUpscaleFile(
  form: FormData,
  kind: "image" | "video",
): Promise<UploadedUpscaleFile> {
  const value = form.get("file");
  if (!(value instanceof File) || value.size === 0) throw new Error("请选择要高清处理的文件。");
  const allowed = kind === "image"
    ? new Set(["image/png", "image/jpeg", "image/webp"])
    : new Set(["video/mp4", "video/webm", "video/quicktime"]);
  if (!allowed.has(value.type)) {
    throw new Error(kind === "image"
      ? "图片高清仅支持 PNG、JPEG 和 WebP。"
      : "视频高清仅支持 MP4、WebM 和 MOV。");
  }
  const limit = kind === "image" ? 10 * 1024 * 1024 : 1024 * 1024 * 1024;
  if (value.size > limit) {
    throw new Error(kind === "image" ? "图片不能超过 10MB。" : "视频不能超过 1GB。");
  }
  return {
    bytes: Buffer.from(await value.arrayBuffer()),
    mimeType: value.type,
    fileName: value.name || (kind === "image" ? "image.png" : "video.mp4"),
  };
}
