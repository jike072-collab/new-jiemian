import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { failVideoGenerationBeforeSubmit, submitVideo, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { WorkloadLimitError, withInternalCanvasVideoUploadPhase, withInternalCanvasVideoWorkload, withUserVideoWorkload, withVideoUploadPhase, workloadLimitResponse } from "@/lib/server/workload-guard";
import { estimateVideoGenerationEntitlementUnits } from "@/lib/generation-quota";
import { normalizeCanvasLibraryScope } from "@/lib/canvas/library-scope";
import { providerById } from "@/lib/server/providers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const billingMode = isInternalCanvasHostname(request.headers.get("host")) ? "internal_free" as const : "standard" as const;
    const form = await request.formData();
    const canvasScope = billingMode === "internal_free" ? normalizeCanvasLibraryScope(form.get("canvasScope")) : "personal" as const;
    const duration = Number(form.get("duration") || 5);
    const mode = String(form.get("mode") || "text-to-video") === "image-to-video" ? "image-to-video" : "text-to-video";
    const referenceMode = String(form.get("referenceMode") || "single") === "first-last" ? "first-last" : "single";
    const resolution = String(form.get("resolution") || "720p").trim().toLowerCase();
    const prompt = String(form.get("prompt") || "").trim();
    const legacyFiles = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const referenceImages = form.getAll("referenceImages").filter((value): value is File => value instanceof File && value.size > 0);
    const referenceVideos = form.getAll("referenceVideos").filter((value): value is File => value instanceof File && value.size > 0);
    const referenceAudios = form.getAll("referenceAudios").filter((value): value is File => value instanceof File && value.size > 0);
    const imageCount = referenceImages.length || legacyFiles.length;
    const referenceCount = imageCount + referenceVideos.length + referenceAudios.length;
    const billingTaskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const billingEstimatedQuotaUnits = billingMode === "internal_free" ? 0 : Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const providerId = String(form.get("providerId") || "");
    const selectedProvider = await providerById(providerId);
    const membershipEntitlementAmount = billingMode === "internal_free" ? 0 : estimateVideoGenerationEntitlementUnits({ resolution, model: selectedProvider?.model, durationSeconds: duration });
    const failBeforeSubmit = (error: unknown) => failVideoGenerationBeforeSubmit({
      localUserId: session.user.local_user_id,
      taskId: billingTaskId,
      estimatedQuotaUnits: billingEstimatedQuotaUnits,
      membershipEntitlementAmount,
      reason: error instanceof Error ? error.message : "video generation rejected before provider submission",
    });
    try {
      if (mode === "text-to-video" && (referenceCount || referenceMode === "first-last")) {
        throw new Error("文生视频模式不接收首尾帧图片。");
      }
      const requiredReferenceMedia = selectedProvider?.videoOptions?.requiredReferenceMedia || [];
      if (requiredReferenceMedia.includes("image") && !imageCount) {
        throw new Error("当前模型需要上传参考图。");
      }
      if (requiredReferenceMedia.includes("video") && !referenceVideos.length) {
        throw new Error("当前模型需要上传参考视频。");
      }
      if (requiredReferenceMedia.includes("audio") && !referenceAudios.length) {
        throw new Error("当前模型需要上传参考音频。");
      }
      const maxPromptCharacters = selectedProvider?.videoOptions?.maxPromptCharacters;
      if (maxPromptCharacters && prompt.length > maxPromptCharacters) {
        throw new Error(`当前模型提示词最多 ${maxPromptCharacters} 个字符。`);
      }
      if (mode === "image-to-video" && referenceMode === "first-last" && (imageCount !== 2 || referenceVideos.length || referenceAudios.length)) {
        throw new Error("首尾帧视频必须上传首帧图和尾帧图。");
      }
      if (mode === "image-to-video" && referenceMode === "single" && !referenceCount) {
        throw new Error("参考素材模式至少需要上传 1 个素材。");
      }
    } catch (error) {
      await failBeforeSubmit(error);
      throw error;
    }
    const result = await (billingMode === "internal_free" ? withInternalCanvasVideoWorkload : withUserVideoWorkload)(session.user.local_user_id, async () => {
      let guardedFiles;
      try {
        guardedFiles = referenceCount
          ? await (billingMode === "internal_free" ? withInternalCanvasVideoUploadPhase : withVideoUploadPhase)(
            session.user.local_user_id,
            async () => {
              const [images, videos, audios] = await Promise.all([
                uploadedMediaFromForm(form, referenceImages.length ? "referenceImages" : "files", "video-generation-upload"),
                uploadedMediaFromForm(form, "referenceVideos", "video-reference-upload"),
                uploadedMediaFromForm(form, "referenceAudios", "audio-reference-upload"),
              ]);
              return [...images, ...videos, ...audios];
            },
          )
          : [];
      } catch (error) {
        await failBeforeSubmit(error);
        throw error;
      }
      return submitVideo({
      providerId,
      mode,
      referenceMode,
      prompt,
      ratio: String(form.get("ratio") || "16:9"),
      duration: Number.isFinite(duration) ? duration : 5,
      resolution,
      files: guardedFiles,
      billingLocalUserId: session.user.local_user_id,
      billingTaskId,
      billingIdempotencyKey: String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || ""),
      billingEstimatedQuotaUnits,
      billingMode,
      canvasScope,
      canvasRequestedAt: String(form.get("canvasRequestedAt") || ""),
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
