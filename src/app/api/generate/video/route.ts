import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { failVideoGenerationBeforeSubmit, submitVideo, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { WorkloadLimitError, withUserVideoWorkload, withVideoUploadPhase, workloadLimitResponse } from "@/lib/server/workload-guard";
import { estimateVideoGenerationEntitlementUnits } from "@/lib/generation-quota";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const duration = Number(form.get("duration") || 5);
    const mode = String(form.get("mode") || "text-to-video") === "image-to-video" ? "image-to-video" : "text-to-video";
    const referenceMode = String(form.get("referenceMode") || "single") === "first-last" ? "first-last" : "single";
    const resolution = String(form.get("resolution") || "720p").trim().toLowerCase();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const billingTaskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const billingEstimatedQuotaUnits = Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const membershipEntitlementAmount = estimateVideoGenerationEntitlementUnits({ resolution });
    const failBeforeSubmit = (error: unknown) => failVideoGenerationBeforeSubmit({
      localUserId: session.user.local_user_id,
      taskId: billingTaskId,
      estimatedQuotaUnits: billingEstimatedQuotaUnits,
      membershipEntitlementAmount,
      reason: error instanceof Error ? error.message : "video generation rejected before provider submission",
    });
    try {
      if (mode === "text-to-video" && (files.length || referenceMode === "first-last")) {
        throw new Error("文生视频模式不接收首尾帧图片。");
      }
      if (mode === "image-to-video" && referenceMode === "first-last" && files.length !== 2) {
        throw new Error("首尾帧视频必须上传首帧图和尾帧图。");
      }
      if (mode === "image-to-video" && referenceMode === "single" && files.length !== 1) {
        throw new Error(files.length ? "图生视频模式只能上传 1 张首帧图片。" : "图生视频模式需要上传 1 张首帧图片。");
      }
    } catch (error) {
      await failBeforeSubmit(error);
      throw error;
    }
    const result = await withUserVideoWorkload(session.user.local_user_id, async () => {
      let guardedFiles;
      try {
        guardedFiles = files.length
          ? await withVideoUploadPhase(
            session.user.local_user_id,
            () => uploadedMediaFromForm(form, "files", "video-generation-upload"),
          )
          : await uploadedMediaFromForm(form, "files", "video-generation-upload");
      } catch (error) {
        await failBeforeSubmit(error);
        throw error;
      }
      return submitVideo({
      providerId: String(form.get("providerId") || ""),
      mode,
      referenceMode,
      prompt: String(form.get("prompt") || ""),
      ratio: String(form.get("ratio") || "16:9"),
      duration: Number.isFinite(duration) ? duration : 5,
      resolution,
      files: guardedFiles,
      billingLocalUserId: session.user.local_user_id,
      billingTaskId,
      billingIdempotencyKey: String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || ""),
      billingEstimatedQuotaUnits,
      });
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkloadLimitError) return workloadLimitResponse(error);
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "视频生成失败。",
      tool: "video",
      operation: "generate-video",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
