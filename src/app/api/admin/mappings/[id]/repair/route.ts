import { type NextRequest } from "next/server";

import { adminRepairMappingResponse } from "@/lib/server/admin/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminRepairMappingResponse(request, id);
}
