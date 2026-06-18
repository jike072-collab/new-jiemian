import { createHmac, timingSafeEqual } from "node:crypto";

import { BILLING_WEBHOOK_TOLERANCE_SECONDS } from "./config";

export type SandboxWebhookVerification =
  | { ok: true }
  | {
      ok: false;
      code: "missing_secret" | "invalid_timestamp" | "replay" | "invalid_signature";
      message: string;
    };

function hmac(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function signSandboxWebhook(input: {
  secret: string;
  timestamp: string;
  body: string;
}) {
  return hmac(input.secret, input.timestamp, input.body);
}

export function verifySandboxWebhook(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): SandboxWebhookVerification {
  if (!input.secret.trim()) {
    return { ok: false, code: "missing_secret", message: "Sandbox webhook secret is required." };
  }
  if (!input.timestamp || !/^\d+$/.test(input.timestamp)) {
    return { ok: false, code: "invalid_timestamp", message: "Webhook timestamp is invalid." };
  }
  const nowSeconds = Math.floor((input.now || new Date()).getTime() / 1000);
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, code: "invalid_timestamp", message: "Webhook timestamp is invalid." };
  }
  if (Math.abs(nowSeconds - timestampSeconds) > BILLING_WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, code: "replay", message: "Webhook timestamp is outside the allowed window." };
  }
  if (!input.signature || !/^[a-f0-9]{64}$/i.test(input.signature)) {
    return { ok: false, code: "invalid_signature", message: "Webhook signature is invalid." };
  }

  const expected = hmac(input.secret, input.timestamp, input.body);
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(input.signature, "hex");
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return { ok: false, code: "invalid_signature", message: "Webhook signature is invalid." };
  }
  return { ok: true };
}
