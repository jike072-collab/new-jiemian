import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, readJsonBody, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { TIKTOK_OAUTH_STATE_COOKIE, tikTokErrorResponse, tikTokOAuthCookieOptions } from "@/lib/server/tiktok/http";
import { beginTikTokOAuth } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readJsonBody(request);
    const oauth = await beginTikTokOAuth(
      session.user.local_user_id,
      typeof body.returnTo === "string" ? body.returnTo : "/canvas?scope=personal",
    );
    const response = NextResponse.json({ ok: true, authorizationUrl: oauth.authorizationUrl });
    response.cookies.set(TIKTOK_OAUTH_STATE_COOKIE, oauth.state, tikTokOAuthCookieOptions(request, 10 * 60));
    return response;
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-oauth-start");
  }
}
