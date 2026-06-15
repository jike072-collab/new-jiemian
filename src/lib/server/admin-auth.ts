import { type NextRequest, NextResponse } from "next/server";

function isLoopback(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1"
    || normalized === "localhost";
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    if (!isLoopback(new URL(`http://${host}`).hostname)) return false;
  } catch {
    return false;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  return !forwarded || isLoopback(forwarded.split(",")[0]);
}

export function requireAdmin(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password && isLocalRequest(request)) return null;
  if (password && request.headers.get("x-admin-password") === password) return null;
  return NextResponse.json({ error: "管理后台需要验证。" }, { status: 401 });
}
