import { type NextRequest } from "next/server";

import { sandboxWebhookResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return sandboxWebhookResponse(request);
}
