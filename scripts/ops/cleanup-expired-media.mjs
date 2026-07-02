#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

class CleanupCliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cleanupExpiredMedia = await loadCleanupModule();
  const result = await cleanupExpiredMedia({ mode: options.apply ? "apply" : "dry-run" });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error instanceof CleanupCliError ? error.code : "cleanup_expired_media_failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    causeCode: typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined,
    message: error instanceof CleanupCliError ? error.message : "Expired media cleanup failed.",
  }, null, 2));
  process.exit(1);
});

function parseArgs(args) {
  let apply = false;
  let dryRun = false;
  let confirm = false;

  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else if (arg === "--confirm-apply") confirm = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new CleanupCliError("invalid_argument", `Unsupported argument: ${redactArg(arg)}`);
    }
  }

  if (apply && dryRun) {
    throw new CleanupCliError("invalid_mode", "Choose either dry-run or apply, not both.");
  }
  if (apply && !confirm) {
    throw new CleanupCliError("apply_requires_confirmation", "Apply mode requires --confirm-apply.");
  }
  return { apply };
}

async function loadCleanupModule() {
  const compileRoot = await mkdtemp(join(tmpdir(), "aohuang-media-cleanup-"));
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
        join(root, "src/lib/server/media-retention-cleanup.ts"),
      ],
    }));

    const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", tsconfigPath], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (tsc.error || tsc.status !== 0) {
      throw new CleanupCliError("cleanup_compile_failed", "Expired media cleanup module could not be prepared.");
    }

    const compiled = await import(pathToFileURL(join(outDir, "src/lib/server/media-retention-cleanup.js")).href);
    const cleanupExpiredMedia = compiled.cleanupExpiredMedia || compiled.default?.cleanupExpiredMedia;
    if (typeof cleanupExpiredMedia !== "function") {
      throw new CleanupCliError("cleanup_module_unavailable", "Expired media cleanup module is unavailable.");
    }
    return async (...args) => {
      try {
        return await cleanupExpiredMedia(...args);
      } finally {
        await rm(compileRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(compileRoot, { recursive: true, force: true });
    throw error;
  }
}

function redactArg(arg) {
  return String(arg)
    .replace(/(token|password|secret|key|signature)=([^&\s]+)/gi, "$1=[REDACTED]")
    .slice(0, 80);
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/ops/cleanup-expired-media.mjs --dry-run",
    "  node scripts/ops/cleanup-expired-media.mjs --apply --confirm-apply",
    "",
    "Dry-run is the default. Apply mode deletes expired local media files and marks their library records expired.",
  ].join("\n"));
}
