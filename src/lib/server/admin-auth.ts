import { type NextRequest, NextResponse } from "next/server";

function isLocalRequest(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  if (!forwarded) return true;
  return forwarded.split(",").some((value) => {
    const ip = value.trim().toLowerCase();
    return ip === "127.0.0.1"
      || ip === "::1"
      || ip === "::ffff:127.0.0.1"
      || ip === "localhost";
  });
}

export function requireAdmin(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password && isLocalRequest(request)) return null;
  if (password && request.headers.get("x-admin-password") === password) return null;
  return NextResponse.json({ error: "管理后台需要验证。" }, { status: 401 });
}
