import { type NextRequest } from "next/server";

import {
  type AuthVerificationPurpose,
  authActionResponse,
  authRequestContext,
  csrfFailure,
  getAuthService,
  isRegistrationAllowedForHost,
  isInternalCanvasHostname,
  readJsonBody,
  requireCsrf,
} from "@/lib/server/auth";
import { canIdentifierAccessInternalCanvas } from "@/lib/server/internal-canvas-access";

export const runtime = "nodejs";

function verificationPurpose(value: unknown): AuthVerificationPurpose {
  if (value === "password_reset") return "password_reset";
  if (value === "login") return "login";
  return "register";
}

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authActionResponse(request, csrfFailure(), { clearSession: false });
  const body = await readJsonBody(request);
  const purpose = verificationPurpose(body.purpose);
  const identifier = String(body.identifier || body.email || body.phone || "");
  if (purpose === "login" && isInternalCanvasHostname(request.headers.get("host")) && !(await canIdentifierAccessInternalCanvas(identifier))) {
    return authActionResponse(request, {
      ok: false,
      status: 403,
      code: "AUTH_INTERNAL_ACCESS_REQUIRED",
      uiState: "validation_error",
      message: "此域名仅允许已授权的内部账号登录。",
    }, { clearSession: false });
  }
  if (purpose === "register" && !isRegistrationAllowedForHost(request.headers.get("host"))) {
    return authActionResponse(request, {
      ok: false,
      status: 403,
      code: "AUTH_VALIDATION_ERROR",
      uiState: "validation_error",
      message: "该域名仅供内部登录使用。",
    }, { clearSession: false });
  }
  const result = await getAuthService().requestVerificationCode({
    identifier,
    purpose,
  }, authRequestContext(request));
  return authActionResponse(request, result, { clearSession: false });
}
