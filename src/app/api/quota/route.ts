import { type NextRequest } from "next/server";

import { quotaSnapshotResponse } from "@/lib/server/quota";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return quotaSnapshotResponse(request);
}
