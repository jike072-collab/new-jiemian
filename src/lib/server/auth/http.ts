import { type NextRequest, NextResponse } from "next/server";

import { AUTH_CSRF_COOKIE, AUTH_SESSION_COOKIE, clearSessionCookieOptions, csrfCookieOptions, sessionCookieOptions } from "./cookies";
import { createCsrfToken, verifyCsrfToken } from "./csrf";
import { getAuthService } from "./service";
import { safeRedirectPath } from "./normalize";
import { type AuthActionResult, type AuthFailure, type AuthRequestContext, type AuthResult } from "./types";

type JsonBody = Record<string, unknown>;

export function authRequestContext(request: NextRequest): AuthRequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    requestId: request.headers.get("x-request-id") || undefined,
    ip: forwardedFor || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };
}

export function sessionTokenFromRequest(request: NextRequest) {
  return request.cookies.get(AUTH_SESSION_COOKIE)?.value || null;
}

export function csrfFailure(): AuthFailure {
  return {
    ok: false,
    status: 403,
    code: "AUTH_CSRF_REQUIRED",
    uiState: "validation_error",
    message: "CSRF token is required.",
  };
}

export function requireCsrf(request: NextRequest) {
  return verifyCsrfToken({
    headerToken: request.headers.get("x-csrf-token"),
    cookieToken: request.cookies.get(AUTH_CSRF_COOKIE)?.value,
  });
}

export async function readJsonBody(request: NextRequest): Promise<JsonBody> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as JsonBody : {};
  } catch {
    return {};
  }
}

function failureResponse(result: AuthFailure) {
  return NextResponse.json({
    ok: false,
    code: result.code,
    uiState: result.uiState,
    message: result.message,
    retryAfterSeconds: result.retryAfterSeconds,
  }, { status: result.status });
}

export function authResultResponse(request: NextRequest, result: AuthResult) {
  if (!result.ok) return failureResponse(result);

  const response = NextResponse.json({
    ok: true,
    uiState: result.uiState,
    user: result.user,
    mappingStatus: result.mappingStatus,
    redirectTo: result.redirectTo,
  }, { status: result.status });

  if (result.session) {
    response.cookies.set(
      AUTH_SESSION_COOKIE,
      result.session.token,
      sessionCookieOptions(request, result.session.cookieMaxAgeSeconds),
    );
  }

  return response;
}

export function authActionResponse(request: NextRequest, result: AuthActionResult) {
  if (!result.ok) return failureResponse(result);
  const response = NextResponse.json({
    ok: true,
    uiState: result.uiState,
    message: result.message,
  }, { status: result.status });
  response.cookies.set(AUTH_SESSION_COOKIE, "", clearSessionCookieOptions(request));
  return response;
}

export function csrfResponse(request: NextRequest) {
  const csrfToken = createCsrfToken();
  const response = NextResponse.json({
    ok: true,
    csrfToken,
    uiState: "success",
  });
  response.cookies.set(AUTH_CSRF_COOKIE, csrfToken, csrfCookieOptions(request));
  return response;
}

export async function requireAuthSession(request: NextRequest) {
  return getAuthService().currentUser(sessionTokenFromRequest(request), authRequestContext(request));
}

export function redirectFromBody(body: JsonBody) {
  return safeRedirectPath(body.redirectTo);
}
