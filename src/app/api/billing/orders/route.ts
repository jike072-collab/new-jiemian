import { type NextRequest } from "next/server";

import { createBillingOrderResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return createBillingOrderResponse(request);
}
