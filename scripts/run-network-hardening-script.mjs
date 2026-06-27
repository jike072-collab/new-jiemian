#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const scriptByMode = {
  snapshot: "network-exposure-snapshot.ps1",
  plan: "network-hardening-plan.ps1",
  rollback: "network-hardening-rollback.ps1",
};

const mode = process.argv[2];
const passthrough = process.argv.slice(3);

if (!scriptByMode[mode]) {
  console.error(`Expected one of: ${Object.keys(scriptByMode).join(", ")}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "Windows-only network hardening script skipped safely on non-Windows.",
    mode,
    mutatingCommandsExecuted: false,
  }, null, 2));
  process.exit(0);
}

const scriptPath = join(process.cwd(), "scripts", "ops", scriptByMode[mode]);
if (!existsSync(scriptPath)) {
  console.error(`Missing script: ${scriptPath}`);
  process.exit(1);
}

const result = spawnSync("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  ...passthrough,
], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
