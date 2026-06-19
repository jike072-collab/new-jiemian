import { type NextRequest } from "next/server";

import { createBillingOrderResponse, listBillingOrdersResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return createBillingOrderResponse(request);
}

export async function GET(request: NextRequest) {
  return listBillingOrdersResponse(request);
}
