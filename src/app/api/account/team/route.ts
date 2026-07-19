import { type NextRequest, NextResponse } from "next/server";

import {
  authResultResponse,
  requireAuthSession,
  requireCsrf,
  readJsonBody,
} from "@/lib/server/auth";
import { getQuotaService } from "@/lib/server/quota";
import { getTeamService, TeamServiceError } from "@/lib/server/team";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof TeamServiceError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, code: "TEAM_CREATE_FAILED", message: "团队服务暂时不可用。" }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  try {
    const url = new URL(request.url);
    const ownerId = await getTeamService().getOwnerIdForUser(session.user.local_user_id);
    if (!ownerId) return errorResponse(new TeamServiceError("TEAM_FORBIDDEN", "只有主账号可以查看团队用量。", 403));
    const overview = await getTeamService().getOverview(ownerId, {
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    const quotaService = getQuotaService();
    const members = await Promise.all(overview.members.map(async (member) => {
      const quota = await quotaService.getCurrentQuota(member.localUserId).catch(() => null);
      return {
        ...member,
        currentCredits: quota?.ok ? quota.snapshot.quota_units : null,
      };
    }));
    return NextResponse.json({ ok: true, ...overview, members }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, {
    ok: false,
    status: 403,
    code: "AUTH_CSRF_REQUIRED",
    uiState: "validation_error",
    message: "CSRF token is required.",
  });
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const body = await readJsonBody(request);
  try {
    const ownerId = await getTeamService().getOwnerIdForUser(session.user.local_user_id);
    if (!ownerId) return errorResponse(new TeamServiceError("TEAM_FORBIDDEN", "只有主账号可以创建子账号。", 403));
    const member = await getTeamService().createMember({
      ownerId,
      email: String(body.email || ""),
      username: String(body.username || ""),
      displayName: String(body.displayName || body.display_name || ""),
      password: String(body.password || ""),
    });
    return NextResponse.json({ ok: true, member }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
