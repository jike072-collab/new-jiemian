import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { publicPaymentChannels } from "../../billing/config";
import { backendHealthHttpReport, backendLivenessReport, backendReadinessReport } from "../health";
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

test("production release checks reject json and dual persistence modes", async () => {
  for (const patch of [
    { APP_AUTH_PERSISTENCE_MODE: "json" },
    { APP_AUTH_PERSISTENCE_MODE: "dual" },
    { APP_BILLING_PERSISTENCE_MODE: "json" },
    { APP_BILLING_PERSISTENCE_MODE: "dual" },
    { APP_TASK_BILLING_PERSISTENCE_MODE: "json" },
    { APP_TASK_BILLING_PERSISTENCE_MODE: "dual" },
  ]) {
    await withEnv({ ...productionEnv, ...patch }, () => {
      const report = runBackendReleaseChecks(new Date("2026-06-19T00:00:00.000Z"));
      assert.equal(report.ok, false);
      assert.equal(report.summary.fail > 0, true);
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes("postgresql://"), false);
      assert.equal(serialized.includes("release-test-admin-token"), false);
    });
  }
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

test("backend liveness report omits secrets, URLs, and internal paths", async () => {
  await withEnv(productionEnv, () => {
    const report = backendLivenessReport("req-health", new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(report.ok, true);
    assert.equal(report.mode, "liveness");
    assert.equal(report.requestId, "req-health");
    assert.deepEqual(Object.keys(report.checks).sort(), ["newApi", "process", "productionPayment"]);
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

test("backend readiness fails closed when required dependencies are unavailable", async () => {
  await withEnv(productionEnv, async () => {
    const report = await backendReadinessReport("req-ready", new Date("2026-06-19T00:00:00.000Z"), { timeoutMs: 25 });
    assert.equal(report.ok, false);
    assert.equal(report.mode, "readiness");
    assert.equal(report.checks.process.ok, true);
    assert.equal(report.checks.database?.ok, false);
    assert.equal(report.checks.newApi.ok, false);
    const serialized = JSON.stringify(report);
    for (const leaked of [
      "release_pass",
      "release-test-admin-token",
      "postgresql://",
      "new-api.example.test",
      process.cwd(),
    ]) {
      assert.equal(serialized.includes(leaked), false, `readiness response leaked ${leaked}`);
    }
  });
});

test("backend health HTTP report returns 503 for failed readiness and 200 for liveness", async () => {
  await withEnv(productionEnv, async () => {
    const ready = await backendHealthHttpReport("readiness", "req-ready-route", new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(ready.status, 503);
    assert.equal(ready.report.ok, false);
    assert.equal(ready.report.mode, "readiness");

    const live = await backendHealthHttpReport("liveness", "req-live-route", new Date("2026-06-19T00:00:00.000Z"));
    assert.equal(live.status, 200);
    assert.equal(live.report.ok, true);
    assert.equal(live.report.mode, "liveness");

    const serialized = JSON.stringify({ ready, live });
    for (const leaked of ["release_pass", "release-test-admin-token", "postgresql://", "new-api.example.test", process.cwd()]) {
      assert.equal(serialized.includes(leaked), false, `health HTTP report leaked ${leaked}`);
    }
  });
});

test("standard npm start includes the release preflight", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.match(pkg.scripts?.start || "", /release:preflight/);
  assert.equal(pkg.scripts?.start?.includes("next start"), true);
});

test("release preflight rejects missing production configuration", () => {
  const run = spawnSync("npm", ["run", "release:preflight"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NODE_ENV: "production",
      AUTH_SESSION_SECRET: "",
      SESSION_SECRET: "",
      APP_DATABASE_URL: "",
      APP_DATABASE_EXPECTED_NAME: "",
      APP_AUTH_PERSISTENCE_MODE: "",
      APP_BILLING_PERSISTENCE_MODE: "",
      APP_TASK_BILLING_PERSISTENCE_MODE: "",
      NEW_API_ENABLED: "false",
    },
  });
  assert.notEqual(run.status, 0);
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.match(output, /Backend release preflight failed|AUTH_SESSION_SECRET|APP_DATABASE_URL/);
  for (const leaked of ["postgresql://", "release-test-admin-token", "new-api.example.test"]) {
    assert.equal(output.includes(leaked), false, `preflight output leaked ${leaked}`);
  }
});
