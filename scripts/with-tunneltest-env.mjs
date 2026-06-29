#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Missing startup command.");
  process.exit(1);
}

const inheritedPrefixes = [
  "DEEPSEEK_",
  "GROK_VIDEO_",
  "IMAGE_",
  "IMG2_IMAGE_",
  "NEW_API_",
  "PROMPT_OPTIMIZER_",
  "TEXT_",
  "VIDEO_",
  "VISION_",
  "VOLCENGINE_",
];
const inheritedKeys = new Set([
  "ADMIN_PASSWORD",
  "AUTH_SESSION_SECRET",
  "SESSION_SECRET",
  "TEST_INVITE_CODE",
]);
const blockedKeys = new Set([
  "APP_AUTH_PERSISTENCE_MODE",
  "APP_BILLING_PERSISTENCE_MODE",
  "APP_DATABASE_URL",
  "APP_TASK_BILLING_PERSISTENCE_MODE",
  "DATA_DIR",
  "NODE_ENV",
  "PORT",
  "RUNTIME_STORAGE_ISOLATION",
  "UPLOADS_DIR",
]);

function shouldInheritKey(key) {
  return !blockedKeys.has(key) && (inheritedKeys.has(key) || inheritedPrefixes.some((prefix) => key.startsWith(prefix)));
}

function readEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match || !shouldInheritKey(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const productionEnv = readEnvFile(resolve(process.cwd(), "..", "new-jiemian", ".env.local"));
const localEnv = readEnvFile(resolve(process.cwd(), ".env.local"));
const processEnv = { ...process.env };
for (const key of blockedKeys) {
  delete processEnv[key];
}

let executable = command;
let finalArgs = args;

if (command === "node") {
  executable = process.execPath;
} else if (command === "next") {
  executable = process.execPath;
  finalArgs = [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), ...args];
}

const tunneltestEnv = {
  PORT: "3107",
  DATA_DIR: "data-tunneltest",
  UPLOADS_DIR: "uploads-tunneltest",
  RUNTIME_STORAGE_ISOLATION: "strict",
  APP_AUTH_PERSISTENCE_MODE: "json",
};

const child = spawn(executable, finalArgs, {
  cwd: process.cwd(),
  env: { ...productionEnv, ...localEnv, ...processEnv, ...tunneltestEnv },
  shell: false,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
