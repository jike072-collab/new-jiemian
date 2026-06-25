#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Missing startup command.");
  process.exit(1);
}

let executable = command;
let finalArgs = args;

if (command === "node") {
  executable = process.execPath;
} else if (command === "next") {
  executable = process.execPath;
  finalArgs = [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), ...args];
}

const child = spawn(executable, finalArgs, {
  cwd: process.cwd(),
  env: { ...process.env, PORT: process.env.PORT || "3107" },
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
