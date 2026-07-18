import { type NextRequest, NextResponse } from "next/server";

import { CanvasDocumentError, emptyCanvasDocument } from "@/lib/canvas/document";
import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { CanvasProjectError, createCanvasProject, listCanvasProjects } from "@/lib/server/canvas-projects";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    return NextResponse.json({ projects: await listCanvasProjects(session.user.local_user_id) });
  } catch (error) {
    return canvasProjectErrorResponse(request, error, "读取画布失败。");
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readCanvasBody(request);
    const project = await createCanvasProject({
      userId: session.user.local_user_id,
      title: body.title || "未命名画布",
      document: body.document || emptyCanvasDocument(),
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return canvasProjectErrorResponse(request, error, "创建画布失败。");
  }
}

async function readCanvasBody(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_600_000) throw new CanvasDocumentError("画布内容过大。");
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    throw new CanvasDocumentError("画布请求格式无效。");
  }
}

function canvasProjectErrorResponse(request: NextRequest, error: unknown, fallbackMessage: string) {
  if (error instanceof CanvasDocumentError || error instanceof CanvasProjectError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return diagnosticErrorResponse(error, {
    requestId: request.headers.get("x-request-id"),
    fallbackMessage,
    operation: "canvas-projects",
    defaultCode: "UNKNOWN_ERROR",
  });
}
