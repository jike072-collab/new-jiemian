import { type NextRequest } from "next/server";

import { checkInStatusResponse, claimDailyCheckInResponse } from "@/lib/server/check-in";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return checkInStatusResponse(request);
}

export async function POST(request: NextRequest) {
  return claimDailyCheckInResponse(request);
}
