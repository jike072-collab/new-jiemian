#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const node = process.execPath;
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const env = { ...process.env, PORT: process.env.PORT || "3107" };
const preflightOnly = process.argv.includes("--preflight-only");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      shell: false,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} exited with signal ${signal}`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with status ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

function startNext() {
  const child = spawn(node, [nextBin, "start", "-H", "127.0.0.1"], {
    cwd: root,
    env,
    shell: false,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    });
  }
}

try {
  await run(node, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/release-preflight.mjs"]);
  if (preflightOnly) process.exit(0);
  startNext();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Staging startup preflight failed.");
  process.exit(1);
}
