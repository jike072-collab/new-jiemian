import { type NextRequest } from "next/server";

import { csrfResponse } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return csrfResponse(request);
}
