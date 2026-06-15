import { NextResponse } from "next/server";

import { readUpscaleStatus } from "@/lib/server/local-upscale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readUpscaleStatus());
}
