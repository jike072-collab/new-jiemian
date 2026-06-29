import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { generateImage, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { claimTunneltestLimit, tunneltestLimitResponse } from "@/lib/server/tunneltest-limits";

export const runtime = "nodejs";

const imageModes = new Set(["text-to-image", "image-to-image"]);
const imageRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
const imageQualities = new Set(["1k", "2k", "4k"]);

function requiredOption(value: FormDataEntryValue | null, fallback: string, allowed: Set<string>) {
  const text = String(value || fallback).trim();
  if (!allowed.has(text)) {
    throw new Error("生成参数无效。");
  }
  return text;
}

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const mode = requiredOption(form.get("mode"), "text-to-image", imageModes) as "text-to-image" | "image-to-image";
    const ratio = requiredOption(form.get("ratio"), "1:1", imageRatios);
    const quality = requiredOption(form.get("quality"), "1k", imageQualities);
    const taskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const idempotencyKey = String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || "");
    const tunneltest = await claimTunneltestLimit({
      localUserId: session.user.local_user_id,
      operation: "cloud_image_generation",
      taskId,
      idempotencyKey,
    });
    if (tunneltest && !tunneltest.ok) return tunneltestLimitResponse(tunneltest);
    const item = await generateImage({
      providerId: String(form.get("providerId") || ""),
      mode,
      prompt: String(form.get("prompt") || ""),
      ratio,
      quality,
      files: await uploadedMediaFromForm(form),
      billingLocalUserId: session.user.local_user_id,
      billingTaskId: taskId,
      billingIdempotencyKey: idempotencyKey,
      billingEstimatedQuotaUnits: Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN),
    });
    return NextResponse.json({ item });
  } catch (error) {
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "图片生成失败。",
      tool: "image",
      operation: "generate-image",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
