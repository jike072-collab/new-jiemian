import "server-only";

import { type AuthVerificationChannel, type AuthVerificationPurpose } from "./types";

export type AuthVerificationSenderPayload = {
  destination: string;
  channel: AuthVerificationChannel;
  purpose: AuthVerificationPurpose;
  code: string;
  expiresInSeconds: number;
};

export type AuthVerificationSender = (payload: AuthVerificationSenderPayload) => Promise<void>;

export class AuthVerificationSendError extends Error {
  constructor(readonly code: "unconfigured" | "provider_failed", message: string) {
    super(message);
    this.name = "AuthVerificationSendError";
  }
}

function senderUrl() {
  return process.env.AUTH_VERIFICATION_WEBHOOK_URL?.trim()
    || process.env.AUTH_VERIFICATION_SEND_URL?.trim()
    || "";
}

function timeoutMs() {
  const parsed = Number(process.env.AUTH_VERIFICATION_SEND_TIMEOUT_MS || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 8000;
  return Math.min(Math.trunc(parsed), 30_000);
}

export async function sendAuthVerificationCode(payload: AuthVerificationSenderPayload) {
  const url = senderUrl();
  if (!url) {
    throw new AuthVerificationSendError("unconfigured", "Verification sender is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = process.env.AUTH_VERIFICATION_WEBHOOK_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AuthVerificationSendError("provider_failed", "Verification sender rejected the request.");
    }
  } catch (error) {
    if (error instanceof AuthVerificationSendError) throw error;
    throw new AuthVerificationSendError("provider_failed", "Verification sender failed.");
  } finally {
    clearTimeout(timer);
  }
}
