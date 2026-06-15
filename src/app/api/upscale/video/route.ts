import { NextResponse } from "next/server";

import { submitVideoUpscale, uploadedUpscaleFile } from "@/lib/server/local-upscale";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const scale = Number(form.get("scale")) === 4 ? 4 : 2;
    const file = await uploadedUpscaleFile(form, "video");
    return NextResponse.json(await submitVideoUpscale(file, scale));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "视频高清任务提交失败。",
    }, { status: 400 });
  }
}
