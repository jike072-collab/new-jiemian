import { paymentConfigResponse } from "@/lib/server/billing";

export const runtime = "nodejs";

export async function GET() {
  return paymentConfigResponse();
}
