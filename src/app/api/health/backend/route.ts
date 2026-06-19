import { NextResponse, type NextRequest } from "next/server";

import { backendHealthHttpReport } from "@/lib/server/security/health";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || undefined;
  const mode = request.nextUrl.searchParams.get("mode");
  const ready = request.nextUrl.searchParams.get("ready");
  const response = await backendHealthHttpReport(mode === "readiness" || ready === "1" ? "readiness" : "liveness", requestId);
  return NextResponse.json(response.report, { status: response.status });
}
