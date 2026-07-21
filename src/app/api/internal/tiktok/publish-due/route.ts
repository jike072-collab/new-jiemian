import { type NextRequest, NextResponse } from "next/server";

import { getTikTokConfiguration } from "@/lib/server/tiktok/config";
import { safeTikTokSecretEqual } from "@/lib/server/tiktok/crypto";
import { tikTokErrorResponse } from "@/lib/server/tiktok/http";
import { processDueTikTokPublishJobs } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const config = getTikTokConfiguration();
    const authorization = request.headers.get("authorization") || "";
    const expected = config.workerSecret ? `Bearer ${config.workerSecret}` : "";
    if (!expected || !safeTikTokSecretEqual(authorization, expected)) {
      return NextResponse.json({ ok: false, code: "TIKTOK_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ ok: true, ...(await processDueTikTokPublishJobs({ limit: 1 })) });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-publish-worker");
  }
}
