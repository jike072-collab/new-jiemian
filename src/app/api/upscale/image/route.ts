import { NextResponse } from "next/server";

import { uploadedUpscaleFile, upscaleImage } from "@/lib/server/local-upscale";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const scale = Number(form.get("scale")) === 2 ? 2 : 4;
    const file = await uploadedUpscaleFile(form, "image");
    return NextResponse.json({ item: await upscaleImage(file, scale), job: null });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "图片高清处理失败。",
    }, { status: 400 });
  }
}
