import { NextResponse } from "next/server";

import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { submitVideoUpscale, uploadedUpscaleFile } from "@/lib/server/volcengine-upscale";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const requestedScale = Number(form.get("scale"));
    if (requestedScale !== 1 && requestedScale !== 2 && requestedScale !== 4) {
      throw new Error("视频高清仅支持 1K、2K 或 4K。");
    }
    const scale = requestedScale;
    const file = await uploadedUpscaleFile(form, "video");
    return NextResponse.json(await submitVideoUpscale(file, scale));
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
