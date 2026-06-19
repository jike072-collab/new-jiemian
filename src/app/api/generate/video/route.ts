import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { submitVideo, uploadedMediaFromForm } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const duration = Number(form.get("duration") || 5);
    const mode = String(form.get("mode") || "text-to-video") === "image-to-video" ? "image-to-video" : "text-to-video";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (mode === "text-to-video" && files.length) {
      throw new Error("文生视频模式不接收首帧图片。");
    }
    if (mode === "image-to-video" && files.length !== 1) {
      throw new Error(files.length ? "图生视频模式只能上传 1 张首帧图片。" : "图生视频模式需要上传 1 张首帧图片。");
    }
    const result = await submitVideo({
      providerId: String(form.get("providerId") || ""),
      mode,
      prompt: String(form.get("prompt") || ""),
      ratio: String(form.get("ratio") || "16:9"),
      duration: Number.isFinite(duration) ? duration : 5,
      files: await uploadedMediaFromForm(form),
      billingLocalUserId: session.user.local_user_id,
      billingTaskId: String(form.get("taskId") || form.get("billingTaskId") || ""),
      billingIdempotencyKey: String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || ""),
      billingEstimatedQuotaUnits: Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "视频生成失败。",
    }, { status: 400 });
  }
}
