import { randomUUID } from "node:crypto";

import { addJob, addLibraryItem, storeBytes, storeDataUrl, storeRemoteUrl, updateJob, updateLibraryItem } from "./library";
import { getTaskBillingService } from "./quota";
import { providerById } from "./providers";
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
};

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
  const first = asRecord(data[0] || root.video || root.result || root.output || payload);
  const url = firstString(
    first.url,
    first.image_url,
    first.video_url,
    first.output_url,
    first.download_url,
    root.url,
    root.image_url,
    root.video_url,
    root.output_url,
    root.download_url,
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
    url,
    base64,
    jobId: firstString(first.id, first.video_id, root.id, root.video_id),
    status: firstString(first.status, root.status),
    statusUrl: firstString(first.status_url, root.status_url),
    mimeType: firstString(first.mime_type, root.mime_type),
  };
}

function authHeaders(provider: ProviderConfig) {
  return { Authorization: `Bearer ${provider.apiKey}` };
}

function ratioToSize(ratio: string) {
  if (ratio === "16:9") return "1536x864";
  if (ratio === "9:16") return "864x1536";
  if (ratio === "4:3") return "1344x1024";
  if (ratio === "3:4") return "1024x1344";
  return "1024x1024";
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
    parsed.pathname = parsed.pathname.replace(/\/videos\/generations\/?$/i, `/videos/${encodeURIComponent(jobId)}`);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
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

async function readProviderJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = asRecord(payload);
    const message = firstString(asRecord(record.error).message, record.message)
      || `供应商请求失败：HTTP ${response.status}`;
    throw new Error(message);
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

  if (useMultipart) {
    const form = new FormData();
    form.append("model", provider.model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", size);
    form.append("quality", quality === "2k" ? "high" : "standard");
    form.append("response_format", "url");
    if (quality === "2k") form.append("upscale", "2k");
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
    return parseProviderOutput(await readProviderJson(response));
  }

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
      quality: quality === "2k" ? "high" : "standard",
      response_format: "url",
      ...(quality === "2k" ? { upscale: "2k" } : {}),
    }),
    signal: AbortSignal.timeout(300000),
  });
  return parseProviderOutput(await readProviderJson(response));
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
}) {
  if (!input.localUserId || !input.taskId) return;
  const billing = getTaskBillingService();
  const actualQuotaUnits = Number.isInteger(input.estimatedQuotaUnits)
    ? Math.max(0, input.estimatedQuotaUnits as number)
    : 0;
  try {
    if (input.outcome === "success") {
      await billing.settleSuccess({
        localUserId: input.localUserId,
        taskId: input.taskId,
        actualQuotaUnits,
        newApiTaskId: input.newApiTaskId || null,
        upstreamRequestId: input.upstreamRequestId || null,
        upstreamModel: input.upstreamModel || null,
      });
    } else {
      await billing.fail({
        localUserId: input.localUserId,
        taskId: input.taskId,
        reason: input.reason || "generation failed",
        newApiTaskId: input.newApiTaskId || null,
        upstreamRequestId: input.upstreamRequestId || null,
        upstreamModel: input.upstreamModel || null,
      });
    }
  } catch {
    // Billing reconciliation stays inside the task-billing service.
  }
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
  try {
    if (!provider || provider.kind !== "image" || !provider.enabled || !provider.apiKey) {
      throw new Error("图片供应商未配置或未启用。");
    }
    if (!input.prompt.trim()) throw new Error("请输入图片提示词。");
    if (input.mode === "image-to-image" && !input.files.length) {
      throw new Error("图生图模式需要上传参考图片。");
    }

    const output = await callImageProvider({
      provider,
      prompt: input.prompt,
      ratio: input.ratio,
      quality: input.quality,
      files: input.files,
    });
    const stored = await outputToLibrary(output, "image", "image");
    const item = await addLibraryItem({
      type: "image",
      mode: input.mode,
      title: input.prompt.slice(0, 42) || "图片生成",
      prompt: input.prompt,
      providerId: provider.id,
      model: provider.model,
      status: "done",
      output: stored,
      params: {
        ratio: input.ratio,
        quality: input.quality,
        referenceImages: input.files.length,
        ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
        ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
        ...(Number.isInteger(input.billingEstimatedQuotaUnits)
          ? { billingEstimatedQuotaUnits: input.billingEstimatedQuotaUnits as number }
          : {}),
      },
    });
    await settleGeneratedTaskBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      estimatedQuotaUnits: input.billingEstimatedQuotaUnits,
      outcome: "success",
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || item.id,
    });
    return item;
  } catch (error) {
    await settleGeneratedTaskBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      estimatedQuotaUnits: input.billingEstimatedQuotaUnits,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "generation failed",
      upstreamModel: provider?.model || null,
    });
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
}) {
  const provider = await providerById(input.providerId);
  try {
    if (!input.prompt.trim()) throw new Error("请输入视频提示词。");
    if (input.mode === "text-to-video" && input.files.length) {
      throw new Error("文生视频模式不接收首帧图片。");
    }
    if (input.mode === "image-to-video") {
      if (!input.files.length) {
        throw new Error("图生视频模式需要上传 1 张首帧图片。");
      }
      if (input.files.length > 1) {
        throw new Error("图生视频模式只能上传 1 张首帧图片。");
      }
    }

    if (!provider || provider.kind !== "video" || !provider.enabled || !provider.apiKey) {
      throw new Error("视频供应商未配置或未启用。");
    }

    const providerPayload: Record<string, string | number | string[]> = {
      model: provider.model,
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.ratio,
      response_format: "url",
    };
    if (input.mode === "image-to-video") {
      const [file] = input.files;
      providerPayload.image = [`data:${file.mimeType};base64,${file.bytes.toString("base64")}`];
    }

    const response = await fetch(provider.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(provider),
      },
      body: JSON.stringify(providerPayload),
      signal: AbortSignal.timeout(180000),
    });
    const output = parseProviderOutput(await readProviderJson(response));

    if (output.url) {
      const stored = await outputToLibrary(output, "video", "video");
      const item = await addLibraryItem({
        type: "video",
        mode: input.mode,
        title: input.prompt.slice(0, 42) || "视频生成",
        prompt: input.prompt,
        providerId: provider.id,
        model: provider.model,
        status: "done",
        output: stored,
        params: {
          ratio: input.ratio,
          duration: input.duration,
          referenceImages: input.files.length,
          ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
          ...(input.billingIdempotencyKey ? { billingIdempotencyKey: input.billingIdempotencyKey } : {}),
          ...(Number.isInteger(input.billingEstimatedQuotaUnits)
            ? { billingEstimatedQuotaUnits: input.billingEstimatedQuotaUnits as number }
            : {}),
        },
      });
      await settleGeneratedTaskBilling({
        localUserId: input.billingLocalUserId,
        taskId: input.billingTaskId,
        estimatedQuotaUnits: input.billingEstimatedQuotaUnits,
        outcome: "success",
        upstreamModel: provider.model,
        newApiTaskId: output.jobId || item.id,
      });
      return { item, job: null };
    }

    const item = await addLibraryItem({
      type: "video",
      mode: input.mode,
      title: input.prompt.slice(0, 42) || "视频生成",
      prompt: input.prompt,
      providerId: provider.id,
      model: provider.model,
      status: normalizeStatus(output.status || ""),
      params: {
        ratio: input.ratio,
        duration: input.duration,
        referenceImages: input.files.length,
      },
    });
    const jobId = output.jobId || randomUUID();
    const job = await addJob({
      id: jobId,
      libraryItemId: item.id,
      type: "video",
      ownerLocalUserId: input.billingLocalUserId || null,
      providerId: provider.id,
      status: normalizeStatus(output.status || ""),
      statusUrl: output.statusUrl || deriveStatusUrl(provider.apiUrl, jobId),
      billing_task_id: input.billingTaskId || null,
      billing_local_user_id: input.billingLocalUserId || null,
      billing_idempotency_key: input.billingIdempotencyKey || null,
      billing_estimated_quota_units: input.billingEstimatedQuotaUnits ?? null,
      billing_state: input.billingTaskId ? "prechecked" : undefined,
    });
    return { item, job };
  } catch (error) {
    await settleGeneratedTaskBilling({
      localUserId: input.billingLocalUserId,
      taskId: input.billingTaskId,
      estimatedQuotaUnits: input.billingEstimatedQuotaUnits,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "generation failed",
      upstreamModel: provider?.model || null,
    });
    throw error;
  }
}

async function reconcileFinalizedVideoJob(job: JobRecord, localUserId?: string | null) {
  const billingLocalUserId = job.billing_local_user_id || job.ownerLocalUserId || localUserId || null;
  if (!job.billing_task_id || !billingLocalUserId) return;
  if (job.status === "done") {
    await settleGeneratedTaskBilling({
      localUserId: billingLocalUserId,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "success",
      upstreamModel: null,
      newApiTaskId: job.id,
    });
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
  if (job.providerId === "video-upscale") return job;

  const provider = await providerById(job.providerId);
  if (!provider || !provider.apiKey) throw new Error("视频供应商未配置。");
  if (!job.statusUrl) return job;

  const response = await fetch(job.statusUrl, {
    method: "GET",
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(60000),
  });
  const output = parseProviderOutput(await readProviderJson(response));
  const status = normalizeStatus(output.status || "");

  if (output.url) {
    const stored = await outputToLibrary(output, "video", "video");
    await updateLibraryItem(job.libraryItemId, {
      status: "done",
      output: stored,
    } satisfies Partial<LibraryItem>);
    const updated = await updateJob(job.id, {
      status: "done",
      sourceUrl: output.url,
      billing_state: job.billing_task_id ? "settled" : job.billing_state,
      billing_last_error: null,
    });
    await settleGeneratedTaskBilling({
      localUserId: job.billing_local_user_id || job.ownerLocalUserId || localUserId || null,
      taskId: job.billing_task_id,
      estimatedQuotaUnits: job.billing_estimated_quota_units ?? null,
      outcome: "success",
      upstreamRequestId: output.jobId || null,
      upstreamModel: provider.model,
      newApiTaskId: output.jobId || job.id,
    });
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
