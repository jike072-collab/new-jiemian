import { type NextRequest } from "next/server";

import {
  authActionResponse,
  authRequestContext,
  csrfFailure,
  getAuthService,
  readJsonBody,
  requireCsrf,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authActionResponse(request, csrfFailure(), { clearSession: false });
  const body = await readJsonBody(request);
  const result = await getAuthService().resetPassword({
    identifier: String(body.identifier || body.email || body.phone || ""),
    verificationCode: String(body.verificationCode || ""),
    password: String(body.password || ""),
  }, authRequestContext(request));
  return authActionResponse(request, result, { clearSession: false });
}
