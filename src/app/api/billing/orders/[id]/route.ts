import { type NextRequest } from "next/server";

import { getBillingOrderResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getBillingOrderResponse(request, id);
}
