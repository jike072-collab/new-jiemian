import { randomBytes } from "node:crypto";

import { AUTH_CSRF_TTL_SECONDS } from "./types";
import { hmacSha256, timingSafeStringEqual } from "./secrets";

type VerifyCsrfInput = {
  headerToken?: string | null;
  cookieToken?: string | null;
  now?: Date;
};

export function createCsrfToken(now = new Date()) {
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = Math.floor(now.getTime() / 1000) + AUTH_CSRF_TTL_SECONDS;
  const payload = `${nonce}.${expiresAt}`;
  return `${payload}.${hmacSha256(payload)}`;
}

export function verifyCsrfToken(input: VerifyCsrfInput) {
  const headerToken = input.headerToken?.trim();
  const cookieToken = input.cookieToken?.trim();
  if (!headerToken || !cookieToken) return false;
  if (!timingSafeStringEqual(headerToken, cookieToken)) return false;

  const parts = headerToken.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!timingSafeStringEqual(parts[2], hmacSha256(payload))) return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt)) return false;
  const nowSeconds = Math.floor((input.now || new Date()).getTime() / 1000);
  return expiresAt >= nowSeconds;
}
