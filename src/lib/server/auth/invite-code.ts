import { type AuthFailure } from "./types";

function normalizeInviteCode(value: unknown) {
  return String(value || "").trim();
}

function isTunnelTestRuntime() {
  return process.env.PORT === "3107"
    || process.env.DATA_DIR === "data-tunneltest"
    || process.env.UPLOADS_DIR === "uploads-tunneltest"
    || process.env.RUNTIME_STORAGE_ISOLATION === "strict";
}

export function requireTestInviteCode(inputCode: unknown): AuthFailure | null {
  const expectedCode = normalizeInviteCode(process.env.TEST_INVITE_CODE);
  if (!expectedCode && !isTunnelTestRuntime()) return null;

  const submittedCode = normalizeInviteCode(inputCode);
  if (!expectedCode || !submittedCode || submittedCode !== expectedCode) {
    return {
      ok: false,
      status: 403,
      code: "AUTH_INVITE_REQUIRED",
      uiState: "validation_error",
      message: "A valid test invite code is required.",
    };
  }

  return null;
}
