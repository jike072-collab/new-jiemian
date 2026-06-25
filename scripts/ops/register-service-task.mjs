#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { getKnownServiceRoot, getServiceConfig } from "./service-config.mjs";
import { runSync } from "./process-utils.mjs";

export function registerServiceTask(service, options = {}) {
  const root = getKnownServiceRoot(service, options);
  const config = getServiceConfig(service, { root });
  const command = [
    "powershell.exe",
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-Command",
    quotePowerShellCommand(`Set-Location -LiteralPath '${escapePowerShellSingleQuoted(config.root)}'; node scripts/ops/start-service.mjs ${service}`),
  ].join(" ");
  const args = [
    "/Create",
    "/TN",
    config.taskName,
    "/SC",
    "MINUTE",
    "/MO",
    "1",
    "/TR",
    command,
    "/RL",
    "LIMITED",
    "/F",
  ];
  runSync("schtasks.exe", args);
  return { service, taskName: config.taskName, created: true, requiresAdmin: false };
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function quotePowerShellCommand(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function cli() {
  const service = process.argv[2];
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const result = registerServiceTask(service, { root });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
