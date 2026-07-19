import { type NextRequest } from "next/server";

import {
  type AuthVerificationPurpose,
  authActionResponse,
  authRequestContext,
  csrfFailure,
  getAuthService,
  isRegistrationAllowedForHost,
  readJsonBody,
  requireCsrf,
} from "@/lib/server/auth";

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
    identifier: String(body.identifier || body.email || body.phone || ""),
    purpose,
  }, authRequestContext(request));
  return authActionResponse(request, result, { clearSession: false });
}
