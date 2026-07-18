import { type NextRequest, NextResponse } from "next/server";

import { estimateImageGenerationEntitlementUnits } from "@/lib/generation-quota";
import {
  ecommerceTenPageBatchStyleCount,
  ecommerceTenPageCount,
  ecommerceTenPageMaxReferenceCount,
  ecommerceTenPageMinReferenceCount,
  isWhiteBackgroundFourViewPreset,
  isEcommerceTenPagePreset,
  whiteBackgroundFourViewPrompt,
  whiteBackgroundFourViewQuality,
  whiteBackgroundFourViewRatio,
  whiteBackgroundFourViewReferenceCount,
} from "@/lib/image-presets";
import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse, GenerationDiagnosticError } from "@/lib/server/error-diagnostics";
import { failImageGenerationBeforeSubmit, generateImage, uploadedMediaFromForm } from "@/lib/server/provider-call";
import { ecommerceTenPagePromptForPage } from "@/lib/server/prompts/ecommerce";
import { WorkloadLimitError, withUserEcommerceImageWorkload, withUserImageEditWorkload, withUserImageWorkload, workloadLimitResponse } from "@/lib/server/workload-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const preset = String(form.get("preset") || "").trim();
    const whiteBackgroundFourView = isWhiteBackgroundFourViewPreset(preset);
    const ecommerceTenPage = isEcommerceTenPagePreset(preset);
    const operation = whiteBackgroundFourView || ecommerceTenPage ? "cloud_image_generation" : String(form.get("operation") || "cloud_image_generation").trim() === "cloud_image_edit"
      ? "cloud_image_edit"
      : "cloud_image_generation";
    const billingTaskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const billingEstimatedQuotaUnits = Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const quality = whiteBackgroundFourView ? whiteBackgroundFourViewQuality : String(form.get("quality") || "1k");
    const count = whiteBackgroundFourView || ecommerceTenPage ? 1 : Number(form.get("count") || Number.NaN);
    const pageIndex = Number(form.get("pageIndex") || Number.NaN);
    const requestedBatchTotal = Number(form.get("batchTotal") || Number.NaN);
    const requestedBatchStyleIndex = Number(form.get("batchStyleIndex") || Number.NaN);
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
      if (whiteBackgroundFourView && files.length !== whiteBackgroundFourViewReferenceCount) {
        const error = new GenerationDiagnosticError({
          code: "INPUT_INVALID_PARAMETERS",
          message: `White background four-view generation requires ${whiteBackgroundFourViewReferenceCount} reference images.`,
          publicMessage: "请按外侧、内侧、顶部、鞋底顺序上传 4 张图片。",
          status: 400,
        });
        await failBeforeSubmit(error);
        throw error;
      }
      if (ecommerceTenPage && (files.length < ecommerceTenPageMinReferenceCount || files.length > ecommerceTenPageMaxReferenceCount)) {
        const error = new GenerationDiagnosticError({
          code: "INPUT_INVALID_PARAMETERS",
          message: `E-commerce ten-page generation requires ${ecommerceTenPageMinReferenceCount}-${ecommerceTenPageMaxReferenceCount} reference images.`,
          publicMessage: "请上传 1 张 Logo 和至少 1 张配色四视图白底图，最多支持 9 张配色图。",
          status: 400,
        });
        await failBeforeSubmit(error);
        throw error;
      }
      if (ecommerceTenPage && (!Number.isInteger(requestedBatchTotal) || requestedBatchTotal < 1 || requestedBatchTotal > ecommerceTenPageCount)) {
        const error = new GenerationDiagnosticError({
          code: "INPUT_INVALID_PARAMETERS",
          message: `E-commerce image batch total must be between 1 and ${ecommerceTenPageCount}.`,
          publicMessage: "电商套图生成数量必须在 1 到 10 张之间。",
          status: 400,
        });
        await failBeforeSubmit(error);
        throw error;
      }
      if (ecommerceTenPage && (!Number.isInteger(pageIndex) || pageIndex < 1 || pageIndex > requestedBatchTotal)) {
        const error = new GenerationDiagnosticError({
          code: "INPUT_INVALID_PARAMETERS",
          message: `E-commerce ten-page page index must be between 1 and ${ecommerceTenPageCount}.`,
          publicMessage: "电商套图页面编号无效，请重新提交。",
          status: 400,
        });
        await failBeforeSubmit(error);
        throw error;
      }
      if (ecommerceTenPage && (!Number.isInteger(requestedBatchStyleIndex) || requestedBatchStyleIndex < 0 || requestedBatchStyleIndex >= ecommerceTenPageBatchStyleCount)) {
        const error = new GenerationDiagnosticError({
          code: "INPUT_INVALID_PARAMETERS",
          message: `E-commerce batch style index must be between 0 and ${ecommerceTenPageBatchStyleCount - 1}.`,
          publicMessage: "电商套图风格参数无效，请重新提交。",
          status: 400,
        });
        await failBeforeSubmit(error);
        throw error;
      }
      const prompt = whiteBackgroundFourView
        ? whiteBackgroundFourViewPrompt
        : ecommerceTenPage
          ? await ecommerceTenPagePromptForPage({
            ownerLocalUserId: session.user.local_user_id,
            batchId: String(form.get("batchId") || "").trim(),
            pageCount: requestedBatchTotal,
            pageIndex,
            ratio: String(form.get("ratio") || "1:1"),
            batchStyleIndex: requestedBatchStyleIndex,
            references: files,
          })
          : String(form.get("prompt") || "");
      return generateImage({
        providerId: String(form.get("providerId") || ""),
        mode: whiteBackgroundFourView || ecommerceTenPage || String(form.get("mode") || "text-to-image") === "image-to-image" ? "image-to-image" : "text-to-image",
        operation,
        prompt,
        ratio: whiteBackgroundFourView ? whiteBackgroundFourViewRatio : String(form.get("ratio") || "1:1"),
        quality,
        files,
        count,
        batchId: String(form.get("batchId") || "").trim(),
        batchTotal: requestedBatchTotal,
        batchStyleIndex: ecommerceTenPage ? requestedBatchStyleIndex : undefined,
        pageIndex: ecommerceTenPage ? pageIndex : undefined,
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
        : ecommerceTenPage
          ? withUserEcommerceImageWorkload(session.user.local_user_id, run)
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
