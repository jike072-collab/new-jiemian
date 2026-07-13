import { spawnSync } from "node:child_process";

const result = spawnSync("k6", ["run", "tests/performance/read-only-smoke.js"], {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error?.code === "ENOENT" || result.status === 9009) {
  throw new Error("k6 is required for performance smoke tests. Install k6 and rerun npm run test:performance:smoke.");
}
if (result.status !== 0) process.exit(result.status || 1);
