import { type NextRequest, NextResponse } from "next/server";

import {
  authResultResponse,
  csrfFailure,
  requireAuthSession,
  requireCsrf,
} from "../auth";
import { getDailyCheckInService } from "./service";
import { type DailyCheckInFailure } from "./service";

function checkInErrorResponse(input: DailyCheckInFailure) {
  return NextResponse.json({
    ok: false,
    code: input.code,
    message: input.message,
  }, { status: input.status });
}

async function requireLocalUser(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({
        ok: false,
        code: "permission_denied",
        message: "Permission denied.",
      }, { status: session.status }),
    };
  }
  return { ok: true as const, localUserId: session.user.local_user_id };
}

export async function checkInStatusResponse(request: NextRequest) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const result = await getDailyCheckInService().getStatus(auth.localUserId);
  return NextResponse.json({
    ok: true,
    checkIn: result.checkIn,
    records: result.records,
  }, { status: result.status });
}

export async function claimDailyCheckInResponse(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const result = await getDailyCheckInService().claim(auth.localUserId);
  if (!result.ok) return checkInErrorResponse(result);
  return NextResponse.json({
    ok: true,
    action: result.action,
    quota_delta: result.quota_delta,
    checkIn: result.checkIn,
    records: result.records,
  }, { status: result.status });
}
