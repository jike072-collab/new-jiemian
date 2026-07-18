import { type NextRequest, NextResponse } from "next/server";

import { CanvasDocumentError } from "@/lib/canvas/document";
import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { CanvasProjectError, deleteCanvasProject, getCanvasProject, updateCanvasProject } from "@/lib/server/canvas-projects";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const { id } = await context.params;
    const project = await getCanvasProject(id, session.user.local_user_id);
    if (!project) throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
    return NextResponse.json({ project });
  } catch (error) {
    return canvasProjectErrorResponse(request, error, "读取画布失败。");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const { id } = await context.params;
    const body = await readCanvasBody(request);
    const project = await updateCanvasProject({
      id,
      userId: session.user.local_user_id,
      title: body.title,
      document: body.document,
      version: body.version,
    });
    return NextResponse.json({ project });
  } catch (error) {
    return canvasProjectErrorResponse(request, error, "保存画布失败。");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const { id } = await context.params;
    return NextResponse.json({ ok: true, id: await deleteCanvasProject(id, session.user.local_user_id) });
  } catch (error) {
    return canvasProjectErrorResponse(request, error, "删除画布失败。");
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
    operation: "canvas-project",
    defaultCode: "UNKNOWN_ERROR",
  });
}
