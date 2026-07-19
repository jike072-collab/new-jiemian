import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, readJsonBody, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import {
  InternalCanvasAccessError,
  listInternalCanvasAccessCandidates,
  setInternalCanvasAccess,
} from "@/lib/server/internal-canvas-access";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof InternalCanvasAccessError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, code: "INTERNAL_ACCESS_UNAVAILABLE", message: "内部准入服务暂时不可用。" }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  try {
    const query = new URL(request.url).searchParams.get("query") || "";
    const accounts = await listInternalCanvasAccessCandidates(session.user.local_user_id, query);
    return NextResponse.json({ ok: true, accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!requireCsrf(request)) {
    return NextResponse.json({ ok: false, code: "AUTH_CSRF_REQUIRED", message: "CSRF token is required." }, { status: 403 });
  }
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const body = await readJsonBody(request);
  try {
    const access = await setInternalCanvasAccess({
      ownerId: session.user.local_user_id,
      targetUserId: String(body.localUserId || body.local_user_id || ""),
      enabled: body.enabled === true,
    });
    return NextResponse.json({ ok: true, access });
  } catch (error) {
    return errorResponse(error);
  }
}
