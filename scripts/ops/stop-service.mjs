#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { getServiceConfig } from "./service-config.mjs";
import { getListeningPid, stopProcessTree } from "./process-utils.mjs";

export function stopService(service, options = {}) {
  const config = getServiceConfig(service, options);
  const pid = getListeningPid(config.port);
  if (!pid) return { service, port: config.port, stopped: false, reason: "not-listening" };
  stopProcessTree(pid);
  return { service, port: config.port, stopped: true, pid };
}

function cli() {
  const service = process.argv[2];
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const result = stopService(service, { root });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
