import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, isInternalCanvasHostname, requireAuthSession } from "@/lib/server/auth";
import { getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { LibraryOperationError, resolveLibraryMediaForOwner, resolveLibraryMediaForOwners } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);

  try {
    const { id } = await context.params;
    const shared = isInternalCanvasHostname(request.headers.get("host")) && request.nextUrl.searchParams.get("scope") === "shared";
    const output = shared
      ? await resolveLibraryMediaForOwners(id, (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds)
      : await resolveLibraryMediaForOwner(id, session.user.local_user_id);
    const destination = new URL(output.url, request.nextUrl.origin);
    if (shared && destination.pathname.startsWith("/api/files/")) destination.searchParams.set("scope", "shared");
    const view = request.nextUrl.searchParams.get("view");
    if (view === "thumb") destination.searchParams.set("view", view);
    const location = output.url.startsWith("/") ? `${destination.pathname}${destination.search}` : destination.toString();
    return new NextResponse(null, {
      status: 307,
      headers: { Location: location, "Cache-Control": "private, max-age=300", Vary: "Cookie" },
    });
  } catch (error) {
    const status = error instanceof LibraryOperationError ? error.status : 502;
    return NextResponse.json({ error: status === 404 ? "图片不存在或无权访问。" : "图片暂时无法读取。" }, { status });
  }
}
