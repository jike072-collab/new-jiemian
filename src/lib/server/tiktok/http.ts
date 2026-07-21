import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { ZernioApiError } from "./client";
import { TikTokConfigurationError } from "./config";
import { TikTokPublishingError } from "./service";

export const TIKTOK_OAUTH_STATE_COOKIE = "aohuang_tiktok_oauth_state";

export function tikTokOAuthCookieOptions(request: NextRequest, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/api/tiktok/oauth",
    maxAge,
  };
}

export function tikTokErrorResponse(request: NextRequest, error: unknown, operation: string) {
  if (error instanceof TikTokPublishingError || error instanceof ZernioApiError || error instanceof TikTokConfigurationError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return diagnosticErrorResponse(error, {
    requestId: request.headers.get("x-request-id"),
    fallbackMessage: "TikTok 操作失败，请稍后重试。",
    operation,
    defaultCode: "UNKNOWN_ERROR",
  });
}
