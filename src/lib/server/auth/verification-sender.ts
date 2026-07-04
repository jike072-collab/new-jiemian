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

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

function resendFromEmail() {
  return process.env.RESEND_FROM_EMAIL?.trim() || "";
}

function verificationSubject(purpose: AuthVerificationPurpose) {
  return purpose === "password_reset" ? "奥皇 AI 重置密码验证码" : "奥皇 AI 注册验证码";
}

function verificationHtml(payload: AuthVerificationSenderPayload) {
  const action = payload.purpose === "password_reset" ? "重置密码" : "注册账号";
  const minutes = Math.max(1, Math.ceil(payload.expiresInSeconds / 60));
  return `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#111827">
      <p>你正在${action}，验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${payload.code}</p>
      <p>验证码 ${minutes} 分钟内有效。如非本人操作，请忽略这封邮件。</p>
    </div>
  `.trim();
}

async function sendWithResend(payload: AuthVerificationSenderPayload, signal: AbortSignal) {
  const apiKey = resendApiKey();
  const from = resendFromEmail();
  if (!apiKey || !from || payload.channel !== "email") return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "aohuang-ai/1.0",
    },
    body: JSON.stringify({
      from,
      to: [payload.destination],
      subject: verificationSubject(payload.purpose),
      html: verificationHtml(payload),
    }),
    signal,
  });
  if (!response.ok) {
    throw new AuthVerificationSendError("provider_failed", "Resend rejected the verification email.");
  }
  return true;
}

export async function sendAuthVerificationCode(payload: AuthVerificationSenderPayload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    if (await sendWithResend(payload, controller.signal)) return;

    const url = senderUrl();
    if (!url) {
      throw new AuthVerificationSendError("unconfigured", "Verification sender is not configured.");
    }

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
