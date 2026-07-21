import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { safeTikTokSecretEqual } from "@/lib/server/tiktok/crypto";
import { TIKTOK_OAUTH_STATE_COOKIE, tikTokErrorResponse, tikTokOAuthCookieOptions } from "@/lib/server/tiktok/http";
import { finishTikTokOAuth } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const state = request.nextUrl.searchParams.get("state") || "";
    const cookieState = request.cookies.get(TIKTOK_OAUTH_STATE_COOKIE)?.value || "";
    const connected = request.nextUrl.searchParams.get("connected") || "";
    const profileId = request.nextUrl.searchParams.get("profileId") || "";
    const accountId = request.nextUrl.searchParams.get("accountId") || "";
    if (!state || !cookieState || !safeTikTokSecretEqual(state, cookieState)) {
      return NextResponse.redirect(new URL("/canvas?scope=personal&tiktok=oauth_error", request.nextUrl.origin));
    }
    const completed = await finishTikTokOAuth({
      userId: session.user.local_user_id,
      state,
      connected,
      profileId,
      accountId,
    });
    const destination = new URL(completed.returnTo, request.nextUrl.origin);
    destination.searchParams.set("tiktok", "connected");
    const response = NextResponse.redirect(destination);
    response.cookies.set(TIKTOK_OAUTH_STATE_COOKIE, "", tikTokOAuthCookieOptions(request, 0));
    return response;
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-oauth-callback");
  }
}
