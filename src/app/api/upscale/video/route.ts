import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { claimTunneltestLimit, tunneltestLimitResponse } from "@/lib/server/tunneltest-limits";
import { assertVideoUpscaleReady, submitVideoUpscale as runSubmitVideoUpscale, uploadedUpscaleFile } from "@/lib/server/volcengine-upscale";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const form = await request.formData();
    const requestedScale = Number(form.get("scale"));
    if (requestedScale !== 1 && requestedScale !== 2 && requestedScale !== 4) {
      throw new Error("视频高清仅支持 1K、2K 或 4K。");
    }
    const scale = requestedScale;
    const file = await uploadedUpscaleFile(form, "video");
    await assertVideoUpscaleReady();
    const taskId = String(form.get("taskId") || form.get("billingTaskId") || "");
    const idempotencyKey = String(form.get("idempotencyKey") || form.get("billingIdempotencyKey") || "");
    const estimatedQuotaUnits = Number(form.get("estimatedQuotaUnits") || form.get("billingEstimatedQuotaUnits") || Number.NaN);
    const tunneltest = await claimTunneltestLimit({
      localUserId: session.user.local_user_id,
      operation: "cloud_video_upscale",
      taskId,
      idempotencyKey,
    });
    if (tunneltest && !tunneltest.ok) return tunneltestLimitResponse(tunneltest);
    return NextResponse.json(await runSubmitVideoUpscale(file, scale, session.user.local_user_id, taskId, idempotencyKey, estimatedQuotaUnits));
  } catch (error) {
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "视频高清任务提交失败。",
      tool: "video-upscale",
      operation: "upscale-video",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}
