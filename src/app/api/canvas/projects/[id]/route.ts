import { type NextRequest, NextResponse } from "next/server";

import { CanvasDocumentError } from "@/lib/canvas/document";
import { authResultResponse, csrfFailure, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { CanvasProjectError, deleteCanvasProject, getCanvasProject, updateCanvasProject } from "@/lib/server/canvas-projects";
import { resolveCanvasWorkspace } from "@/lib/server/canvas-workspace-access";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { InternalCanvasAccessError } from "@/lib/server/internal-canvas-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const { id } = await context.params;
    const workspace = await resolveCanvasWorkspace(request, session.user.local_user_id);
    const project = await getCanvasProject(id, workspace.ownerId, workspace.scope);
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
    const workspace = await resolveCanvasWorkspace(request, session.user.local_user_id);
    const result = await updateCanvasProject({
      id,
      userId: workspace.ownerId,
      scope: workspace.scope,
      title: body.title,
      document: body.document,
      version: body.version,
      baseTitle: body.baseTitle,
      baseDocument: body.baseDocument,
      sourceId: body.sourceId,
    });
    return NextResponse.json(result);
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
    const workspace = await resolveCanvasWorkspace(request, session.user.local_user_id);
    return NextResponse.json({
      ok: true,
      id: await deleteCanvasProject(id, workspace.ownerId, workspace.scope, request.nextUrl.searchParams.get("client")),
    });
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
  if (error instanceof CanvasDocumentError || error instanceof CanvasProjectError || error instanceof InternalCanvasAccessError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return diagnosticErrorResponse(error, {
    requestId: request.headers.get("x-request-id"),
    fallbackMessage,
    operation: "canvas-project",
    defaultCode: "UNKNOWN_ERROR",
  });
}
