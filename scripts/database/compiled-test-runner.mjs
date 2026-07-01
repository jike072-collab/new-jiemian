#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const runsRoot = resolve(root, "dist", "database-test-runs");

function safeRelativePath(path) {
  const relativePath = relative(root, path).split(sep).join("/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : "[outside-repo]";
}

function assertInsideRunsRoot(path) {
  const resolved = resolve(path);
  if (resolved === runsRoot || !resolved.startsWith(`${runsRoot}${sep}`)) {
    throw new Error(`Refusing to operate outside dist/database-test-runs: ${safeRelativePath(resolved)}`);
  }
}

function createOutDir() {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const outDir = resolve(runsRoot, `run-${process.pid}-${stamp}-${randomUUID().slice(0, 8)}`);
  assertInsideRunsRoot(outDir);
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

function cleanupOutDir(outDir) {
  assertInsideRunsRoot(outDir);
  try {
    rmSync(outDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
    return 0;
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
    console.error(`database test cleanup failed (${code}) for ${safeRelativePath(outDir)}`);
    return 1;
  }
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

export function runOrExit(command, args, env = process.env) {
  const status = run(command, args, env);
  if (status !== 0) process.exit(status);
}

export function runCompiledDatabaseTestsOrExit(testFiles, options = {}) {
  const outDir = createOutDir();
  let status = 0;
  try {
    status = run(process.execPath, [
      "node_modules/typescript/bin/tsc",
      "-p",
      "tsconfig.database-tests.json",
      "--outDir",
      outDir,
      "--tsBuildInfoFile",
      join(outDir, "tsconfig.tsbuildinfo"),
    ]);

    if (status === 0) {
      const nodeArgs = [
        "--conditions=react-server",
        "--test",
        "--test-timeout=30000",
      ];
      if (options.testNamePattern) {
        nodeArgs.push("--test-name-pattern", options.testNamePattern);
      }
      nodeArgs.push(...testFiles.map((file) => join(outDir, ...file.split("/"))));
      status = run(process.execPath, nodeArgs);
    }
  } finally {
    const cleanupStatus = cleanupOutDir(outDir);
    if (status === 0 && cleanupStatus !== 0) status = cleanupStatus;
  }

  if (status !== 0) process.exit(status);
}
