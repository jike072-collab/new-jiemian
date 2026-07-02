#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isSensitiveLogKey } from "./log-utils.mjs";
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

const runtimeSummaryCategories = [
  { key: "runtimeMode", label: "runtimeModeConfigured", keys: ["NODE_ENV"] },
  { key: "runtimePort", label: "runtimePortConfigured", keys: ["PORT"] },
  { key: "runtimeStorage", label: "runtimeStorageConfigured", keys: ["DATA_DIR", "UPLOADS_DIR", "RUNTIME_DIR"] },
  { key: "adminAuth", label: "adminAuthConfigured", keys: ["AUTH_SESSION_SECRET", "SESSION_SECRET"], any: true },
  { key: "database", label: "databaseConfigured", keys: ["APP_DATABASE_URL", "APP_DATABASE_EXPECTED_NAME"] },
  {
    key: "persistence",
    label: "persistenceConfigured",
    keys: ["APP_AUTH_PERSISTENCE_MODE", "APP_BILLING_PERSISTENCE_MODE", "APP_TASK_BILLING_PERSISTENCE_MODE"],
  },
  {
    key: "newApi",
    label: "newApiConfigured",
    keys: ["NEW_API_ENABLED", "NEW_API_BASE_URL", "NEW_API_ENVIRONMENT", "NEW_API_ADMIN_USER_ID", "NEW_API_ADMIN_ACCESS_TOKEN"],
  },
  { key: "billing", label: "billingConfigured", keys: ["PAYMENT_PRODUCTION_ENABLED", "PAYMENT_PRODUCTION_WEBHOOK_SECRET"], optional: true },
];

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
  const baseEnv = options.baseEnv || process.env;
  const env = {};
  const sources = {};
  const files = [];

  for (const filePath of config.envFilePaths) {
    const parsed = parseEnvFile(filePath);
    files.push({ source: parsed.source, exists: parsed.exists });
    if (parsed.exists) applyValues(env, parsed.values, parsed.source, sources);
  }

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && value !== "") {
      env[key] = value;
      sources[key] = "process";
    }
  }

  const allowRuntimeDirOverride = baseEnv.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1";
  const enforced = {
    NODE_ENV: "production",
    PORT: config.port,
    DATA_DIR: allowRuntimeDirOverride && env.DATA_DIR ? resolve(env.DATA_DIR) : config.dataDir,
    UPLOADS_DIR: allowRuntimeDirOverride && env.UPLOADS_DIR ? resolve(env.UPLOADS_DIR) : config.uploadsDir,
    RUNTIME_DIR: config.runtimeDir,
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
    missingCategories: summarizeMissingRuntimeConfig(missing),
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
    "RUNTIME_DIR",
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
      value: env[key] ? (isSensitiveLogKey(key) ? "masked" : "configured") : "missing",
      source: sources[key] || "missing",
    })),
    categories: summarizeRuntimeCategories(env, sources),
  };
}

export function formatRuntimeEnvSummary(summary) {
  const fileLines = summary.files.map((file) => `${file.source}: ${file.exists ? "configured" : "missing"}`);
  const categoryLines = (summary.categories || []).map((entry) => {
    const detail = entry.state === "partial" ? `, configured=${entry.configuredCount}/${entry.requiredCount}` : "";
    return `${entry.label}=${entry.configured}${detail} (source=${entry.source})`;
  });
  return [...fileLines, ...categoryLines].join("\n");
}

export function assertNoSecretText(text, secretValues) {
  for (const value of secretValues.filter(Boolean)) {
    if (value.length >= 6 && text.includes(value)) {
      throw new Error("Runtime log contains a secret value.");
    }
  }
}

export function summarizeMissingRuntimeConfig(missing = []) {
  const missingSet = new Set(missing);
  return runtimeSummaryCategories
    .filter((category) => category.keys.some((key) => missingSet.has(key))
      || (category.key === "adminAuth" && missingSet.has("AUTH_SESSION_SECRET or SESSION_SECRET")))
    .map((category) => category.key);
}

function summarizeRuntimeCategories(env, sources) {
  return runtimeSummaryCategories.map((category) => {
    const configuredKeys = category.keys.filter((key) => Boolean(env[key]));
    const requiredCount = category.any ? 1 : category.keys.length;
    const configuredCount = category.any ? Math.min(1, configuredKeys.length) : configuredKeys.length;
    const state = configuredCount === 0
      ? (category.optional ? "optional-missing" : "missing")
      : configuredCount >= requiredCount ? "configured" : "partial";
    return {
      key: category.key,
      label: category.label,
      configured: state === "configured",
      state,
      configuredCount,
      requiredCount,
      source: summarizeSafeSources(configuredKeys.map((key) => sources[key]).filter(Boolean)),
    };
  });
}

function summarizeSafeSources(values) {
  if (!values.length) return "missing";
  const safe = new Set(values.map((value) => {
    if (value === "process" || value === "service-invariant") return value;
    return "env-file";
  }));
  return [...safe].sort().join("+");
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
      missingCategories: report.missingCategories,
      missingCount: report.missing.length,
      summary: safeRuntimeEnvSummary(report.summary),
    }, null, 2));
  } else {
    console.log(formatRuntimeEnvSummary(report.summary));
    if (report.missing.length) {
      console.error(`Missing required runtime configuration: ${report.missingCategories.join(", ") || `${report.missing.length} items`}`);
      process.exit(1);
    }
  }
}

function safeRuntimeEnvSummary(summary) {
  return {
    files: summary.files,
    categories: summary.categories || [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli();
}
