#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildRuntimeEnv, formatRuntimeEnvSummary } from "./load-runtime-env.mjs";
import { getServiceConfig } from "./service-config.mjs";
import { rotateLogFile } from "./log-utils.mjs";
import { assertPortAvailable, run, runSync } from "./process-utils.mjs";

export async function startService(service, options = {}) {
  const config = getServiceConfig(service, options);
  const runtime = buildRuntimeEnv(service, { root: config.root });
  if (runtime.missing.length) {
    throw new Error(`Missing required runtime configuration before stopping any process: ${runtime.missing.join(", ")}`);
  }
  if (options.preflightOnly !== true && options.foreground !== true) {
    await assertPortAvailable(config.port);
  }
  mkdirSync(config.runtimeDir, { recursive: true });
  rotateLogFile(config.logFile);
  const safeSummary = formatRuntimeEnvSummary(runtime.summary);
  if (options.printEnvSummary) console.log(safeSummary);

  await run(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/release-preflight.mjs",
  ], {
    cwd: config.root,
    env: runtime.env,
  });

  if (options.preflightOnly) return { config, runtime };

  const nextBin = join(config.root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error("Next.js binary is missing. Run npm ci first.");
  if (options.foreground) {
    await run(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", config.port], {
      cwd: config.root,
      env: runtime.env,
    });
    return { config, runtime, pid: process.pid };
  }

  const logHeader = `[service] starting ${service} at ${new Date().toISOString()}\n[service] env summary\n${safeSummary}\n`;
  const outFd = openSync(config.logFile, "a");
  writeFileSync(outFd, logHeader);

  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", config.port], {
    cwd: config.root,
    env: runtime.env,
    shell: false,
    stdio: ["ignore", outFd, outFd],
    detached: true,
  });
  child.unref();
  closeSync(outFd);

  writeFileSync(config.stateFile, JSON.stringify({
    service,
    pid: child.pid,
    port: config.port,
    root: config.root,
    dataDir: config.dataDir,
    uploadsDir: config.uploadsDir,
    logFile: config.logFile,
    startedAt: new Date().toISOString(),
    command: `node ${nextBin} start -H 127.0.0.1`,
    envFiles: runtime.summary.files,
    commit: safeGitHead(config.root),
  }, null, 2));

  return { config, runtime, pid: child.pid };
}

function safeGitHead(root) {
  try {
    return runSync("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  } catch {
    return "unknown";
  }
}

async function cli() {
  const service = process.argv[2];
  const preflightOnly = process.argv.includes("--preflight-only");
  const foreground = process.argv.includes("--foreground");
  const printEnvSummary = process.argv.includes("--print-env-summary");
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const result = await startService(service, { root, preflightOnly, foreground, printEnvSummary });
  if (preflightOnly) {
    console.log(`${service} startup preflight passed.`);
  } else {
    console.log(`${service} started on port ${result.config.port}; pid=${result.pid}; log=${result.config.logFile}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
