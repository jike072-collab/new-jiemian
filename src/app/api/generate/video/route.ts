import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { assertVideoRequestReady, submitVideo, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { claimTunneltestLimit, tunneltestLimitResponse } from "@/lib/server/tunneltest-limits";

export const runtime = "nodejs";

const videoModes = new Set(["text-to-video", "image-to-video"]);
const videoRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);

function requiredOption(value: FormDataEntryValue | null, fallback: string, allowed: Set<string>) {
  const text = String(value || fallback).trim();
  if (!allowed.has(text)) {
    throw new Error("生成参数无效。");
  }
  return text;
}

function requestPublicBaseUrl(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim();
  if (!host) return request.nextUrl.origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = forwardedProto || (localHost ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const taskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const idempotencyKey = String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || "");
    const duration = Number(form.get("duration") || 6);
    const mode = requiredOption(form.get("mode"), "text-to-video", videoModes) as "text-to-video" | "image-to-video";
    const ratio = requiredOption(form.get("ratio"), "16:9", videoRatios);
    const files = await uploadedMediaFromForm(form);
    if (mode === "text-to-video" && files.length) {
      throw new Error("文生视频模式不接收首帧图片。");
    }
    if (mode === "image-to-video" && files.length !== 1) {
      throw new Error(files.length ? "图生视频模式只能上传 1 张首帧图片。" : "图生视频模式需要上传 1 张首帧图片。");
    }
    const input = {
      providerId: String(form.get("providerId") || ""),
      mode,
      prompt: String(form.get("prompt") || ""),
      ratio,
      duration: Number.isFinite(duration) ? duration : 6,
      files,
    };
    await assertVideoRequestReady(input);
    const tunneltest = await claimTunneltestLimit({
      localUserId: session.user.local_user_id,
      operation: "cloud_video_generation",
      taskId,
      idempotencyKey,
    });
    if (tunneltest && !tunneltest.ok) return tunneltestLimitResponse(tunneltest);
    const result = await submitVideo({
      ...input,
      billingLocalUserId: session.user.local_user_id,
      billingTaskId: taskId,
      billingIdempotencyKey: idempotencyKey,
      billingEstimatedQuotaUnits: Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN),
      referenceBaseUrl: requestPublicBaseUrl(request),
    });
    return NextResponse.json(result);
  } catch (error) {
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "视频生成失败。",
      tool: "video",
      operation: "generate-video",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
