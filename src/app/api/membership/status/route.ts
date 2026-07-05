import { type NextRequest } from "next/server";

import { membershipStatusResponse } from "@/lib/server/membership";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return membershipStatusResponse(request);
}
