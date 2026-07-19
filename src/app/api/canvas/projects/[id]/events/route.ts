import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { subscribeCanvasProjectEvents, type CanvasNotification } from "@/lib/server/canvas-collaboration";
import { CanvasProjectError, getCanvasProject } from "@/lib/server/canvas-projects";
import { resolveCanvasWorkspaceOwner } from "@/lib/server/canvas-workspace-access";
import { diagnosticErrorResponse } from "@/lib/server/error-diagnostics";
import { InternalCanvasAccessError } from "@/lib/server/internal-canvas-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    return await openCanvasEvents(request, context);
  } catch (error) {
    if (error instanceof CanvasProjectError || error instanceof InternalCanvasAccessError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
    }
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "连接画布实时协作失败。",
      operation: "canvas-collaboration",
      defaultCode: "UNKNOWN_ERROR",
    });
  }
}

async function openCanvasEvents(request: NextRequest, context: RouteContext) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const { id } = await context.params;
  const ownerId = await resolveCanvasWorkspaceOwner(request, session.user.local_user_id);
  const initialProject = await getCanvasProject(id, ownerId);
  if (!initialProject) throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  const sourceId = normalizeSourceId(request.nextUrl.searchParams.get("client"));
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        unsubscribe?.();
        unsubscribe = null;
        try { controller.close(); } catch { /* stream already closed */ }
      };
      const onNotification = (message: CanvasNotification) => {
        if (message.sourceId && message.sourceId === sourceId) return;
        if (message.type === "deleted") {
          send("deleted", { id });
          return;
        }
        void getCanvasProject(id, ownerId)
          .then((project) => { if (project) send("project", { project }); })
          .catch(close);
      };

      try {
        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) {
          close();
          return;
        }
        const nextUnsubscribe = await subscribeCanvasProjectEvents(id, onNotification, close);
        if (closed) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
        const latestProject = await getCanvasProject(id, ownerId);
        if (closed) return;
        if (latestProject) send("project", { project: latestProject });
        else send("deleted", { id: initialProject.id });
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 15_000);
      } catch {
        close();
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function normalizeSourceId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : "";
}
