import { NextResponse } from "next/server";

import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { uploadedUpscaleFile, upscaleImage } from "@/lib/server/volcengine-upscale";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const requestedScale = Number(form.get("scale"));
    if (requestedScale !== 1 && requestedScale !== 2 && requestedScale !== 4) {
      throw new Error("图片高清仅支持 1K、2K 或 4K。");
    }
    const scale = requestedScale;
    const file = await uploadedUpscaleFile(form, "image");
    return NextResponse.json({ item: await upscaleImage(file, scale), job: null });
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
