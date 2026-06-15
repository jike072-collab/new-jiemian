import { NextResponse } from "next/server";

import { submitVideo, uploadedMediaFromForm } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const duration = Number(form.get("duration") || 5);
    const result = await submitVideo({
      providerId: String(form.get("providerId") || ""),
      mode: String(form.get("mode") || "text-to-video") === "image-to-video" ? "image-to-video" : "text-to-video",
      prompt: String(form.get("prompt") || ""),
      ratio: String(form.get("ratio") || "16:9"),
      duration: Number.isFinite(duration) ? duration : 5,
      files: await uploadedMediaFromForm(form),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "视频生成失败。",
    }, { status: 400 });
  }
}
