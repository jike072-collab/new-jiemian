import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { generateImage, uploadedMediaFromForm } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const item = await generateImage({
      providerId: String(form.get("providerId") || ""),
      mode: String(form.get("mode") || "text-to-image") === "image-to-image" ? "image-to-image" : "text-to-image",
      prompt: String(form.get("prompt") || ""),
      ratio: String(form.get("ratio") || "1:1"),
      quality: String(form.get("quality") || "1k"),
      files: await uploadedMediaFromForm(form),
      billingLocalUserId: session.user.local_user_id,
      billingTaskId: String(form.get("taskId") || form.get("billingTaskId") || ""),
      billingIdempotencyKey: String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || ""),
      billingEstimatedQuotaUnits: Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN),
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "图片生成失败。",
    }, { status: 400 });
  }
}
