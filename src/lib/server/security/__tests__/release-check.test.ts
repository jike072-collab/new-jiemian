import assert from "node:assert/strict";
import { test } from "node:test";

import { publicPaymentChannels } from "../../billing/config";
import { backendHealthReport } from "../health";
import { runBackendReleaseChecks } from "../release-check";

type EnvPatch = Record<string, string | undefined>;

async function withEnv<T>(patch: EnvPatch, callback: () => T | Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const productionEnv: EnvPatch = {
  NODE_ENV: "production",
  AUTH_SESSION_SECRET: "release-test-auth-session-secret-32-chars",
  APP_DATABASE_URL: "postgresql://release_user:release_pass@127.0.0.1:5432/aohuang_app",
  APP_DATABASE_EXPECTED_NAME: "aohuang_app",
  APP_AUTH_PERSISTENCE_MODE: "postgres",
  APP_BILLING_PERSISTENCE_MODE: "postgres",
  APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
  NEW_API_ENABLED: "true",
  NEW_API_BASE_URL: "https://new-api.example.test",
  NEW_API_ENVIRONMENT: "production",
  NEW_API_ADMIN_USER_ID: "1",
  NEW_API_ADMIN_ACCESS_TOKEN: "release-test-admin-token",
  PAYMENT_PRODUCTION_ENABLED: undefined,
  PAYMENT_PRODUCTION_WEBHOOK_SECRET: undefined,
};

test("production release checks fail closed when required configuration is missing", async () => {
  await withEnv({
    NODE_ENV: "production",
    AUTH_SESSION_SECRET: undefined,
    SESSION_SECRET: undefined,
    APP_DATABASE_URL: undefined,
    APP_DATABASE_EXPECTED_NAME: undefined,
    APP_AUTH_PERSISTENCE_MODE: undefined,
    APP_BILLING_PERSISTENCE_MODE: undefined,
    APP_TASK_BILLING_PERSISTENCE_MODE: undefined,
    NEW_API_ENABLED: "false",
    PAYMENT_PRODUCTION_ENABLED: undefined,
    PAYMENT_PRODUCTION_WEBHOOK_SECRET: undefined,
  }, () => {
    const report = runBackendReleaseChecks(new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(report.ok, false);
    assert.equal(report.environment, "production");
    assert(report.items.some((entry) => entry.name === "auth.session_secret" && entry.status === "fail"));
    assert(report.items.some((entry) => entry.name === "database.config" && entry.status === "fail"));
    assert(report.items.some((entry) => entry.name === "new_api.config" && entry.status === "fail"));
  });
});

test("production release checks pass with explicit backend configuration and production payment disabled", async () => {
  await withEnv(productionEnv, () => {
    const report = runBackendReleaseChecks(new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(report.ok, true);
    assert.equal(report.summary.fail, 0);
    assert.equal(report.items.find((entry) => entry.name === "payment.production")?.status, "pass");
    const serialized = JSON.stringify(report);
    for (const leaked of ["release_pass", "release-test-admin-token", "postgresql://", "new-api.example.test"]) {
      assert.equal(serialized.includes(leaked), false, `release report leaked ${leaked}`);
    }
  });
});

test("production payment stays fail closed without a registered provider even when env is enabled", async () => {
  await withEnv({
    ...productionEnv,
    PAYMENT_PRODUCTION_ENABLED: "true",
    PAYMENT_PRODUCTION_WEBHOOK_SECRET: "release-test-production-webhook-secret",
  }, () => {
    const channel = publicPaymentChannels().find((entry) => entry.channel === "production_generic");
    assert.equal(channel?.enabled, false);
    const report = runBackendReleaseChecks(new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(report.ok, true);
    assert.equal(report.items.find((entry) => entry.name === "payment.production")?.status, "pass");
  });
});

test("backend health report omits secrets, URLs, and internal paths", async () => {
  await withEnv(productionEnv, () => {
    const report = backendHealthReport("req-health", new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(report.ok, true);
    assert.equal(report.requestId, "req-health");
    assert.deepEqual(Object.keys(report.checks).sort(), ["newApi", "productionPayment"]);
    const serialized = JSON.stringify(report);
    for (const leaked of [
      "release_pass",
      "release-test-admin-token",
      "postgresql://",
      "new-api.example.test",
      process.cwd(),
    ]) {
      assert.equal(serialized.includes(leaked), false, `health response leaked ${leaked}`);
    }
  });
});
