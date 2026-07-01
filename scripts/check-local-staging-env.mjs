#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const root = process.cwd();
const { loadEnvConfig } = nextEnv;

loadEnvConfig(root, true);

const { validateLocalStagingRuntimeEnv, formatRuntimeEnvironmentReport } = await loadEnvironmentCheckModule();
const report = validateLocalStagingRuntimeEnv({
  ...process.env,
  PORT: process.env.PORT || "3107",
  DATA_DIR: process.env.DATA_DIR || "data-staging",
  UPLOADS_DIR: process.env.UPLOADS_DIR || "uploads-staging",
});
console[report.ok ? "log" : "error"](formatRuntimeEnvironmentReport(report));
if (!report.ok) process.exit(1);

async function loadEnvironmentCheckModule() {
  const compileRoot = await mkdtemp(join(tmpdir(), "aohuang-env-check-"));
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
        join(root, "src/lib/upload-limits.ts"),
        join(root, "src/lib/media-retention.ts"),
        join(root, "src/lib/storage-capacity-policy.ts"),
        join(root, "src/lib/server/security/production-env.ts"),
      ],
    }));

    const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", tsconfigPath], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (tsc.error || tsc.status !== 0) {
      throw new Error("Environment check module could not be prepared.");
    }

    return await import(pathToFileURL(join(outDir, "src/lib/server/security/production-env.js")).href);
  } finally {
    await rm(compileRoot, { recursive: true, force: true });
  }
}
