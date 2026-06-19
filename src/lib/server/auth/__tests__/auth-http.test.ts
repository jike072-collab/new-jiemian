import assert from "node:assert/strict";
import { test } from "node:test";

import { clearSessionCookieOptions, sessionCookieOptions } from "../cookies";
import { csrfFailure } from "../http";

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
