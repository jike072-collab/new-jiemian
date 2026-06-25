#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getServiceConfig } from "./service-config.mjs";

export const requiredRuntimeKeys = [
  "APP_DATABASE_URL",
  "APP_DATABASE_EXPECTED_NAME",
  "APP_AUTH_PERSISTENCE_MODE",
  "APP_BILLING_PERSISTENCE_MODE",
  "APP_TASK_BILLING_PERSISTENCE_MODE",
  "NEW_API_ENABLED",
  "NEW_API_BASE_URL",
  "NEW_API_ENVIRONMENT",
  "NEW_API_ADMIN_USER_ID",
  "NEW_API_ADMIN_ACCESS_TOKEN",
];

const secretNamePattern = /SECRET|TOKEN|PASSWORD|KEY|DSN|URL/i;

export function parseEnvFile(filePath) {
  const values = {};
  const source = resolve(filePath);
  if (!existsSync(source)) return { source, exists: false, values };
  const content = readFileSync(source, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return { source, exists: true, values };
}

function applyValues(target, values, source, sources) {
  for (const [key, value] of Object.entries(values)) {
    target[key] = value;
    sources[key] = source;
  }
}

export function buildRuntimeEnv(service, options = {}) {
  const config = getServiceConfig(service, options);
  const env = { ...process.env };
  const sources = {};
  const files = [];

  for (const filePath of config.envFilePaths) {
    const parsed = parseEnvFile(filePath);
    files.push({ source: parsed.source, exists: parsed.exists });
    if (parsed.exists) applyValues(env, parsed.values, parsed.source, sources);
  }

  for (const key of Object.keys(process.env)) {
    if (process.env[key] !== undefined && process.env[key] !== "") sources[key] = "process";
  }

  const allowRuntimeDirOverride = process.env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1";
  const enforced = {
    NODE_ENV: "production",
    PORT: config.port,
    DATA_DIR: allowRuntimeDirOverride && env.DATA_DIR ? resolve(env.DATA_DIR) : config.dataDir,
    UPLOADS_DIR: allowRuntimeDirOverride && env.UPLOADS_DIR ? resolve(env.UPLOADS_DIR) : config.uploadsDir,
    NEXT_TELEMETRY_DISABLED: env.NEXT_TELEMETRY_DISABLED || "1",
  };
  applyValues(env, enforced, "service-invariant", sources);

  const authConfigured = Boolean(env.AUTH_SESSION_SECRET || env.SESSION_SECRET);
  const missing = [
    ...requiredRuntimeKeys.filter((key) => !env[key]),
    ...(authConfigured ? [] : ["AUTH_SESSION_SECRET or SESSION_SECRET"]),
  ];

  return {
    config,
    env,
    files,
    missing,
    sources,
    summary: summarizeRuntimeEnv(env, sources, files),
  };
}

export function summarizeRuntimeEnv(env, sources = {}, files = []) {
  const keys = [
    "NODE_ENV",
    "PORT",
    "DATA_DIR",
    "UPLOADS_DIR",
    "AUTH_SESSION_SECRET",
    "SESSION_SECRET",
    ...requiredRuntimeKeys,
    "PAYMENT_PRODUCTION_ENABLED",
    "PAYMENT_PRODUCTION_WEBHOOK_SECRET",
  ];
  return {
    files,
    keys: keys.map((key) => ({
      key,
      state: env[key] ? "configured" : "missing",
      value: env[key] ? (secretNamePattern.test(key) ? "masked" : "configured") : "missing",
      source: sources[key] || "missing",
    })),
  };
}

export function formatRuntimeEnvSummary(summary) {
  const fileLines = summary.files.map((file) => `${file.source}: ${file.exists ? "configured" : "missing"}`);
  const keyLines = summary.keys.map((entry) => `${entry.key}: ${entry.state} (${entry.value}, source=${entry.source})`);
  return [...fileLines, ...keyLines].join("\n");
}

export function assertNoSecretText(text, secretValues) {
  for (const value of secretValues.filter(Boolean)) {
    if (value.length >= 6 && text.includes(value)) {
      throw new Error("Runtime log contains a secret value.");
    }
  }
}

function cli() {
  const service = process.argv[2];
  const asJson = process.argv.includes("--json");
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const report = buildRuntimeEnv(service, { root });
  if (asJson) {
    console.log(JSON.stringify({
      service,
      root: report.config.root,
      missing: report.missing,
      summary: report.summary,
    }, null, 2));
  } else {
    console.log(formatRuntimeEnvSummary(report.summary));
    if (report.missing.length) {
      console.error(`Missing required runtime configuration: ${report.missing.join(", ")}`);
      process.exit(1);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli();
}
