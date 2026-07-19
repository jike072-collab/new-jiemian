import { type NextRequest } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  getAuthService,
  isRegistrationAllowedForHost,
  readJsonBody,
  redirectFromBody,
  requireCsrf,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isRegistrationAllowedForHost(request.headers.get("host"))) {
    return authResultResponse(request, {
      ok: false,
      status: 403,
      code: "AUTH_VALIDATION_ERROR",
      uiState: "validation_error",
      message: "该域名仅供内部登录使用。",
    });
  }
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const body = await readJsonBody(request);
  const result = await getAuthService().register({
    identifier: String(body.identifier || body.email || body.phone || ""),
    email: String(body.email || ""),
    username: body.username === undefined ? undefined : String(body.username),
    password: String(body.password || ""),
    verificationCode: String(body.verificationCode || ""),
    displayName: body.displayName === undefined ? undefined : String(body.displayName),
    redirectTo: redirectFromBody(body),
  }, authRequestContext(request));
  return authResultResponse(request, result);
}
