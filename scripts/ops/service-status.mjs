#!/usr/bin/env node
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAllServiceConfigs, getServiceConfig, serviceNames } from "./service-config.mjs";
import { checkServiceHealth } from "./health-check.mjs";
import { classifyServiceProcess } from "./process-identity.mjs";
import { safeGit } from "./git-utils.mjs";

export async function getServiceStatus(service, options = {}) {
  const config = getServiceConfig(service, options);
  const identity = await classifyServiceProcess(service, { ...options, root: config.root, port: config.port });
  const workspaceCommit = safeGit(config.root, ["rev-parse", "HEAD"], "unknown");
  const runtimeCommit = identity.status === "owned" ? identity.state?.runtimeCommit || "unknown" : "unknown";
  const listening = Boolean(identity.pid) || ["owned", "foreign", "ambiguous"].includes(identity.status);
  const health = listening ? await checkServiceHealth(service, { ...options, port: config.port, repeat: options.repeat || 1 }) : null;
  return {
    service,
    listening,
    pid: identity.pid,
    port: config.port,
    root: config.root,
    commit: workspaceCommit,
    workspaceCommit,
    runtimeCommit,
    commitsMatch: runtimeCommit !== "unknown" && runtimeCommit === workspaceCommit,
    identityStatus: identity.status,
    identityReason: identity.reason,
    startedAt: identity.processInfo?.CreationDate || identity.state?.startedAt || null,
    dataDir: config.dataDir,
    uploadsDir: config.uploadsDir,
    home: health?.home ?? null,
    healthStatus: health?.healthStatuses?.[0] ?? null,
    healthOk: health?.ok ?? false,
    logFile: config.logFile,
    stateFile: existsSync(config.stateFile) ? config.stateFile : null,
  };
}

async function cli() {
  const firstArg = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const requested = firstArg ? [firstArg] : serviceNames;
  const json = process.argv.includes("--json");
  const roots = Object.fromEntries(getAllServiceConfigs().map((config) => [config.service, config.root]));
  const results = [];
  for (const service of requested) {
    results.push(await getServiceStatus(service, { root: roots[service] }));
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const status of results) {
    console.log(`${status.service}: listening=${status.listening} pid=${status.pid || "missing"} port=${status.port} commit=${status.commit}`);
    console.log(`  root=${status.root}`);
    console.log(`  startedAt=${status.startedAt || "unknown"} home=${status.home ?? "missing"} health=${status.healthStatus ?? "missing"}`);
    console.log(`  data=${status.dataDir}`);
    console.log(`  uploads=${status.uploadsDir}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
