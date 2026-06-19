import { type NextRequest } from "next/server";

import { productionWebhookResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return productionWebhookResponse(request);
}
