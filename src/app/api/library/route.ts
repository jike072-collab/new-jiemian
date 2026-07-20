import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { removeLibraryItemsFromCanvasProjects } from "@/lib/server/canvas-projects";
import { diagnosticErrorResponse, GenerationDiagnosticError } from "@/lib/server/error-diagnostics";
import { getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { deleteLibraryItemForOwner, deleteLibraryItemsForOwner, findMissingStoredLibraryItemsForOwners, LibraryOperationError, readLibraryMetadataForOwner, readLibraryMetadataForOwners, updateLibraryItemForOwner } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const shared = isInternalCanvasHostname(request.headers.get("host")) && request.nextUrl.searchParams.get("scope") === "shared";
  const workspace = shared ? await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id) : null;
  const ownerIds = workspace?.memberIds || [session.user.local_user_id];
  const missingItems = await findMissingStoredLibraryItemsForOwners(ownerIds);
  if (missingItems.length) {
    await removeLibraryItemsFromCanvasProjects(missingItems.map((item) => item.id));
    await Promise.all(missingItems.map(async (item) => {
      try {
        await deleteLibraryItemForOwner(item.id, item.ownerLocalUserId);
      } catch (error) {
        if (!(error instanceof LibraryOperationError) || error.status !== 404) throw error;
      }
    }));
  }
  void import("@/lib/server/provider-call")
    .then(({ refreshPendingVideoJobsForOwner }) => refreshPendingVideoJobsForOwner(session.user.local_user_id))
    .catch(() => undefined);
  const items = shared
    ? (await readLibraryMetadataForOwners(ownerIds)).map((item) => item.output ? {
      ...item,
      output: { ...item.output, url: `/api/library/${encodeURIComponent(item.id)}/media?scope=shared` },
    } : item)
    : await readLibraryMetadataForOwner(session.user.local_user_id);
  return NextResponse.json({ items, total: items.length });
}

export async function DELETE(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await request.json() as { id?: string; ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((value): value is string => typeof value === "string") : [];
    if (!body.id && !ids.length) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        message: "Missing library item id.",
        status: 400,
      });
    }
    if (ids.length) {
      const deleted = await deleteLibraryItemsForOwner(ids, session.user.local_user_id);
      await removeLibraryItemsFromCanvasProjects(deleted.deletedIds);
      return NextResponse.json(deleted);
    }
    const deleted = await deleteLibraryItemForOwner(body.id!, session.user.local_user_id);
    await removeLibraryItemsFromCanvasProjects([body.id!]);
    return NextResponse.json(deleted);
  } catch (error) {
    if (error instanceof LibraryOperationError) {
      return diagnosticErrorResponse(error, {
        requestId: request.headers.get("x-request-id"),
        fallbackMessage: error.message,
        operation: "delete-library-item",
        defaultCode: error.status === 404 ? "RESULT_ASSET_MISSING" : "LIBRARY_SAVE_FAILED",
        status: error.status,
      });
    }
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "Delete failed.",
      operation: "delete-library-item",
      defaultCode: "LIBRARY_SAVE_FAILED",
    });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await request.json() as { id?: string; title?: string; favorite?: boolean };
    if (!body.id?.trim()) throw new LibraryOperationError(400, "Missing library item id.");
    const item = await updateLibraryItemForOwner(body.id, session.user.local_user_id, {
      title: body.title,
      favorite: body.favorite,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof LibraryOperationError) {
      return diagnosticErrorResponse(error, {
        requestId: request.headers.get("x-request-id"),
        fallbackMessage: error.message,
        operation: "update-library-item",
        defaultCode: "LIBRARY_SAVE_FAILED",
        status: error.status,
      });
    }
    return diagnosticErrorResponse(error, {
      requestId: request.headers.get("x-request-id"),
      fallbackMessage: "Update failed.",
      operation: "update-library-item",
      defaultCode: "LIBRARY_SAVE_FAILED",
    });
  }
}
