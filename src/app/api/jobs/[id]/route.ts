import { NextResponse } from "next/server";

import { refreshVideoJob } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ job: await refreshVideoJob(id) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "任务查询失败。",
    }, { status: 404 });
  }
}
