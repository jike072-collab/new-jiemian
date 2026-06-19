import { NextResponse, type NextRequest } from "next/server";

import { backendHealthReport } from "@/lib/server/security/health";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json(backendHealthReport(request.headers.get("x-request-id") || undefined));
}
