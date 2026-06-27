import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "provider-health-stage8a-tests");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-provider-health-stage8a-"));
const dataDir = join(tempRoot, "data");
const uploadsDir = join(tempRoot, "uploads");

try {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.provider-health-stage8a-tests.json"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (compile.status !== 0) {
    process.exitCode = compile.status ?? 1;
  } else {
    const tests = [
      "dist/provider-health-stage8a-tests/src/lib/server/__tests__/provider-health-stage8a.test.js",
    ];

    const run = spawnSync("node", ["--conditions=react-server", "--test", ...tests], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "3107",
        AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
        RUNTIME_STORAGE_ISOLATION: "strict",
        DATA_DIR: dataDir,
        UPLOADS_DIR: uploadsDir,
        APP_AUTH_PERSISTENCE_MODE: "json",
        APP_BILLING_PERSISTENCE_MODE: "json",
        APP_TASK_BILLING_PERSISTENCE_MODE: "json",
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    process.exitCode = run.status ?? 1;
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  if (existsSync(tempRoot)) {
    console.error("temporary Stage 8A provider health test directory cleanup failed.");
    process.exitCode = 1;
  }
}
