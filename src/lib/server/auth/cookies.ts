import { type NextRequest } from "next/server";

import { AUTH_SESSION_IDLE_SECONDS } from "./types";

export const AUTH_SESSION_COOKIE = "aohuang_session";
export const AUTH_CSRF_COOKIE = "aohuang_csrf";

function forwardedProto(request?: NextRequest) {
  return request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
}

export function isSecureRequest(request?: NextRequest) {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;
  if (forwardedProto(request) === "https") return true;
  const host = request?.headers.get("host") || "";
  return process.env.NODE_ENV === "production" && !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

export function sessionCookieOptions(request?: NextRequest, maxAge = AUTH_SESSION_IDLE_SECONDS) {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function clearSessionCookieOptions(request?: NextRequest) {
  return {
    ...sessionCookieOptions(request, 0),
    maxAge: 0,
  };
}

export function csrfCookieOptions(request?: NextRequest, maxAge = 60 * 60) {
  return {
    httpOnly: false,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
