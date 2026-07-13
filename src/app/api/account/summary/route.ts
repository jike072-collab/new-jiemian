import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { getDailyCheckInService } from "@/lib/server/check-in";
import { getMembershipService } from "@/lib/server/membership";
import { getQuotaService } from "@/lib/server/quota";

export const runtime = "nodejs";

function emptyMembershipStatus() {
  return {
    active: null,
    queued: null,
    recharge_bonus_basis_points: 0,
    entitlements: {
      prompt_optimize: { remaining: 0, granted: 0, used: 0 },
      image_generation: { remaining: 0, granted: 0, used: 0 },
      video_generation: { remaining: 0, granted: 0, used: 0 },
      image_edit: { remaining: 0, granted: 0, used: 0 },
      image_upscale: { remaining: 0, granted: 0, used: 0 },
      video_upscale: { remaining: 0, granted: 0, used: 0 },
    },
  };
}

function emptyCheckInStatus() {
  const now = new Date();
  return {
    ok: true as const,
    checkIn: {
      status: "available" as const,
      check_in_date: "",
      reward_quota: 0,
      time_zone: "Asia/Shanghai" as const,
      next_reset_at: now.toISOString(),
      claimed_at: null,
    },
    records: [],
  };
}

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);

  const localUserId = session.user.local_user_id;
  const quotaService = getQuotaService();
  const membershipService = getMembershipService();
  const checkInService = getDailyCheckInService();

  const [membership, checkInResult] = await Promise.all([
    membershipService.getStatus(localUserId).catch(() => emptyMembershipStatus()),
    checkInService.getStatus(localUserId).catch(() => emptyCheckInStatus()),
  ]);
  const quotaResult = await quotaService.getCurrentQuota(localUserId, { allowCached: false }).catch(() => null);
  const quota = quotaResult?.ok ? quotaResult.snapshot : null;

  return NextResponse.json({
    ok: true,
    user: session.user,
    credits: quota?.quota_units ?? null,
    expireAt: membership.active?.ends_at ?? null,
    quotas: membership.entitlements,
    checkinStatus: checkInResult.checkIn.status,
    quota,
    membership: {
      ok: true,
      plans: membershipService.listPlans(),
      membership,
    },
    checkIn: {
      ok: true,
      checkIn: checkInResult.checkIn,
      records: checkInResult.records,
    },
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
