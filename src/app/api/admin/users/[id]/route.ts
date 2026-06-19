import { type NextRequest } from "next/server";

import { adminGetUserResponse } from "@/lib/server/admin/http";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminGetUserResponse(request, id);
}
