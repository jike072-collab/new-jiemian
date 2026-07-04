import { type NextRequest } from "next/server";

import {
  type AuthVerificationPurpose,
  authActionResponse,
  authRequestContext,
  csrfFailure,
  getAuthService,
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
  const result = await getAuthService().requestVerificationCode({
    identifier: String(body.identifier || body.email || body.phone || ""),
    purpose: verificationPurpose(body.purpose),
  }, authRequestContext(request));
  return authActionResponse(request, result, { clearSession: false });
}
