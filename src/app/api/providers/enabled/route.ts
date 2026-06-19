import { NextResponse } from "next/server";

import { readFrontendProviders } from "@/lib/server/providers";

export const runtime = "nodejs";

export async function GET() {
  const [image, video] = await Promise.all([
    readFrontendProviders("image"),
    readFrontendProviders("video"),
  ]);
  return NextResponse.json({ providers: { image, video } });
}
