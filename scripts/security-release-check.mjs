#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "security-release-tests");
const releaseTsconfig = join(root, "tsconfig.security-release-tests.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const useWindowsCommandShell = process.platform === "win32" && ["npm", "npx"].includes(command);
  const executable = useWindowsCommandShell ? "cmd.exe" : command;
  const finalArgs = useWindowsCommandShell ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error && options.allowMissing) return result;
  if (options.allowStatus?.includes(result.status)) return result;
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `${command} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}

function auditSummary() {
  const result = run("npm", ["audit", "--json"], { allowStatus: [0, 1] });
  let audit;
  try {
    audit = JSON.parse(result.stdout || "{}");
  } catch {
    fail("npm audit did not return valid JSON.");
  }
  const vulnerabilities = audit.metadata?.vulnerabilities || {};
  const summary = {
    info: vulnerabilities.info || 0,
    low: vulnerabilities.low || 0,
    moderate: vulnerabilities.moderate || 0,
    high: vulnerabilities.high || 0,
    critical: vulnerabilities.critical || 0,
    total: vulnerabilities.total || 0,
  };
  if (summary.high > 0 || summary.critical > 0) {
    fail(`npm audit has production blockers: ${JSON.stringify(summary)}`);
  }
  return summary;
}

function secretScan() {
  const pattern = "[-]{5}BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY[-]{5}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}";
  const result = run("git", ["grep", "-n", "-I", "-E", "-e", pattern, "--", ":!package-lock.json"], { allowStatus: [0, 1] });
  if (result.status === 0) {
    fail(`potential secret pattern found:\n${result.stdout}`);
  }
  return { matched: false };
}

function trackedRuntimeFileScan() {
  const result = run("git", ["ls-files"]);
  const forbidden = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => (
      /(^|\/)\.env$/.test(file)
      || /(^|\/)\.next\//.test(file)
      || /(^|\/)data\//.test(file)
      || /auth-store\.json$/.test(file)
      || /billing-store\.json$/.test(file)
      || /quota-usage-log\.json$/.test(file)
      || /\.(sqlite|sqlite3|db)$/.test(file)
    ));
  if (forbidden.length) fail(`tracked runtime or database files found:\n${forbidden.join("\n")}`);
  return { forbidden: 0 };
}

function composeStaticScan() {
  const infraDir = join(root, "infra", "new-api");
  const composeFile = join(infraDir, "docker-compose.yml");
  if (!existsSync(composeFile)) fail("infra/new-api/docker-compose.yml is missing.");
  const compose = readFileSync(composeFile, "utf8");
  const postgresBlock = serviceBlock(compose, "postgres");
  const redisBlock = serviceBlock(compose, "redis");
  const newApiBlock = serviceBlock(compose, "new-api");
  for (const [service, block] of [["postgres", postgresBlock], ["redis", redisBlock]]) {
    if (/^\s{4}ports:\s*$/m.test(block)) fail(`${service} must not define host ports in docker-compose.yml.`);
  }
  if (!newApiBlock.includes('"${NEW_API_BIND_ADDRESS}:${NEW_API_PORT}:${PORT}"')) {
    fail("new-api port must be bound through NEW_API_BIND_ADDRESS.");
  }
  if (!/^\s{4}image:\s+\S+:\S+/m.test(postgresBlock) || !/^\s{4}image:\s+\S+:\S+/m.test(redisBlock)) {
    fail("postgres and redis images must be pinned by tag at minimum.");
  }
  const envFile = join(infraDir, ".env");
  const createdEnv = !existsSync(envFile);
  if (createdEnv) {
    writeFileSync(envFile, [
      "NEW_API_IMAGE=calciumion/new-api:v1.0.0-rc.11@sha256:bd30213d808857bb569ef47d3c9209d061a66ea089c2472ef46ce51e75517f19",
      "NEW_API_BIND_ADDRESS=127.0.0.1",
      "NEW_API_PORT=3000",
      "PORT=3000",
      "TZ=Asia/Shanghai",
      "NODE_TYPE=master",
      "NODE_NAME=release-check",
      "LOG_LEVEL=info",
      "ERROR_LOG_ENABLED=true",
      "BATCH_UPDATE_ENABLED=true",
      "POSTGRES_DB=new_api_release_check",
      "POSTGRES_USER=new_api_release_check",
      "POSTGRES_PASSWORD=release-check-placeholder",
      "SQL_DSN=postgresql://new_api_release_check:release-check-placeholder@postgres:5432/new_api_release_check?sslmode=disable",
      "REDIS_PASSWORD=release-check-placeholder",
      "REDIS_CONN_STRING=redis://:release-check-placeholder@redis:6379/0",
      "SESSION_SECRET=release-check-placeholder-session-secret",
      "CRYPTO_SECRET=release-check-placeholder-crypto-secret",
      "",
    ].join("\n"));
  }
  try {
    const result = run("docker", ["compose", "config", "--format", "json"], { cwd: infraDir, allowMissing: true });
    if (result.error?.code === "ENOENT") {
      return {
        postgresPublic: false,
        redisPublic: false,
        newApiBind: "${NEW_API_BIND_ADDRESS}",
        dockerAvailable: false,
      };
    }
    const config = JSON.parse(result.stdout || "{}");
    const services = config.services || {};
    for (const service of ["postgres", "redis"]) {
      const ports = Array.isArray(services[service]?.ports) ? services[service].ports : [];
      if (ports.length) fail(`${service} must not expose host ports.`);
    }
    const newApiPorts = Array.isArray(services["new-api"]?.ports) ? services["new-api"].ports : [];
    if (newApiPorts.length === 0) fail("new-api must expose a local HTTP port for verification.");
    for (const port of newApiPorts) {
      const hostIp = port.host_ip || port.host_ip_address || "";
      if (hostIp !== "127.0.0.1") fail(`new-api must bind to 127.0.0.1, got ${hostIp || "<empty>"}.`);
    }
    return { postgresPublic: false, redisPublic: false, newApiBind: "127.0.0.1", dockerAvailable: true };
  } finally {
    if (createdEnv) rmSync(envFile, { force: true });
  }
}

function serviceBlock(compose, service) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) fail(`${service} service is missing from infra/new-api/docker-compose.yml.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:$/.test(lines[index]) || lines[index] === "networks:") {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function compileReleaseChecks() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  run("npx", ["tsc", "-p", releaseTsconfig]);
}

function backendReleaseReport() {
  compileReleaseChecks();
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: "3106",
    APP_BIND_HOST: "127.0.0.1",
    ADMIN_PASSWORD: "ReleaseCheckAdmin#2026",
    AUTH_SESSION_SECRET: "release-check-auth-session-secret-32-chars",
    DATA_DIR: "/srv/aohuang-ai/new-jiemian/data",
    UPLOADS_DIR: "/srv/aohuang-ai/new-jiemian/uploads",
    RUNTIME_DIR: "/srv/aohuang-ai/new-jiemian/.runtime",
    APP_DATABASE_URL: "postgresql://release_user:release_pass@127.0.0.1:5432/aohuang_app",
    APP_DATABASE_EXPECTED_NAME: "aohuang_app",
    APP_AUTH_PERSISTENCE_MODE: "postgres",
    APP_BILLING_PERSISTENCE_MODE: "postgres",
    APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
    DATABASE_IMPORT_DRY_RUN_ONLY: "true",
    NEW_API_ENABLED: "true",
    NEW_API_BASE_URL: "https://new-api.example.test",
    NEW_API_ENVIRONMENT: "production",
    NEW_API_ADMIN_USER_ID: "1",
    NEW_API_ADMIN_ACCESS_TOKEN: "release-check-admin-token",
  };
  delete env.PAYMENT_PRODUCTION_ENABLED;
  delete env.PAYMENT_PRODUCTION_WEBHOOK_SECRET;
  const js = "import('./dist/security-release-tests/src/lib/server/security/release-check.js').then(({runBackendReleaseChecks})=>{const report=runBackendReleaseChecks(new Date('2026-06-19T00:00:00.000Z')); console.log(JSON.stringify(report)); process.exit(report.ok ? 0 : 1);}).catch((error)=>{console.error(error?.message || error); process.exit(1);});";
  const result = run("node", ["--conditions=react-server", "--input-type=module", "-e", js], { env });
  const report = JSON.parse(result.stdout || "{}");
  const serialized = JSON.stringify(report);
  for (const leaked of ["release_pass", "release-check-admin-token", "postgresql://", "new-api.example.test"]) {
    if (serialized.includes(leaked)) fail(`release check report leaked ${leaked}.`);
  }
  return report;
}

function bundleScanIfBuilt() {
  if (!existsSync(join(root, ".next", "static"))) {
    return { skipped: true, reason: ".next/static is not present; run npm run build before bundle scan." };
  }
  run("node", ["scripts/database/bundle-scan.mjs"]);
  return { skipped: false };
}

function backupRestoreScripts() {
  const required = [
    "infra/new-api/scripts/preflight",
    "infra/new-api/scripts/healthcheck",
    "infra/new-api/scripts/backup",
    "infra/new-api/scripts/restore",
    "infra/new-api/scripts/rollback",
  ];
  const missing = required.filter((file) => !existsSync(join(root, file)));
  if (missing.length) fail(`required operations scripts missing:\n${missing.join("\n")}`);
  return { checked: required.length };
}

function migrationScripts() {
  const required = [
    "scripts/database/migrate.mjs",
    "scripts/database/auth-data-migration.mjs",
    "scripts/database/verify-auth-persistence.mjs",
  ];
  const missing = required.filter((file) => !existsSync(join(root, file)));
  if (missing.length) fail(`required migration scripts missing:\n${missing.join("\n")}`);
  return { checked: required.length };
}

function standardStartPreflight() {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts || {};
  if (!String(scripts.start || "").includes("release:preflight")) {
    fail("npm start must run release:preflight before next start.");
  }
  if (!String(scripts["release:preflight"] || "").includes("scripts/release-preflight.mjs")) {
    fail("release:preflight must run scripts/release-preflight.mjs.");
  }
  return { enforced: true };
}

function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    npmAudit: auditSummary(),
    secretScan: secretScan(),
    trackedRuntimeFiles: trackedRuntimeFileScan(),
    dockerCompose: composeStaticScan(),
    backendRelease: backendReleaseReport(),
    bundleScan: bundleScanIfBuilt(),
    backupRestoreScripts: backupRestoreScripts(),
    migrationScripts: migrationScripts(),
    standardStartPreflight: standardStartPreflight(),
  };
  const outputPath = process.argv.includes("--write-report")
    ? join(root, "docs", "architecture", "auth-newapi", "BP_06_SECURITY_RELEASE_CHECK.json")
    : "";
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
