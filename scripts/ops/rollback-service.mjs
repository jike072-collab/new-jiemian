#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { rollbackService } from "./deploy-service.mjs";

async function cli() {
  const service = process.argv[2];
  const root = valueAfter("--root");
  const backupDir = valueAfter("--backup");
  const commit = valueAfter("--commit");
  const mode = valueAfter("--mode") || "code-only";
  const health = await rollbackService(service, { root, backupDir, commit, mode });
  console.log(JSON.stringify({ service, mode, ok: health.ok, health }, null, 2));
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
