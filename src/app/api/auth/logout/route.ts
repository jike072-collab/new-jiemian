import { type NextRequest } from "next/server";

import {
  authActionResponse,
  authRequestContext,
  csrfFailure,
  getAuthService,
  requireCsrf,
  sessionTokenFromRequest,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authActionResponse(request, csrfFailure());
  const result = await getAuthService().logout(sessionTokenFromRequest(request), authRequestContext(request));
  return authActionResponse(request, result);
}
