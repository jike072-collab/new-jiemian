import assert from "node:assert/strict";
import { test } from "node:test";

import { clearSessionCookieOptions, sessionCookieOptions } from "../cookies";
import { csrfFailure } from "../http";
import { AuthVerificationSendError, sendAuthVerificationCode } from "../verification-sender";

function restoreEnv(previous: Map<string, string | undefined>) {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("session cookie is HttpOnly, SameSite Lax, path scoped, and secure in production", () => {
  const previousSecure = process.env.AUTH_COOKIE_SECURE;
  process.env.AUTH_COOKIE_SECURE = "true";
  const options = sessionCookieOptions(undefined, 123);

  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, 123);

  const clear = clearSessionCookieOptions();
  assert.equal(clear.maxAge, 0);

  process.env.AUTH_COOKIE_SECURE = previousSecure;
});

test("CSRF failure returns stable UI contract without upstream details", () => {
  const result = csrfFailure();
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "AUTH_CSRF_REQUIRED");
  assert.equal(result.uiState, "validation_error");
  assert.equal(result.message.includes("New API"), false);
});

test("verification sender uses Resend email API when configured", async () => {
  const keys = [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "RESEND_FROM_NAME",
    "AUTH_VERIFICATION_WEBHOOK_URL",
    "AUTH_VERIFICATION_SEND_URL",
    "AUTH_VERIFICATION_WEBHOOK_TOKEN",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | null = null;

  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "noreply@example.com";
  delete process.env.RESEND_FROM_NAME;
  delete process.env.AUTH_VERIFICATION_WEBHOOK_URL;
  delete process.env.AUTH_VERIFICATION_SEND_URL;
  delete process.env.AUTH_VERIFICATION_WEBHOOK_TOKEN;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ id: "email-test" }), { status: 200 });
  };

  try {
    await sendAuthVerificationCode({
      destination: "customer@example.com",
      channel: "email",
      purpose: "register",
      code: "123456",
      expiresInSeconds: 600,
    });

    const request = captured as { url: string; init?: RequestInit } | null;
    assert(request);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.init?.method, "POST");
    const headers = request.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_test_key");
    assert.equal(headers["User-Agent"], "aohuang-ai/1.0");
    const body = JSON.parse(String(request.init?.body));
    assert.equal(body.from, "\"奥皇 AI\" <noreply@example.com>");
    assert.deepEqual(body.to, ["customer@example.com"]);
    assert.equal(body.subject, "奥皇 AI 注册验证码");
    assert.equal(body.html.includes("123456"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previous);
  }
});

test("verification sender reports unconfigured when no provider exists", async () => {
  const keys = [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "RESEND_FROM_NAME",
    "AUTH_VERIFICATION_WEBHOOK_URL",
    "AUTH_VERIFICATION_SEND_URL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    await assert.rejects(
      () => sendAuthVerificationCode({
        destination: "customer@example.com",
        channel: "email",
        purpose: "password_reset",
        code: "654321",
        expiresInSeconds: 600,
      }),
      (error) => error instanceof AuthVerificationSendError && error.code === "unconfigured",
    );
  } finally {
    restoreEnv(previous);
  }
});
