import { NextResponse } from "next/server";

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
    return NextResponse.json({
      error: error instanceof Error ? error.message : "视频高清任务提交失败。",
    }, { status: 400 });
  }
}
