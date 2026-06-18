import { type NextRequest } from "next/server";

import { csrfFailure, requireCsrf } from "@/lib/server/auth";
import { authResultResponse } from "@/lib/server/auth/http";
import { precheckResponse } from "@/lib/server/quota";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  return precheckResponse(request);
}
