import { type NextRequest } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  getAuthService,
  readJsonBody,
  redirectFromBody,
  requireCsrf,
  sessionTokenFromRequest,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const body = await readJsonBody(request);
  const result = await getAuthService().login({
    identifier: String(body.identifier || body.email || body.username || ""),
    password: String(body.password || ""),
    existingSessionToken: sessionTokenFromRequest(request),
    redirectTo: redirectFromBody(body),
  }, authRequestContext(request));
  return authResultResponse(request, result);
}
