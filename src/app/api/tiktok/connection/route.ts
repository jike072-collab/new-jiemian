import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, readJsonBody, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { tikTokErrorResponse } from "@/lib/server/tiktok/http";
import { claimTikTokAccount, disconnectTikTok, tikTokConnectionStatus } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    return NextResponse.json(await tikTokConnectionStatus(session.user.local_user_id));
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-connection-read");
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readJsonBody(request);
    return NextResponse.json({
      ok: true,
      connection: await claimTikTokAccount(
        session.user.local_user_id,
        String(body.zernioCredentialId || ""),
        String(body.zernioProfileId || ""),
        String(body.zernioAccountId || ""),
      ),
    });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-connection-claim");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readJsonBody(request);
    return NextResponse.json({
      ok: true,
      disconnected: await disconnectTikTok(session.user.local_user_id, String(body.zernioAccountId || "")),
    });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-connection-delete");
  }
}
