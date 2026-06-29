import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { claimTunneltestLimit, tunneltestLimitResponse } from "@/lib/server/tunneltest-limits";
import { assertImageUpscaleReady, uploadedUpscaleFile, upscaleImage as runUpscaleImage } from "@/lib/server/volcengine-upscale";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const requestedScale = Number(form.get("scale"));
    if (requestedScale !== 1 && requestedScale !== 2 && requestedScale !== 4) {
      throw new Error("图片高清仅支持 1K、2K 或 4K。");
    }
    const scale = requestedScale;
    const file = await uploadedUpscaleFile(form, "image");
    await assertImageUpscaleReady();
    const taskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const idempotencyKey = String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || "");
    const estimatedQuotaUnits = Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const tunneltest = await claimTunneltestLimit({
      localUserId: session.user.local_user_id,
      operation: "cloud_image_upscale",
      taskId,
      idempotencyKey,
    });
    if (tunneltest && !tunneltest.ok) return tunneltestLimitResponse(tunneltest);
    return NextResponse.json({
      item: await runUpscaleImage(file, scale, session.user.local_user_id, taskId, idempotencyKey, estimatedQuotaUnits),
      job: null,
    });
  } catch (error) {
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "图片高清处理失败。",
      tool: "image-upscale",
      operation: "upscale-image",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
