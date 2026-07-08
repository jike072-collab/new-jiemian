import { type NextRequest } from "next/server";

import { adminGrantMembershipResponse } from "@/lib/server/admin/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminGrantMembershipResponse(request, id);
}
