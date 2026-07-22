import { type NextRequest, NextResponse } from "next/server";

import { authRequestContext, authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { generateMalaysiaTikTokCopy } from "@/lib/server/tiktok/copy";
import { tikTokErrorResponse } from "@/lib/server/tiktok/http";

export const runtime = "nodejs";

const limiter = new InMemoryRateLimiter(12, 60_000);

export async function POST(request: NextRequest) {
  if (!isInternalCanvasHostname(request.headers.get("host"))) {
    return NextResponse.json({ ok: false, code: "TIKTOK_COPY_INTERNAL_ONLY", message: "Not found." }, { status: 404 });
  }
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const access = await getInternalCanvasAccess(session.user.local_user_id);
  if (!access?.enabled) {
    return NextResponse.json({ ok: false, code: "TIKTOK_COPY_FORBIDDEN", message: "当前账号不能使用内部画布。" }, { status: 403 });
  }
  const context = authRequestContext(request);
  const rate = limiter.consume(`${session.user.local_user_id}:${context.ip || "unknown"}`);
  if (!rate.allowed) {
    return NextResponse.json({ ok: false, code: "rate_limited", message: "文案生成太频繁，请稍后再试。", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }
  try {
    const body = await request.json() as { libraryItemId?: unknown; angle?: unknown; scope?: unknown };
    const scope = body.scope === "personal" ? "personal" : "shared";
    const ownerIds = scope === "shared"
      ? (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds
      : [session.user.local_user_id];
    const draft = await generateMalaysiaTikTokCopy({
      libraryItemId: String(body.libraryItemId || ""),
      ownerIds,
      scope,
      angle: body.angle,
      requestId: context.requestId,
    });
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-copy");
  }
}
