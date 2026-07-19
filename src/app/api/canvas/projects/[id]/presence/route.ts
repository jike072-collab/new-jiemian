import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { broadcastCanvasProjectEvent } from "@/lib/server/canvas-collaboration";
import { listCanvasPresence, removeCanvasPresence, upsertCanvasPresence } from "@/lib/server/canvas-presence";
import { CanvasProjectError, getCanvasProject } from "@/lib/server/canvas-projects";
import { resolveCanvasWorkspaceOwner } from "@/lib/server/canvas-workspace-access";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { InternalCanvasAccessError } from "@/lib/server/internal-canvas-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

class CanvasPresenceError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "CanvasPresenceError";
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const access = await requirePresenceProject(request, context);
    return NextResponse.json({ presences: listCanvasPresence(access.project.id) });
  } catch (error) {
    return presenceErrorResponse(request, error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const access = await requirePresenceProject(request, context);
    const body = await readPresenceBody(request);
    const clientId = normalizeClientId(body.clientId);
    const validNodeIds = new Set(access.project.document.nodes.map((node) => node.id));
    const selectedNodeIds = normalizeNodeIds(body.selectedNodeIds, validNodeIds, 50);
    const editingNodeId = normalizeNodeId(body.editingNodeId, validNodeIds);
    const generatingNodeIds = normalizeNodeIds(body.generatingNodeIds, validNodeIds, 20);
    const presences = upsertCanvasPresence({
      projectId: access.project.id,
      clientId,
      userId: access.localUserId,
      displayName: access.displayName,
      selectedNodeIds,
      ...(editingNodeId ? { editingNodeId } : {}),
      generatingNodeIds,
    });
    broadcastCanvasProjectEvent({ type: "presence", projectId: access.project.id, sourceId: clientId, presences });
    return NextResponse.json({ presences });
  } catch (error) {
    return presenceErrorResponse(request, error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const access = await requirePresenceProject(request, context);
    const clientId = normalizeClientId(request.nextUrl.searchParams.get("client"));
    const presences = removeCanvasPresence(access.project.id, access.localUserId, clientId);
    broadcastCanvasProjectEvent({ type: "presence", projectId: access.project.id, sourceId: clientId, presences });
    return NextResponse.json({ presences });
  } catch (error) {
    return presenceErrorResponse(request, error);
  }
}

async function requirePresenceProject(request: NextRequest, context: RouteContext) {
  const session = await requireAuthSession(request);
  if (!session.ok) throw new CanvasPresenceError("CANVAS_PRESENCE_AUTH_REQUIRED", "请先登录。", 401);
  if (!isInternalCanvasHostname(request.headers.get("host")) || request.nextUrl.searchParams.get("scope") === "personal") {
    throw new CanvasPresenceError("CANVAS_PRESENCE_SHARED_ONLY", "在线协作状态仅用于内部团队画布。", 403);
  }
  const { id } = await context.params;
  const ownerId = await resolveCanvasWorkspaceOwner(request, session.user.local_user_id);
  const project = await getCanvasProject(id, ownerId);
  if (!project) throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  return {
    project,
    localUserId: session.user.local_user_id,
    displayName: session.user.display_name || session.user.username,
  };
}

async function readPresenceBody(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 24_000) {
    throw new CanvasPresenceError("CANVAS_PRESENCE_INVALID", "协作状态内容过大。", 400);
  }
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new CanvasPresenceError("CANVAS_PRESENCE_INVALID", "协作状态格式无效。", 400);
  }
}

function normalizeClientId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value)) {
    throw new CanvasPresenceError("CANVAS_PRESENCE_INVALID", "协作客户端标识无效。", 400);
  }
  return value;
}

function normalizeNodeIds(value: unknown, validNodeIds: Set<string>, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && validNodeIds.has(item)))].slice(0, limit);
}

function normalizeNodeId(value: unknown, validNodeIds: Set<string>) {
  return typeof value === "string" && validNodeIds.has(value) ? value : undefined;
}

function presenceErrorResponse(request: NextRequest, error: unknown) {
  if (error instanceof CanvasProjectError || error instanceof CanvasPresenceError || error instanceof InternalCanvasAccessError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  return diagnosticErrorResponse(error, {
    requestId: request.headers.get("x-request-id"),
    fallbackMessage: "同步团队协作状态失败。",
    operation: "canvas-presence",
    defaultCode: "UNKNOWN_ERROR",
  });
}
