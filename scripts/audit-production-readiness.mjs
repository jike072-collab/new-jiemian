#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { readActiveRelease } from "./ops/active-release.mjs";
import { snapshotDirectory, verifyBackupManifest } from "./ops/backup-utils.mjs";
import { safeGit } from "./ops/git-utils.mjs";
import { checkServiceHealth } from "./ops/health-check.mjs";
import { buildRuntimeEnv } from "./ops/load-runtime-env.mjs";
import { hasSecretValuePattern } from "./ops/log-utils.mjs";
import { classifyServiceProcess } from "./ops/process-identity.mjs";
import { getProcessInfo, runSync } from "./ops/process-utils.mjs";
import { getAllServiceConfigs, getServiceConfig } from "./ops/service-config.mjs";
import { getServiceStatus } from "./ops/service-status.mjs";

const defaultTargetRef = "origin/main";
const allowedAdminStatuses = new Set([200, 302, 303, 307, 308, 401, 403]);
const allowedProtectedStatuses = new Set([302, 303, 307, 308, 401, 403]);

const previewToolRoutes = [
  "/?preview=1",
  "/?preview=1&tool=image",
  "/?preview=1&tool=image-editor",
  "/?preview=1&tool=video",
  "/?preview=1&tool=image-upscale",
  "/?preview=1&tool=video-upscale",
  "/?preview=1&tool=library",
];

const safeHttpRoutes = [
  "/",
  "/login",
  "/admin/providers",
  "/api/health/backend",
  "/api/library",
  "/api/admin/provider-health",
  ...previewToolRoutes,
];

const forbiddenRequestPatterns = [
  /\/api\/generate\//i,
  /\/api\/upscale\/(?:image|video)$/i,
  /\/api\/prompts\/optimize$/i,
  /\/api\/quota\/precheck$/i,
  /new-api/i,
];

const suspiciousLogPatterns = [
  { key: "http500", pattern: /\b500\b|Internal Server Error/i },
  { key: "runtimeException", pattern: /Unhandled|TypeError|ReferenceError|SyntaxError|Exception|stack trace/i },
  { key: "databaseError", pattern: /(database|postgres|ECONNREFUSED).{0,80}(error|failed|timeout|refused|unavailable)/i },
  { key: "provider", pattern: /provider.*(error|failed|missing|invalid)|PROVIDER_/i },
  { key: "secretKeyword", pattern: /Authorization|Cookie|Set-Cookie|ADMIN_PASSWORD|APP_DATABASE_URL|NEW_API_ADMIN_ACCESS_TOKEN|api[_-]?key|password\s*[:=]|secret\s*[:=]|token\s*[:=]/i },
  { key: "secretValueLeak", test: hasSecretValuePattern },
  { key: "generationCall", pattern: /\/api\/generate\/|\/api\/upscale\/(?:image|video)|new-api/i },
];

function nowIso() {
  return new Date().toISOString();
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, "utf8");
  return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
}

function arrayCount(path) {
  const value = readJson(path, []);
  return Array.isArray(value) ? value.length : null;
}

function objectOrArrayCount(path) {
  const value = readJson(path, null);
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return null;
}

function maskRuntimeSummary(summary) {
  return {
    files: summary.files.map((file) => ({
      source: file.source,
      exists: file.exists,
    })),
    categories: summary.categories || [],
  };
}

function commandSummary(processInfo) {
  const command = String(processInfo?.CommandLine || "");
  if (!command) return "";
  return command
    .replace(/(Authorization|Cookie|token|password|secret|key|dsn|url)(=|:)\s*("[^"]+"|'[^']+'|[^\s]+)/gi, "$1$2[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[REDACTED]");
}

function serviceProcessTree(rootPid) {
  if (process.platform !== "win32" || !rootPid) return [];
  const script = [
    "$items=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate;",
    `$root=${Number(rootPid)};`,
    "$seen=@{};$queue=@($root);$out=@();",
    "while($queue.Count -gt 0){$currentPid=$queue[0];$queue=@($queue | Select-Object -Skip 1);",
    "if($seen.ContainsKey([string]$currentPid)){continue};$seen[[string]$currentPid]=1;",
    "$p=$items | Where-Object { $_.ProcessId -eq $currentPid };",
    "if($p){$out+=$p;$children=$items | Where-Object { $_.ParentProcessId -eq $currentPid };$queue += @($children | ForEach-Object { $_.ProcessId })}}",
    "$out | ConvertTo-Json -Compress",
  ].join("");
  try {
    const result = runSync("powershell.exe", ["-NoProfile", "-Command", script], { maxBuffer: 5 * 1024 * 1024 });
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((entry) => ({
      pid: entry.ProcessId,
      parentPid: entry.ParentProcessId,
      name: entry.Name,
      startedAt: entry.CreationDate,
      command: commandSummary(entry),
    }));
  } catch {
    return [];
  }
}

async function fetchStatus(baseUrl, path, options = {}) {
  if (forbiddenRequestPatterns.some((pattern) => pattern.test(path))) {
    throw new Error(`Refusing forbidden audit request: ${path}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: options.redirect || "follow",
      signal: controller.signal,
    });
    const text = options.readText === false ? "" : await response.text().catch(() => "");
    return { path, status: response.status, text };
  } catch (error) {
    return { path, status: 0, error: error instanceof Error ? error.message : String(error), text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function auditHttp(config) {
  const baseUrl = `http://127.0.0.1:${config.port}`;
  const routes = {};
  const requests = [];
  for (const path of safeHttpRoutes) {
    const redirect = path === "/admin/providers" || path === "/api/admin/provider-health" ? "manual" : "follow";
    const result = await fetchStatus(baseUrl, path, { redirect });
    requests.push(`GET ${path}`);
    routes[path] = {
      status: result.status,
      error: result.error || null,
      runtimeErrorMarkers: htmlRuntimeMarkers(result.text),
    };
  }
  const forbiddenRequests = requests.filter((request) => forbiddenRequestPatterns.some((pattern) => pattern.test(request)));
  return {
    baseUrl,
    routes,
    forbiddenRequests,
    generationEndpointsCalled: false,
    newApiGenerationCalled: false,
  };
}

function htmlRuntimeMarkers(text) {
  if (!text) return [];
  return [
    "Application error:",
    "Internal Server Error",
    "Minified React error",
    "Hydration failed",
    "ChunkLoadError",
  ].filter((marker) => text.includes(marker));
}

function tailFile(path, maxBytes = 256 * 1024) {
  if (!existsSync(path)) return "";
  const stats = statSync(path);
  const fd = readFileSync(path);
  return fd.subarray(Math.max(0, stats.size - maxBytes)).toString("utf8");
}

export function auditLogs(config, options = {}) {
  const text = tailFile(config.logFile);
  const windowStart = normalizeTimestamp(options.windowStart);
  const windowEnd = nowIso();
  if (!text) {
    return {
      logFile: config.logFile,
      logFiles: [config.logFile],
      exists: false,
      windowStart,
      windowEnd,
      currentFindings: [],
      historicalFindings: [],
      unknownFindings: [],
      findings: [],
      currentFindingCount: 0,
      historicalFindingCount: 0,
      unknownFindingCount: 0,
      untimestampedLines: 0,
    };
  }
  const window = splitLogWindow(text, windowStart);
  const currentFindings = collectLogFindings(window.currentText);
  const historicalFindings = collectLogFindings(window.historicalText);
  const unknownFindings = collectLogFindings(window.unknownText);
  return {
    logFile: config.logFile,
    logFiles: [config.logFile],
    exists: true,
    bytesScanned: Buffer.byteLength(text),
    windowStart,
    windowEnd,
    currentLines: window.currentLines,
    historicalLines: window.historicalLines,
    unknownLines: window.unknownLines,
    untimestampedLines: window.untimestampedLines,
    currentFindings,
    historicalFindings,
    unknownFindings,
    findings: currentFindings,
    currentFindingCount: currentFindings.length,
    historicalFindingCount: historicalFindings.length,
    unknownFindingCount: unknownFindings.length,
  };
}

export function splitLogWindow(text, windowStart) {
  const windowStartMs = parseLogDate(windowStart);
  const timestampGraceMs = 5000;
  const buckets = {
    current: [],
    historical: [],
    unknown: [],
  };
  let activeBucket = windowStartMs ? "unknown" : "current";
  let untimestampedLines = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    const timestamp = extractLogTimestamp(line);
    if (timestamp) {
      const lineMs = parseLogDate(timestamp);
      activeBucket = windowStartMs && lineMs + timestampGraceMs < windowStartMs ? "historical" : "current";
    } else {
      untimestampedLines += 1;
    }
    buckets[activeBucket].push(line);
  }
  return {
    currentText: buckets.current.join("\n"),
    historicalText: buckets.historical.join("\n"),
    unknownText: buckets.unknown.join("\n"),
    currentLines: buckets.current.length,
    historicalLines: buckets.historical.length,
    unknownLines: buckets.unknown.length,
    untimestampedLines,
  };
}

export function collectLogFindings(text) {
  return suspiciousLogPatterns
    .filter((entry) => entry.test ? entry.test(text) : entry.pattern.test(text))
    .map((entry) => entry.key);
}

function normalizeTimestamp(value) {
  const ms = parseLogDate(value);
  return ms ? new Date(ms).toISOString() : null;
}

function extractLogTimestamp(line) {
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/.exec(line);
  return iso ? iso[0] : null;
}

function parseLogDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const wmi = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?([+-]\d{3})?$/.exec(String(value));
  if (!wmi) return null;
  const [, year, month, day, hour, minute, second, fraction = "0", offset = "+000"] = wmi;
  const millis = Number(fraction.slice(0, 3).padEnd(3, "0"));
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis);
  return utc - Number(offset) * 60 * 1000;
}

function listDatabaseFiles(root) {
  return listFiles(root, {
    skipDirs: new Set([".git", ".next", ".runtime", "artifacts", "dist", "node_modules"]),
  }).filter((file) => /\.(sqlite|sqlite3|db)$/i.test(file) || normalizePath(relative(root, file)).startsWith("database/"));
}

function listFiles(root, options = {}) {
  if (!existsSync(root)) return [];
  const results = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (options.skipDirs?.has(entry.name)) continue;
      results.push(...listFiles(path, options));
    } else if (entry.isFile()) {
      results.push(path);
    }
  }
  return results.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/");
}

async function auditService(service) {
  const config = getServiceConfig(service);
  const status = await getServiceStatus(service, { root: config.root, repeat: 1 });
  const identity = await classifyServiceProcess(service, { root: config.root, port: config.port });
  const processInfo = identity.pid ? getProcessInfo(identity.pid) : null;
  const runtime = buildRuntimeEnv(service, { root: config.root });
  const http = await auditHttp(config);
  const health = await checkServiceHealth(service, { root: config.root, repeat: 1 });
  const activeRelease = safeReadActiveRelease(config);
  const dataSnapshot = snapshotDirectory(config.dataDir);
  const uploadsSnapshot = snapshotDirectory(config.uploadsDir);
  const counts = {
    library: arrayCount(join(config.dataDir, "library.json")),
    providers: arrayCount(join(config.dataDir, "providers.json")),
    jobs: arrayCount(join(config.dataDir, "jobs.json")),
    authUsers: objectOrArrayCount(join(config.dataDir, "auth-store.json")),
    taskBillingRecords: arrayCount(join(config.dataDir, "task-billing-records.json")),
  };

  return {
    service,
    label: config.label,
    root: config.root,
    port: config.port,
    pid: status.pid || identity.pid || null,
    startedAt: status.startedAt || identity.processInfo?.CreationDate || identity.state?.startedAt || null,
    processTree: serviceProcessTree(status.pid || identity.pid),
    process: {
      identity: identity.status,
      reason: identity.reason,
      command: commandSummary(processInfo),
      cwd: identity.state?.workdir || processInfo?.ExecutablePath || null,
      stateFile: config.stateFile,
    },
    git: {
      commit: safeGit(config.root, ["rev-parse", "HEAD"], "unknown"),
      branch: safeGit(config.root, ["branch", "--show-current"], "") || "detached",
      detached: !safeGit(config.root, ["branch", "--show-current"], ""),
      status: safeGit(config.root, ["status", "--short"], ""),
    },
    runtime: {
      activeRelease,
      runtimeRoot: status.runtimeRoot || activeRelease?.releaseRoot || config.root,
      runtimeCommit: status.runtimeCommit || activeRelease?.runtimeCommit || "unknown",
    },
    toolVersions: {
      node: process.version,
      npm: npmVersion(),
    },
    env: {
      files: runtime.files,
      missing: runtime.missing,
      summary: maskRuntimeSummary(runtime.summary),
      dataDir: runtime.env.DATA_DIR,
      uploadsDir: runtime.env.UPLOADS_DIR,
      databaseConfigured: Boolean(runtime.env.APP_DATABASE_URL),
      logFile: config.logFile,
    },
    data: dataSnapshot,
    uploads: uploadsSnapshot,
    counts,
    databaseFiles: listDatabaseFiles(config.root).map((file) => normalizePath(relative(config.root, file))),
    http,
    health,
    logs: auditLogs(config, { windowStart: identity.state?.startedAt || status.startedAt || identity.processInfo?.CreationDate }),
  };
}

function safeReadActiveRelease(config) {
  try {
    return readActiveRelease(config);
  } catch (error) {
    return { invalid: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function npmVersion() {
  try {
    return runSync("npm", ["--version"]).stdout.trim();
  } catch {
    return "unknown";
  }
}

function auditGitRange(root, fromCommit, toCommit) {
  if (!fromCommit || fromCommit === "unknown" || !toCommit || toCommit === "unknown") {
    return {
      fromCommit: fromCommit || "unknown",
      toCommit: toCommit || "unknown",
      commitCount: 0,
      log: [],
      stat: "",
      filesChanged: 0,
      added: [],
      modified: [],
      deleted: [],
      nameStatus: [],
      categories: categorizeFiles([]),
      risk: diffRisk([]),
    };
  }
  const log = safeGit(root, ["log", "--oneline", `${fromCommit}..${toCommit}`], "");
  const stat = safeGit(root, ["diff", "--stat", `${fromCommit}..${toCommit}`], "");
  const nameStatusText = safeGit(root, ["diff", "--name-status", `${fromCommit}..${toCommit}`], "");
  const nameStatus = nameStatusText.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split(/\t/);
    return { status, path: rest.join("\t") };
  });
  const files = nameStatus.map((entry) => entry.path);
  const categories = categorizeFiles(files);
  const risk = diffRisk(files);
  return {
    fromCommit,
    toCommit,
    commitCount: log ? log.split(/\r?\n/).filter(Boolean).length : 0,
    log: log.split(/\r?\n/).filter(Boolean),
    stat,
    filesChanged: files.length,
    added: nameStatus.filter((entry) => entry.status.startsWith("A")).map((entry) => entry.path),
    modified: nameStatus.filter((entry) => entry.status.startsWith("M")).map((entry) => entry.path),
    deleted: nameStatus.filter((entry) => entry.status.startsWith("D")).map((entry) => entry.path),
    nameStatus,
    categories,
    risk,
  };
}

function categorizeFiles(files) {
  const buckets = {
    stage3StudioRegressionGuards: [],
    stage4ProviderHealth: [],
    releaseArtifactCleanliness: [],
    stage5ErrorDiagnostics: [],
    opsTests: [],
    releaseTestArtifactIsolation: [],
    stage6ReleaseOpsHardening: [],
    docs: [],
    other: [],
  };
  for (const file of files) {
    if (/stage3|studio-api-contracts|STUDIO_REGRESSION/i.test(file)) buckets.stage3StudioRegressionGuards.push(file);
    else if (/provider-health|PROVIDER_HEALTH/i.test(file)) buckets.stage4ProviderHealth.push(file);
    else if (/release-artifact-cleanliness/i.test(file)) buckets.releaseArtifactCleanliness.push(file);
    else if (/stage5|ERROR_DIAGNOSTICS|error-diagnostic/i.test(file)) buckets.stage5ErrorDiagnostics.push(file);
    else if (/test-ops|active-release|rollback-drill/i.test(file)) buckets.opsTests.push(file);
    else if (/release-test-artifact-isolation/i.test(file)) buckets.releaseTestArtifactIsolation.push(file);
    else if (/deploy-service|PRODUCTION_RELEASE_RUNBOOK|ROLLBACK_RUNBOOK|PRODUCTION_OPERATIONS|PORT_RELEASE_WORKFLOW|ci\.yml/i.test(file)) buckets.stage6ReleaseOpsHardening.push(file);
    else if (file.startsWith("docs/")) buckets.docs.push(file);
    else buckets.other.push(file);
  }
  return buckets;
}

function diffRisk(files) {
  const matches = (patterns) => files.filter((file) => patterns.some((pattern) => pattern.test(file)));
  return {
    businessApi: matches([/^src\/app\/api\//]),
    requestFields: matches([/^src\/app\/api\//, /^src\/lib\/server\/types/, /^src\/lib\/server\/provider-call/]),
    responseStructure: matches([/^src\/app\/api\//, /^src\/lib\/server\/types/, /^src\/lib\/error-diagnostic/]),
    databaseSchema: matches([/^scripts\/database\//, /^src\/lib\/server\/database/, /^migrations\//]),
    dataUploadsStructure: matches([/^src\/lib\/server\/paths/, /^src\/lib\/server\/library/, /runtime-path/]),
    providerConfig: matches([/^src\/lib\/server\/providers/, /provider-health/]),
    startupDeployRollback: matches([/^scripts\/ops\//, /release-preflight/, /ROLLBACK_RUNBOOK/, /PRODUCTION_RELEASE_RUNBOOK/]),
    testsOrDocs: matches([/^scripts\/test-/, /^scripts\/check-/, /^docs\//, /^\.github\/workflows\//]),
    generationPathImpact: matches([/^src\/app\/api\/generate/, /^src\/app\/api\/upscale/, /^src\/lib\/server\/provider-call/, /^src\/lib\/server\/integrations\/new-api/]),
  };
}

function auditRollbackMaterials(config) {
  const backupRoot = config.backupRoot;
  const entries = existsSync(backupRoot)
    ? readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(config.backupPrefix))
      .map((entry) => join(backupRoot, entry.name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  const backups = entries.map((backupDir) => inspectBackup(config, backupDir));
  const preferred = backups.find((backup) => backup.path.includes("3106-production-20260627-014440")) || null;
  const latest = backups[0] || null;
  return {
    backupRoot,
    backupCount: backups.length,
    preferredExists: Boolean(preferred),
    preferred,
    latest,
    backups: backups.slice(0, 5),
    rollbackRunbookExists: existsSync(join(process.cwd(), "docs", "ROLLBACK_RUNBOOK.md")),
    releaseRunbookExists: existsSync(join(process.cwd(), "docs", "PRODUCTION_RELEASE_RUNBOOK.md")),
  };
}

function inspectBackup(config, backupDir) {
  let manifest = null;
  let manifestOk = false;
  let error = null;
  try {
    manifest = verifyBackupManifest(config, backupDir);
    manifestOk = true;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const files = listFiles(backupDir);
  return {
    path: backupDir,
    readable: existsSync(backupDir),
    manifestExists: existsSync(join(backupDir, "backup-manifest.json")),
    checksumsExists: existsSync(join(backupDir, "checksums.json")),
    rollbackScriptExists: existsSync(join(backupDir, `rollback-${config.service}.ps1`)),
    manifestOk,
    error,
    sourceCommit: manifest?.sourceCommit || manifest?.commit || null,
    databaseType: manifest?.databaseType || null,
    data: manifest?.data || null,
    uploads: manifest?.uploads || null,
    fileCount: files.length,
    totalSize: files.reduce((total, file) => total + statSync(file).size, 0),
    containsPreReleaseTestArtifact: files.some((file) => normalizePath(relative(backupDir, file)).endsWith("data/auth-store.json")),
  };
}

function auditDeployDryRunSource(root, targetCommit) {
  const packageJson = readJson(join(root, "package.json"), {});
  const deployScript = readFileSync(join(root, "scripts", "ops", "deploy-service.mjs"), "utf8");
  const packageScripts = packageJson.scripts || {};
  const checks = {
    deployProductionExists: packageScripts["deploy:production"] === "node scripts/ops/deploy-service.mjs production",
    requiresTarget: deployScript.includes("assertExplicitProductionTarget(service, options.target)"),
    rejectsNonOriginMainTarget: deployScript.includes("assertProductionTargetMatchesMain(service, config.root, targetCommit)"),
    rejectsDirtyWorktree: deployScript.includes("assertCleanWorktree(config.root)"),
    validatesTargetCommit: deployScript.includes("runSync(\"git\", [\"rev-parse\", target]"),
    validatesStagingBeforeStop: deployScript.includes("validateTargetInWorktree(service, config, runtime, targetCommit, report)")
      && deployScript.indexOf("validateTargetInWorktree(service, config, runtime, targetCommit, report)") < deployScript.indexOf("await stopService(service"),
    recordsPidAndCommit: deployScript.includes("pid: getListeningPid(config.port)") && deployScript.includes("commit: safeGit(config.root, [\"rev-parse\", \"HEAD\"]"),
    createsBackup: deployScript.includes("createServiceBackup(config"),
    verifiesBackup: deployScript.includes("verifyBackupManifest(config, backup.backupDir)"),
    runsReleasePreflight: deployScript.includes("scripts/ops/start-service.mjs\", service, \"--preflight-only"),
    runsAcceptance: deployScript.includes("checkServiceHealth(service"),
    restartsOnlyTargetService: deployScript.includes("await stopService(service") && deployScript.includes("await startService(service"),
    hasRollbackPath: deployScript.includes("restoreActiveRelease(config, previousActiveRelease)") && deployScript.includes("runSync(\"git\", [\"checkout\", \"--detach\", before.commit]"),
    preventsStagingDataInProduction: deployScript.includes("buildReleaseCandidateVerificationEnv(runtime.env, validationScratchRoot")
      && deployScript.includes("DATA_DIR: join(scratchRoot, \"data\")")
      && deployScript.includes("UPLOADS_DIR: join(scratchRoot, \"uploads\")"),
    dryRunDidNotExecuteDeploy: true,
  };
  return {
    targetCommit,
    checks,
    blockers: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key),
  };
}

function auditTrackedSafety(root) {
  const tracked = safeGit(root, ["ls-files"], "").split(/\r?\n/).filter(Boolean);
  const blockedPatterns = [
    { key: "envFiles", pattern: /(^|\/)\.env($|\.local$|[^/]*\.local$)/ },
    { key: "dataUploads", pattern: /(^|\/)(data|uploads|data-staging|uploads-staging)\// },
    { key: "runtime", pattern: /(^|\/)\.runtime\// },
    { key: "logsPid", pattern: /\.(log|pid)$/i },
    { key: "testArtifacts", pattern: /(^|\/)(playwright-report|test-results|artifacts)\// },
    { key: "databaseDump", pattern: /\.(dump|sqlite|sqlite3|db)$/i },
  ];
  const findings = {};
  for (const entry of blockedPatterns) {
    findings[entry.key] = tracked.filter((file) => entry.pattern.test(file));
  }
  return {
    trackedCount: tracked.length,
    findings,
    hasFindings: Object.values(findings).some((items) => items.length > 0),
  };
}

function scanSecretsInReport(value) {
  const text = JSON.stringify(value);
  const suspicious = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /ghp_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /postgres(?:ql)?:\/\/[^"\\]+:[^"\\]+@/i,
    /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
  ];
  return suspicious.filter((pattern) => pattern.test(text)).map(String);
}

function evaluateReport(report) {
  const blockers = [];
  const risks = [];

  if (report.git.expectedMainCommit && report.git.mainCommit !== report.git.expectedMainCommit) {
    blockers.push(`origin/main is ${report.git.mainCommit}, expected ${report.git.expectedMainCommit}`);
  }
  if (report.git.productionBaselineCommit && report.production.git.commit !== report.git.productionBaselineCommit) {
    blockers.push(`3106 worktree commit is ${report.production.git.commit}, expected ${report.git.productionBaselineCommit}`);
  }
  if (report.git.productionBaselineCommit && report.production.runtime.runtimeCommit !== report.git.productionBaselineCommit) {
    blockers.push(`3106 runtime commit is ${report.production.runtime.runtimeCommit}, expected ${report.git.productionBaselineCommit}`);
  }
  if (report.production.git.commit !== report.production.runtime.runtimeCommit) {
    blockers.push(`3106 worktree commit ${report.production.git.commit} does not match runtime commit ${report.production.runtime.runtimeCommit}`);
  }
  if (report.staging.runtime.runtimeCommit !== report.git.targetCommit) {
    risks.push(`3107 runtime commit is ${report.staging.runtime.runtimeCommit}, expected ${report.git.targetCommit}`);
  }

  evaluateHttp("3106", report.production, blockers, risks);
  evaluateHttp("3107", report.staging, blockers, risks);

  if (report.production.process.identity !== "owned") {
    blockers.push(`3106 process identity is ${report.production.process.identity}`);
  }
  if (report.staging.process.identity !== "owned") {
    risks.push(`3107 process identity is ${report.staging.process.identity}`);
  }
  evaluateLogFindings("3106", report.production, blockers, risks);
  evaluateLogFindings("3107", report.staging, blockers, risks);
  if (report.gitDiff.risk.businessApi.length) {
    risks.push(`main differs in business API files: ${report.gitDiff.risk.businessApi.join(", ")}`);
  }
  if (report.gitDiff.risk.databaseSchema.length) {
    blockers.push(`main differs in database schema files: ${report.gitDiff.risk.databaseSchema.join(", ")}`);
  }
  if (report.gitDiff.risk.generationPathImpact.length) {
    blockers.push(`main differs in generation path files: ${report.gitDiff.risk.generationPathImpact.join(", ")}`);
  }
  if (!report.rollback.preferredExists) {
    blockers.push("preferred rollback material is missing");
  }
  if (report.rollback.preferred && !report.rollback.preferred.manifestOk) {
    blockers.push(`preferred rollback manifest is invalid: ${report.rollback.preferred.error}`);
  }
  if (report.deployDryRun.blockers.length) {
    blockers.push(`deploy:production source audit failed: ${report.deployDryRun.blockers.join(", ")}`);
  }
  if (report.gitSafety.hasFindings) {
    blockers.push("tracked safety audit found forbidden runtime or secret-like files");
  }
  if (report.secretScan.length) {
    blockers.push(`audit report secret scan matched: ${report.secretScan.join(", ")}`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    risks,
  };
}

function evaluateHttp(label, serviceReport, blockers, risks) {
  const routes = serviceReport.http.routes;
  const routeStatus = (path) => routes[path]?.status ?? 0;
  if (routeStatus("/") !== 200) blockers.push(`${label} home status ${routeStatus("/")}`);
  if (routeStatus("/login") !== 200) blockers.push(`${label} login status ${routeStatus("/login")}`);
  if (!allowedAdminStatuses.has(routeStatus("/admin/providers"))) {
    blockers.push(`${label} admin/providers status ${routeStatus("/admin/providers")}`);
  }
  if (routeStatus("/api/health/backend") !== 200) blockers.push(`${label} health status ${routeStatus("/api/health/backend")}`);
  if (routeStatus("/api/library") !== 200) blockers.push(`${label} library status ${routeStatus("/api/library")}`);
  if (!allowedProtectedStatuses.has(routeStatus("/api/admin/provider-health"))) {
    risks.push(`${label} provider health unauthenticated status ${routeStatus("/api/admin/provider-health")}`);
  }
  for (const [path, result] of Object.entries(routes)) {
    if (result.status >= 500) blockers.push(`${label} ${path} returned ${result.status}`);
    if (result.runtimeErrorMarkers?.length) blockers.push(`${label} ${path} contains runtime marker ${result.runtimeErrorMarkers.join(", ")}`);
  }
  if (serviceReport.http.forbiddenRequests.length) {
    blockers.push(`${label} attempted forbidden requests: ${serviceReport.http.forbiddenRequests.join(", ")}`);
  }
}

function evaluateLogFindings(label, serviceReport, blockers, risks) {
  const logs = serviceReport.logs || {};
  const current = new Set(logs.currentFindings || logs.findings || []);
  const unknown = new Set(logs.unknownFindings || []);
  for (const key of ["http500", "runtimeException", "databaseError", "secretValueLeak", "generationCall"]) {
    if (current.has(key)) blockers.push(`${label} current log window contains ${key}`);
  }
  for (const key of ["secretValueLeak", "generationCall"]) {
    if (unknown.has(key)) blockers.push(`${label} untimestamped logs contain ${key}`);
  }
  for (const key of ["http500", "runtimeException", "databaseError", "provider", "secretKeyword"]) {
    if (unknown.has(key)) risks.push(`${label} untimestamped logs contain ${key}; current window starts at ${logs.windowStart || "unknown"}`);
  }
  if (current.has("secretKeyword")) {
    risks.push(`${label} current logs contain sensitive key-name markers; values are not included in the audit report`);
  }
}

function parseOptions(argv = process.argv.slice(2)) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    json: argv.includes("--json"),
    target: valueAfter("--target") || process.env.PRODUCTION_READINESS_TARGET || defaultTargetRef,
    expectedMain: valueAfter("--expected-main") || process.env.PRODUCTION_READINESS_EXPECTED_MAIN || "",
    productionBaseline: valueAfter("--production-baseline") || process.env.PRODUCTION_READINESS_PRODUCTION_BASELINE || "",
  };
}

async function buildReport(options = parseOptions()) {
  const root = process.cwd();
  const mainCommit = safeGit(root, ["rev-parse", "origin/main"], "unknown");
  const targetCommit = safeGit(root, ["rev-parse", options.target], "unknown");
  const headCommit = safeGit(root, ["rev-parse", "HEAD"], "unknown");
  const configs = getAllServiceConfigs();
  const productionConfig = configs.find((config) => config.service === "production");
  const stagingConfig = configs.find((config) => config.service === "staging");
  const production = await auditService("production");
  const staging = await auditService("staging");
  const productionBaselineCommit = options.productionBaseline || production.runtime.runtimeCommit || production.git.commit;
  const report = {
    audit: {
      name: "production-readiness",
      generatedAt: nowIso(),
      readOnly: true,
      realDeployExecuted: false,
      servicesStartedOrStopped: false,
      generationEndpointsCalled: false,
      newApiGenerationCalled: false,
      costProduced: false,
      algorithm: "snapshotDirectory: sorted files, relative path, file content sha256, file size; directory mtime excluded",
    },
    git: {
      root,
      headCommit,
      mainCommit,
      targetRef: options.target,
      targetCommit,
      expectedMainCommit: options.expectedMain || null,
      productionBaselineCommit,
      branch: safeGit(root, ["branch", "--show-current"], "") || "detached",
      status: safeGit(root, ["status", "--short"], ""),
    },
    production,
    staging,
    gitDiff: auditGitRange(root, productionBaselineCommit, targetCommit),
    rollback: auditRollbackMaterials(productionConfig),
    deployDryRun: auditDeployDryRunSource(root, targetCommit),
    gitSafety: auditTrackedSafety(root),
    serviceIsolation: {
      rootsSeparated: productionConfig.root !== stagingConfig.root,
      productionRoot: productionConfig.root,
      stagingRoot: stagingConfig.root,
      productionData: productionConfig.dataDir,
      stagingData: stagingConfig.dataDir,
      productionUploads: productionConfig.uploadsDir,
      stagingUploads: stagingConfig.uploadsDir,
    },
  };
  report.secretScan = scanSecretsInReport(report);
  report.result = evaluateReport(report);
  return report;
}

async function cli() {
  const options = parseOptions();
  const report = await buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (!report.result.ok) process.exit(1);
}

function printHuman(report) {
  console.log("Production readiness audit");
  console.log(`generatedAt=${report.audit.generatedAt}`);
  console.log(`readOnly=${report.audit.readOnly}`);
  console.log(`main=${report.git.mainCommit}`);
  console.log(`target=${report.git.targetRef} ${report.git.targetCommit}`);
  printService("3106", report.production);
  printService("3107", report.staging);
  console.log(`diff commits=${report.gitDiff.commitCount} files=${report.gitDiff.filesChanged}`);
  console.log(`preferredRollback=${report.rollback.preferredExists ? report.rollback.preferred.path : "missing"}`);
  console.log(`deployDryRunBlockers=${report.deployDryRun.blockers.length ? report.deployDryRun.blockers.join(",") : "none"}`);
  console.log(`generationEndpointsCalled=${report.audit.generationEndpointsCalled}`);
  console.log(`newApiGenerationCalled=${report.audit.newApiGenerationCalled}`);
  console.log(`costProduced=${report.audit.costProduced}`);
  if (report.result.blockers.length) {
    console.error("BLOCKERS:");
    for (const blocker of report.result.blockers) console.error(`- ${blocker}`);
  }
  if (report.result.risks.length) {
    console.error("RISKS:");
    for (const risk of report.result.risks) console.error(`- ${risk}`);
  }
  console.log(`ok=${report.result.ok}`);
}

function printService(label, service) {
  console.log(`${label}: pid=${service.pid || "missing"} identity=${service.process.identity} commit=${service.runtime.runtimeCommit}`);
  console.log(`${label}: data count=${service.data.count} size=${service.data.size} sha256=${service.data.sha256}`);
  console.log(`${label}: uploads count=${service.uploads.count} size=${service.uploads.size} sha256=${service.uploads.sha256}`);
  console.log(`${label}: home=${service.http.routes["/"]?.status} login=${service.http.routes["/login"]?.status} health=${service.http.routes["/api/health/backend"]?.status} library=${service.http.routes["/api/library"]?.status}`);
  console.log(`${label}: logFile=${service.logs.logFile} windowStart=${service.logs.windowStart || "unknown"} windowEnd=${service.logs.windowEnd || "unknown"}`);
  console.log(`${label}: logFindings current=${service.logs.currentFindingCount || 0} historical=${service.logs.historicalFindingCount || 0} unknown=${service.logs.unknownFindingCount || 0}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
