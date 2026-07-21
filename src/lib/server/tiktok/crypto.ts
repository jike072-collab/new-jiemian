import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export function hashTikTokOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function safeTikTokSecretEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
