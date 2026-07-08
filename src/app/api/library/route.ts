import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { diagnosticErrorResponse, GenerationDiagnosticError } from "@/lib/server/error-diagnostics";
import { deleteLibraryItemForOwner, deleteLibraryItemsForOwner, LibraryOperationError, readLibraryMetadataForOwner } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  void import("@/lib/server/provider-call")
    .then(({ refreshPendingVideoJobsForOwner }) => refreshPendingVideoJobsForOwner(session.user.local_user_id))
    .catch(() => undefined);
  const items = await readLibraryMetadataForOwner(session.user.local_user_id);
  return NextResponse.json({ items, total: items.length });
}

export async function DELETE(request: NextRequest) {
  try {
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
      return NextResponse.json(await deleteLibraryItemsForOwner(ids, session.user.local_user_id));
    }
    return NextResponse.json(await deleteLibraryItemForOwner(body.id!, session.user.local_user_id));
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
