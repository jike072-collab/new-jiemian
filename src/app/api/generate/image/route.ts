import { NextResponse } from "next/server";

import { generateImage, uploadedMediaFromForm } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const item = await generateImage({
      providerId: String(form.get("providerId") || ""),
      mode: String(form.get("mode") || "text-to-image") === "image-to-image" ? "image-to-image" : "text-to-image",
      prompt: String(form.get("prompt") || ""),
      ratio: String(form.get("ratio") || "1:1"),
      quality: String(form.get("quality") || "1k"),
      files: await uploadedMediaFromForm(form),
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "图片生成失败。",
    }, { status: 400 });
  }
}
