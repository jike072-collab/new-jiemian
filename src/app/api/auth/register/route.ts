import { type NextRequest } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  getAuthService,
  readJsonBody,
  redirectFromBody,
  requireCsrf,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const body = await readJsonBody(request);
  const result = await getAuthService().register({
    email: String(body.email || ""),
    username: body.username === undefined ? undefined : String(body.username),
    password: String(body.password || ""),
    displayName: body.displayName === undefined ? undefined : String(body.displayName),
    redirectTo: redirectFromBody(body),
  }, authRequestContext(request));
  return authResultResponse(request, result);
}
