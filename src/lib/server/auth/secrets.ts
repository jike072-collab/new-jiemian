import { createHmac, timingSafeEqual } from "node:crypto";

export function getAuthSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET or SESSION_SECRET is required in production.");
  }
  return "dev-only-auth-session-secret-change-me";
}

export function hmacSha256(value: string, secret = getAuthSecret()) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
