#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-release-preflight-"));
const outDir = join(tempRoot, "release-preflight");
const tsBuildInfoFile = join(tempRoot, "release-preflight.tsbuildinfo");
const { loadEnvConfig } = nextEnv;

function fail(message) {
  throw new Error(message);
}

async function runRuntimeStoragePreflight() {
  try {
    const { ensureDataDir, ensureUploadsDir, validateRuntimeStorageIsolation } = await import("../src/lib/server/runtime-paths.ts");
    const report = validateRuntimeStorageIsolation();
    if (report.strict) {
      await ensureDataDir();
      await ensureUploadsDir();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "运行时存储目录检查失败。");
  }
}

function run(command, args, options = {}) {
  const useWindowsCommandShell = process.platform === "win32" && ["npx"].includes(command);
  const executable = useWindowsCommandShell ? "cmd.exe" : command;
  const finalArgs = useWindowsCommandShell ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: root,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `${command} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

try {
  loadEnvConfig(root, process.env.NODE_ENV !== "production");

  await runRuntimeStoragePreflight();

  run("npx", [
    "tsc",
    "-p",
    "tsconfig.security-release-tests.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    tsBuildInfoFile,
  ]);

  const releaseCheckUrl = pathToFileURL(join(outDir, "src", "lib", "server", "security", "release-check.js")).href;
  const js = `
    process.env.NODE_ENV = "production";
    import(${JSON.stringify(releaseCheckUrl)})
      .then(({ runBackendReleaseChecks }) => {
        const report = runBackendReleaseChecks();
        if (!report.ok) {
          console.error("Backend release preflight failed.");
          console.error(JSON.stringify(report, null, 2));
          process.exit(1);
        }
        console.log("Backend release preflight passed.");
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "Backend release preflight failed.");
        process.exit(1);
      });
  `;

  run("node", ["--conditions=react-server", "--input-type=module", "-e", js], {
    env: { ...process.env, NODE_ENV: "production", NODE_PATH: join(root, "node_modules") },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
