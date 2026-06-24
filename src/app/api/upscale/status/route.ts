import { NextResponse } from "next/server";

import { readUpscaleStatus } from "@/lib/server/volcengine-upscale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readUpscaleStatus());
}
