#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = ["scripts/ops/start-service.mjs", "staging", "--foreground", ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
