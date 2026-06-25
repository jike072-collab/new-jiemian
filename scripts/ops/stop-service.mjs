#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { getServiceConfig } from "./service-config.mjs";
import { stopProcessTree } from "./process-utils.mjs";
import { assertOwnedIdentity, classifyServiceProcess } from "./process-identity.mjs";

export async function stopService(service, options = {}) {
  const config = getServiceConfig(service, options);
  const identity = await classifyServiceProcess(service, { root: config.root, port: config.port });
  if (["stopped", "stale"].includes(identity.status)) {
    return { service, port: config.port, stopped: false, identity: identity.status, reason: identity.reason };
  }
  assertOwnedIdentity(identity, "stop-service");
  stopProcessTree(identity.pid);
  return { service, port: config.port, stopped: true, pid: identity.pid, identity: identity.status };
}

async function cli() {
  const service = process.argv[2];
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const result = await stopService(service, { root });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
