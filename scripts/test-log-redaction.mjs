#!/usr/bin/env node
import assert from "node:assert/strict";

import { collectLogFindings, splitLogWindow } from "./audit-production-readiness.mjs";
import { buildRuntimeEnv, formatRuntimeEnvSummary } from "./ops/load-runtime-env.mjs";
import {
  hasSecretValuePattern,
  isSensitiveLogKey,
  redactLogValue,
  redactSensitiveText,
  safeLogJson,
} from "./ops/log-utils.mjs";

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertNoSecret(text) {
  for (const secret of [
    "Bearer live-token-123456",
    "session=secret-cookie",
    "refresh-secret-value",
    "secret-password",
    "sk-real-secret-token-1234567890",
    "postgresql://user:pass",
  ]) {
    assert(!String(text).includes(secret), `leaked ${secret}`);
  }
}

test("plain objects keep non-sensitive diagnostic fields", () => {
  const input = { status: 200, providerConfigured: true, detail: "ok" };
  assert.deepEqual(redactLogValue(input), input);
});

test("authorization values are fully redacted", () => {
  const output = redactLogValue({ Authorization: "Bearer live-token-123456" });
  assert.equal(output.Authorization, "[REDACTED]");
  assertNoSecret(JSON.stringify(output));
});

test("cookie and set-cookie values are fully redacted", () => {
  const output = redactLogValue({
    Cookie: "session=secret-cookie",
    "Set-Cookie": "session=secret-cookie; HttpOnly",
  });
  assert.equal(output.Cookie, "[REDACTED]");
  assert.equal(output["Set-Cookie"], "[REDACTED]");
  assertNoSecret(JSON.stringify(output));
});

test("password token secret and api key names are redacted", () => {
  const output = redactLogValue({
    password: "secret-password",
    token: "refresh-secret-value",
    secret: "secret-password",
    apiKey: "sk-real-secret-token-1234567890",
  });
  assert.deepEqual(output, {
    password: "[REDACTED]",
    token: "[REDACTED]",
    secret: "[REDACTED]",
    apiKey: "[REDACTED]",
  });
});

test("sensitive key matching is case-insensitive", () => {
  assert.equal(isSensitiveLogKey("ACCESS_TOKEN"), true);
  assert.equal(isSensitiveLogKey("Api-Key"), true);
  assert.equal(isSensitiveLogKey("newApi"), true);
  assert.equal(redactLogValue({ ACCESS_TOKEN: "refresh-secret-value" }).ACCESS_TOKEN, "[REDACTED]");
});

test("nested objects and arrays are redacted", () => {
  const output = redactLogValue({
    nested: [{ safe: "ok", refresh_token: "refresh-secret-value" }],
  });
  assert.equal(output.nested[0].safe, "ok");
  assert.equal(output.nested[0].refresh_token, "[REDACTED]");
});

test("circular references do not crash", () => {
  const input = { name: "root" };
  input.self = input;
  const output = redactLogValue(input);
  assert.equal(output.name, "root");
  assert.equal(output.self, "[Circular]");
});

test("error objects are serialized safely", () => {
  const error = new Error("failed Authorization=Bearer live-token-123456");
  const output = redactLogValue(error);
  assert.equal(output.name, "Error");
  assert(output.message.includes("[REDACTED]"));
  assertNoSecret(JSON.stringify(output));
});

test("long strings are truncated", () => {
  const output = redactSensitiveText(`prefix ${"x".repeat(600)}`, { maxStringLength: 80 });
  assert(output.endsWith("...[truncated]"));
  assert(output.length < 100);
});

test("base64 and large body payloads are suppressed", () => {
  const output = redactSensitiveText("a".repeat(160), { maxStringLength: 120 });
  assert.equal(output, "[REDACTED]");
  const dataUrl = redactSensitiveText(`data:image/png;base64,${"a".repeat(160)}`);
  assert.equal(dataUrl, "[REDACTED]");
});

test("original object is not mutated", () => {
  const input = { token: "refresh-secret-value", nested: { safe: "ok" } };
  const output = redactLogValue(input);
  assert.equal(input.token, "refresh-secret-value");
  assert.equal(input.nested.safe, "ok");
  assert.equal(output.token, "[REDACTED]");
});

test("non-sensitive fields remain available", () => {
  const output = redactLogValue({ providerConfigured: true, databaseConfigured: true, status: "ok" });
  assert.equal(output.providerConfigured, true);
  assert.equal(output.databaseConfigured, true);
  assert.equal(output.status, "ok");
});

test("historical database errors are not current-window findings", () => {
  const log = [
    "[service] starting staging at 2026-06-27T00:00:00.000Z",
    "database connection failed ECONNREFUSED",
    "[service] starting staging at 2026-06-27T01:00:00.000Z",
    "health ok",
  ].join("\n");
  const window = splitLogWindow(log, "2026-06-27T01:00:00.000Z");
  assert(collectLogFindings(window.historicalText).includes("databaseError"));
  assert(!collectLogFindings(window.currentText).includes("databaseError"));
});

test("current-window database errors are detected", () => {
  const log = [
    "[service] starting staging at 2026-06-27T01:00:00.000Z",
    "postgres database failed ECONNREFUSED",
  ].join("\n");
  const window = splitLogWindow(log, "2026-06-27T01:00:00.000Z");
  assert(collectLogFindings(window.currentText).includes("databaseError"));
});

test("current-window 500 errors are detected", () => {
  const window = splitLogWindow("[service] starting staging at 2026-06-27T01:00:00.000Z\nGET / 500", "2026-06-27T01:00:00.000Z");
  assert(collectLogFindings(window.currentText).includes("http500"));
});

test("current-window secret value patterns are detected", () => {
  assert.equal(hasSecretValuePattern("Authorization: Bearer live-token-123456"), true);
  const window = splitLogWindow("[service] starting staging at 2026-06-27T01:00:00.000Z\napi_key=secretapikey123", "2026-06-27T01:00:00.000Z");
  assert(collectLogFindings(window.currentText).includes("secretValueLeak"));
});

test("safe status fields do not trigger findings", () => {
  const text = "providerConfigured=true databaseConfigured=true adminAuthConfigured=true newApiConfigured=true";
  assert.deepEqual(collectLogFindings(text), []);
});

test("log serialization does not output detected real values", () => {
  const output = safeLogJson({
    url: "postgresql://user:pass@127.0.0.1/app",
    headers: { authorization: "Bearer live-token-123456" },
    body: `data:image/png;base64,${"a".repeat(160)}`,
  });
  assertNoSecret(output);
  assert(output.includes("[REDACTED]"));
});

test("runtime environment summary omits sensitive key names", () => {
  const report = buildRuntimeEnv("staging", {
    root: process.cwd(),
    baseEnv: {
      AUTH_SESSION_SECRET: "secret-password",
      APP_DATABASE_URL: "postgresql://user:pass@127.0.0.1/app",
      APP_DATABASE_EXPECTED_NAME: "app",
      APP_AUTH_PERSISTENCE_MODE: "postgres",
      APP_BILLING_PERSISTENCE_MODE: "postgres",
      APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
      NEW_API_ENABLED: "true",
      NEW_API_BASE_URL: "https://new-api.example.test",
      NEW_API_ENVIRONMENT: "production",
      NEW_API_ADMIN_USER_ID: "1",
      NEW_API_ADMIN_ACCESS_TOKEN: "refresh-secret-value",
    },
  });
  const summary = formatRuntimeEnvSummary(report.summary);
  assert(summary.includes("databaseConfigured=true"));
  assert(summary.includes("newApiConfigured=true"));
  assert(!summary.includes("APP_DATABASE_URL"));
  assert(!summary.includes("NEW_API_ADMIN_ACCESS_TOKEN"));
  assertNoSecret(summary);
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  }
}

console.log(`log redaction tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
