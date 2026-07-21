import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { tikTokErrorResponse } from "@/lib/server/tiktok/http";
import { getTikTokCreatorInfo } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    return NextResponse.json({ creator: await getTikTokCreatorInfo(session.user.local_user_id) });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-creator-info");
  }
}
