import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getServiceConfig } from "./service-config.mjs";
import { getListeningPid, getProcessInfo, isPortAvailable } from "./process-utils.mjs";
import { safeGit } from "./git-utils.mjs";

export const stateFileVersion = 2;

export function createLaunchId() {
  return randomUUID();
}

export function createCommandFingerprint(config) {
  return createHash("sha256").update([
    config.service,
    normalizePath(config.root),
    String(config.port),
    normalizePath(join(config.root, "node_modules", "next", "dist", "bin", "next")),
    "next start -H 127.0.0.1",
  ].join("|")).digest("hex");
}

export function buildServiceState(config, details = {}) {
  const processInfo = details.processInfo || getProcessInfo(details.pid);
  const workspaceCommit = safeGit(config.root, ["rev-parse", "HEAD"], "unknown");
  return {
    statusVersion: stateFileVersion,
    serviceName: config.service,
    service: config.service,
    port: config.port,
    pid: details.pid,
    parentPid: normalizeNumber(processInfo?.ParentProcessId ?? details.parentPid),
    runtimeCommit: details.runtimeCommit || workspaceCommit,
    workspaceCommitAtStart: workspaceCommit,
    workdir: config.root,
    root: config.root,
    dataDir: config.dataDir,
    uploadsDir: config.uploadsDir,
    logFile: config.logFile,
    startedAt: details.startedAt || new Date().toISOString(),
    processStartedAt: processInfo?.CreationDate || details.processStartedAt || null,
    launchId: details.launchId || createLaunchId(),
    commandFingerprint: createCommandFingerprint(config),
    command: `node ${join(config.root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1`,
    envFiles: details.envFiles || [],
  };
}

export async function classifyServiceProcess(service, options = {}) {
  const config = getServiceConfig(service, options);
  const state = readServiceState(config);
  const pid = getListeningPid(config.port);
  const portAvailable = pid ? false : await isPortAvailable(config.port);
  if (!pid && portAvailable) {
    return {
      service,
      config,
      status: state?.pid ? "stale" : "stopped",
      pid: null,
      state,
      reason: state?.pid ? "state-file-pid-not-listening" : "not-listening",
    };
  }
  if (!pid) {
    return { service, config, status: "ambiguous", pid: null, state, reason: "port-occupied-but-pid-unavailable" };
  }

  const processInfo = options.processInfoProvider ? options.processInfoProvider(pid) : getProcessInfo(pid);
  if (!state) {
    return {
      service,
      config,
      status: processLooksLikeService(config, processInfo) ? "ambiguous" : "foreign",
      pid,
      processInfo,
      state,
      reason: processInfo ? "no-state-file" : "no-state-file-or-process-info",
    };
  }

  const stateError = validateState(config, state);
  if (stateError) {
    return { service, config, status: "ambiguous", pid, processInfo, state, reason: stateError };
  }
  if (normalizeNumber(state.pid) !== pid) {
    return { service, config, status: "ambiguous", pid, processInfo, state, reason: "listening-pid-does-not-match-state-file" };
  }
  if (!processInfo) {
    return { service, config, status: "ambiguous", pid, processInfo, state, reason: "process-info-unavailable" };
  }
  if (state.processStartedAt && processInfo.CreationDate && state.processStartedAt !== processInfo.CreationDate) {
    return { service, config, status: "stale", pid, processInfo, state, reason: "pid-reused-process-start-time-changed" };
  }
  if (!processLooksLikeService(config, processInfo)) {
    return { service, config, status: "foreign", pid, processInfo, state, reason: "command-line-does-not-match-service" };
  }
  return { service, config, status: "owned", pid, processInfo, state, reason: "owned" };
}

export function assertOwnedIdentity(identity, action) {
  if (identity.status !== "owned") {
    throw new Error(`${action} refused for ${identity.service}: process identity is ${identity.status} (${identity.reason}).`);
  }
}

export function readServiceState(config) {
  if (!existsSync(config.stateFile)) return null;
  try {
    return JSON.parse(readFileSync(config.stateFile, "utf8"));
  } catch {
    return null;
  }
}

function validateState(config, state) {
  if ((state.serviceName || state.service) !== config.service) return "state-service-name-mismatch";
  if (String(state.port) !== String(config.port)) return "state-port-mismatch";
  if (!samePath(state.workdir || state.root, config.root)) return "state-root-mismatch";
  if (!samePath(state.dataDir, config.dataDir)) return "state-data-dir-mismatch";
  if (!samePath(state.uploadsDir, config.uploadsDir)) return "state-uploads-dir-mismatch";
  if (state.commandFingerprint && state.commandFingerprint !== createCommandFingerprint(config)) return "state-command-fingerprint-mismatch";
  return null;
}

function processLooksLikeService(config, processInfo) {
  const commandLine = String(processInfo?.CommandLine || "").toLowerCase();
  if (!commandLine) return false;
  const root = normalizePath(config.root);
  return commandLine.includes("node")
    && commandLine.includes("next")
    && commandLine.includes(String(config.port))
    && (commandLine.includes(root) || commandLine.includes(root.replaceAll("\\", "/")));
}

function samePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value) {
  return resolve(String(value || "")).toLowerCase();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
