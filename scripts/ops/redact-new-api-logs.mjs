#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { redactSensitiveText } from "./log-utils.mjs";

export function redactNewApiLogText(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => redactSensitiveText(line, { maxStringLength: 2000 }))
    .join("\n");
}

function usage() {
  console.error("Usage: node scripts/ops/redact-new-api-logs.mjs [--input <log-file> --output <log-file>]");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { input: "", output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") {
      index += 1;
      if (!argv[index]) usage();
      args.input = argv[index];
    } else if (value === "--output") {
      index += 1;
      if (!argv[index]) usage();
      args.output = argv[index];
    } else {
      usage();
    }
  }
  if (Boolean(args.input) !== Boolean(args.output)) usage();
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const input = args.input ? readFileSync(args.input, "utf8") : readFileSync(0, "utf8");
  const output = redactNewApiLogText(input);
  if (args.output) {
    writeFileSync(args.output, output);
    console.log(args.output);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
