import { type NextRequest, NextResponse } from "next/server";

import { authRequestContext, authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { CanvasAssistantError, getCanvasAssistantService } from "@/lib/server/canvas-assistant";
import { getInternalCanvasAccess } from "@/lib/server/internal-canvas-access";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";

export const runtime = "nodejs";

const limiter = new InMemoryRateLimiter(30, 60_000);

export async function POST(request: NextRequest) {
  if (!isInternalCanvasHostname(request.headers.get("host"))) {
    return NextResponse.json({ ok: false, code: "CANVAS_ASSISTANT_INTERNAL_ONLY", message: "Not found." }, { status: 404 });
  }
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const access = await getInternalCanvasAccess(session.user.local_user_id);
  if (!access?.enabled) {
    return NextResponse.json({ ok: false, code: "AUTH_INTERNAL_ACCESS_REQUIRED", message: "Permission denied." }, { status: 403 });
  }
  const context = authRequestContext(request);
  const rate = limiter.consume(`${session.user.local_user_id}:${context.ip || "unknown"}`);
  if (!rate.allowed) {
    return NextResponse.json({ ok: false, code: "rate_limited", message: "请求太频繁，请稍后再试。", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }
  try {
    const body = await request.json();
    const result = await getCanvasAssistantService().answer(body, context.requestId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CanvasAssistantError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, code: "CANVAS_ASSISTANT_FAILED", message: "助手暂时不可用，请稍后重试。" }, { status: 502 });
  }
}
