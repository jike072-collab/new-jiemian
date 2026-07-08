#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { planReleasePrune, pruneServiceReleases } from "./deploy-service.mjs";

function parseArgs(argv) {
  const service = argv[2] || "production";
  const rootIndex = argv.indexOf("--root");
  const keepIndex = argv.indexOf("--keep");
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run") || !apply;
  return {
    service,
    root: rootIndex >= 0 ? argv[rootIndex + 1] : undefined,
    keep: keepIndex >= 0 ? argv[keepIndex + 1] : undefined,
    dryRun,
    apply,
  };
}

async function cli() {
  const options = parseArgs(process.argv);
  const report = options.apply
    ? pruneServiceReleases(options.service, options)
    : planReleasePrune(options.service, options);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
