import { type NextRequest, NextResponse } from "next/server";

import { estimateImageGenerationEntitlementUnits } from "@/lib/generation-quota";
import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { failImageGenerationBeforeSubmit, generateImage, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { WorkloadLimitError, withUserImageEditWorkload, withUserImageWorkload, workloadLimitResponse } from "@/lib/server/workload-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const operation = String(form.get("operation") || "cloud_image_generation").trim() === "cloud_image_edit"
      ? "cloud_image_edit"
      : "cloud_image_generation";
    const billingTaskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const billingEstimatedQuotaUnits = Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const quality = String(form.get("quality") || "1k");
    const count = Number(form.get("count") || Number.NaN);
    const membershipEntitlementAmount = estimateImageGenerationEntitlementUnits({ quality, count });
    const failBeforeSubmit = (error: unknown) => failImageGenerationBeforeSubmit({
      localUserId: session.user.local_user_id,
      taskId: billingTaskId,
      operation,
      estimatedQuotaUnits: billingEstimatedQuotaUnits,
      membershipEntitlementAmount,
      reason: error instanceof Error ? error.message : "image generation rejected before provider submission",
    });
    const run = async () => {
      let files;
      try {
        files = await uploadedMediaFromForm(form);
      } catch (error) {
        await failBeforeSubmit(error);
        throw error;
      }
      return generateImage({
        providerId: String(form.get("providerId") || ""),
        mode: String(form.get("mode") || "text-to-image") === "image-to-image" ? "image-to-image" : "text-to-image",
        operation,
        prompt: String(form.get("prompt") || ""),
        ratio: String(form.get("ratio") || "1:1"),
        quality,
        files,
        count,
        batchId: String(form.get("batchId") || "").trim(),
        batchTotal: Number(form.get("batchTotal") || Number.NaN),
        billingLocalUserId: session.user.local_user_id,
        billingTaskId,
        billingIdempotencyKey: String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || ""),
        billingEstimatedQuotaUnits,
      });
    };
    let items;
    try {
      items = await (operation === "cloud_image_edit"
        ? withUserImageEditWorkload(session.user.local_user_id, run)
        : withUserImageWorkload(session.user.local_user_id, run));
    } catch (error) {
      if (error instanceof WorkloadLimitError) await failBeforeSubmit(error);
      throw error;
    }
    return NextResponse.json({ item: items[0] || null, items });
  } catch (error) {
    if (error instanceof WorkloadLimitError) return workloadLimitResponse(error);
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "图片生成失败。",
      tool: "image",
      operation: "generate-image",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
