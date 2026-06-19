import { type NextRequest } from "next/server";

import { adminAdjustQuotaResponse } from "@/lib/server/admin/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminAdjustQuotaResponse(request, id);
}
