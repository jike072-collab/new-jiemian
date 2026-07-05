import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "../auth";
import { getMembershipService } from "./service";

export async function membershipStatusResponse(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const membership = getMembershipService();
  return NextResponse.json({
    ok: true,
    plans: membership.listPlans(),
    membership: await membership.getStatus(session.user.local_user_id),
  });
}
