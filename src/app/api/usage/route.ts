import { type NextRequest } from "next/server";

import { usagePageResponse } from "@/lib/server/quota";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return usagePageResponse(request);
}
