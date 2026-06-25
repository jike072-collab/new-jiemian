#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getAllServiceConfigs, getServiceConfig, serviceNames } from "./service-config.mjs";
import { getListeningPid, getProcessInfo, isPortAvailable, runSync } from "./process-utils.mjs";
import { checkServiceHealth } from "./health-check.mjs";

export async function getServiceStatus(service, options = {}) {
  const config = getServiceConfig(service, options);
  const pid = getListeningPid(config.port);
  const processInfo = getProcessInfo(pid);
  const state = readStateFile(config.stateFile);
  const commit = safeGit(config.root, ["rev-parse", "HEAD"]);
  const listening = Boolean(pid) || !(await isPortAvailable(config.port));
  const health = listening ? await checkServiceHealth(service, { ...options, port: config.port, repeat: options.repeat || 1 }) : null;
  return {
    service,
    listening,
    pid,
    port: config.port,
    root: config.root,
    commit,
    startedAt: processInfo?.CreationDate || state?.startedAt || null,
    dataDir: config.dataDir,
    uploadsDir: config.uploadsDir,
    home: health?.home ?? null,
    healthStatus: health?.healthStatuses?.[0] ?? null,
    healthOk: health?.ok ?? false,
    logFile: config.logFile,
    stateFile: existsSync(config.stateFile) ? config.stateFile : null,
  };
}

function readStateFile(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function safeGit(root, args) {
  try {
    return runSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], { cwd: root }).stdout.trim();
  } catch {
    if (args.join(" ") === "rev-parse HEAD") return readGitHead(root) || "unknown";
    return "unknown";
  }
}

function readGitHead(root) {
  try {
    const dotGit = resolve(root, ".git");
    const gitDir = statSync(dotGit).isDirectory()
      ? dotGit
      : resolve(dirname(dotGit), readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/i, "").trim());
    const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.replace(/^ref:\s*/, "").trim();
    const refFile = resolve(gitDir, ref);
    if (existsSync(refFile)) return readFileSync(refFile, "utf8").trim();
  } catch {
    return null;
  }
  return null;
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
