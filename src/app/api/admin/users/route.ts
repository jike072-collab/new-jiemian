import { type NextRequest } from "next/server";

import { adminListUsersResponse } from "@/lib/server/admin/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminListUsersResponse(request);
}
