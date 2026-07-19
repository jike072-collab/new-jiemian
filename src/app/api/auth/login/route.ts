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
import { canIdentifierAccessInternalCanvas } from "@/lib/server/internal-canvas-access";
import { isInternalCanvasHostname } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const body = await readJsonBody(request);
  const identifier = String(body.identifier || body.email || body.username || "");
  if (isInternalCanvasHostname(request.headers.get("host")) && !(await canIdentifierAccessInternalCanvas(identifier))) {
    return authResultResponse(request, {
      ok: false,
      status: 403,
      code: "AUTH_INTERNAL_ACCESS_REQUIRED",
      uiState: "validation_error",
      message: "此域名仅允许已授权的内部账号登录。",
    });
  }
  const result = await getAuthService().login({
    identifier,
    password: String(body.password || ""),
    verificationCode: String(body.verificationCode || ""),
    loginMethod: body.loginMethod === "verification_code" ? "verification_code" : "password",
    rememberMe: Boolean(body.rememberMe),
    existingSessionToken: sessionTokenFromRequest(request),
    redirectTo: redirectFromBody(body),
  }, authRequestContext(request));
  return authResultResponse(request, result);
}
