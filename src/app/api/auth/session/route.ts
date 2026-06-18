import { type NextRequest } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  getAuthService,
  requireCsrf,
  sessionTokenFromRequest,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const result = await getAuthService().currentUser(sessionTokenFromRequest(request), authRequestContext(request));
  return authResultResponse(request, result);
}

export async function PATCH(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const result = await getAuthService().refreshSession(sessionTokenFromRequest(request), authRequestContext(request));
  return authResultResponse(request, result);
}
