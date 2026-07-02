#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

class StorageCheckCliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const getStorageCapacityStatus = await loadStorageModule();
  const status = await getStorageCapacityStatus({ fresh: true });
  const output = {
    ok: status.ok,
    level: status.level,
    needsCleanup: status.needsCleanup,
    checkedAt: status.checkedAt,
    thresholds: status.thresholds,
    thresholdConfigValid: status.thresholdConfigValid,
    roots: status.roots.map((item) => ({
      label: item.label,
      ok: item.ok,
      level: item.level,
      totalBytes: item.totalBytes,
      usedBytes: item.usedBytes,
      availableBytes: item.availableBytes,
      usedPercent: item.usedPercent,
      total: formatBytes(item.totalBytes),
      used: formatBytes(item.usedBytes),
      available: formatBytes(item.availableBytes),
      errorCode: item.errorCode,
    })),
  };
  console.log(options.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
  if (status.level === "unavailable" || status.level === "emergency") process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error instanceof StorageCheckCliError ? error.code : "storage_check_failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof StorageCheckCliError ? error.message : "Storage capacity check failed.",
  }, null, 2));
  process.exit(1);
});

function parseArgs(args) {
  let pretty = true;
  for (const arg of args) {
    if (arg === "--json") pretty = false;
    else if (arg === "--pretty") pretty = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new StorageCheckCliError("invalid_argument", `Unsupported argument: ${redactArg(arg)}`);
    }
  }
  return { pretty };
}

async function loadStorageModule() {
  const compileRoot = await mkdtemp(join(tmpdir(), "aohuang-storage-check-"));
  try {
    const outDir = join(compileRoot, "out");
    await symlink(join(root, "node_modules"), join(compileRoot, "node_modules"), "junction").catch(() => undefined);
    await symlink(join(root, "node_modules"), join(outDir, "node_modules"), "junction").catch(() => undefined);
    const tsconfigPath = join(compileRoot, "tsconfig.json");
    await writeFile(tsconfigPath, JSON.stringify({
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        allowJs: false,
        declaration: false,
        emitDeclarationOnly: false,
        incremental: false,
        module: "CommonJS",
        moduleResolution: "Node",
        noEmit: false,
        outDir,
        rootDir: root,
        target: "ES2022",
        tsBuildInfoFile: join(compileRoot, "tsconfig.tsbuildinfo"),
      },
      files: [
        join(root, "src/lib/storage-capacity-policy.ts"),
        join(root, "src/lib/server/storage-capacity.ts"),
      ],
    }));

    const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", tsconfigPath], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (tsc.error || tsc.status !== 0) {
      throw new StorageCheckCliError("storage_check_compile_failed", "Storage capacity module could not be prepared.");
    }

    const compiled = await import(pathToFileURL(join(outDir, "src/lib/server/storage-capacity.js")).href);
    const getStorageCapacityStatus = compiled.getStorageCapacityStatus || compiled.default?.getStorageCapacityStatus;
    if (typeof getStorageCapacityStatus !== "function") {
      throw new StorageCheckCliError("storage_check_module_unavailable", "Storage capacity module is unavailable.");
    }
    return async (...args) => {
      try {
        return await getStorageCapacityStatus(...args);
      } finally {
        await rm(compileRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(compileRoot, { recursive: true, force: true });
    throw error;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) return `${Math.round(gib * 10) / 10}GiB`;
  const mib = bytes / (1024 ** 2);
  return `${Math.round(mib * 10) / 10}MiB`;
}

function redactArg(arg) {
  return String(arg)
    .replace(/(token|password|secret|key|signature)=([^&\s]+)/gi, "$1=[REDACTED]")
    .slice(0, 80);
}

function printHelp() {
  console.log([
    "Usage:",
    "  node --conditions=react-server scripts/ops/storage-check.mjs",
    "  node --conditions=react-server scripts/ops/storage-check.mjs --json",
    "",
    "Checks DATA_DIR and UPLOADS_DIR filesystem capacity and reports the current protection level.",
  ].join("\n"));
}
