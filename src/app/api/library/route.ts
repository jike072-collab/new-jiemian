import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { diagnosticErrorResponse, GenerationDiagnosticError } from "@/lib/server/error-diagnostics";
import { deleteLibraryItemForOwner, LibraryOperationError, readLibraryForOwner } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  return NextResponse.json({ items: await readLibraryForOwner(session.user.local_user_id) });
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await request.json() as { id?: string };
    if (!body.id) {
      throw new GenerationDiagnosticError({
        code: "INPUT_INVALID_PARAMETERS",
        message: "缺少作品 ID。",
        status: 400,
      });
    }
    return NextResponse.json(await deleteLibraryItemForOwner(body.id, session.user.local_user_id));
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
      fallbackMessage: "删除失败。",
      operation: "delete-library-item",
      defaultCode: "LIBRARY_SAVE_FAILED",
    });
  }
}
