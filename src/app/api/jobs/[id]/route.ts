import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { refreshVideoJob } from "@/lib/server/provider-call";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const { id } = await context.params;
    return NextResponse.json({ job: await refreshVideoJob(id, session.user.local_user_id) });
  } catch (error) {
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "Job lookup failed.",
      tool: "video",
      operation: "poll-job",
      defaultCode: "TASK_POLL_FAILED",
    });
  }
}
