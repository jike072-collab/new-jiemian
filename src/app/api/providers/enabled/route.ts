import { NextResponse } from "next/server";

import { readEnabledProviders } from "@/lib/server/providers";

export const runtime = "nodejs";

export async function GET() {
  const [image, video] = await Promise.all([
    readEnabledProviders("image"),
    readEnabledProviders("video"),
  ]);
  return NextResponse.json({ providers: { image, video } });
}
