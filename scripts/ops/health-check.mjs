#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { getServiceConfig, serviceNames } from "./service-config.mjs";

export async function checkServiceHealth(service, options = {}) {
  const config = getServiceConfig(service, options);
  const host = "127.0.0.1";
  const repeat = Number(options.repeat || 10);
  const timeoutMs = Number(options.timeoutMs || 10000);
  const checks = [];
  for (let index = 0; index < repeat; index += 1) {
    checks.push(await fetchStatus(`http://${host}:${config.port}/api/health/backend`, timeoutMs));
  }
  const home = await fetchStatus(`http://${host}:${config.port}/`, timeoutMs);
  const login = await fetchStatus(`http://${host}:${config.port}/login`, timeoutMs);
  const library = await fetchStatus(`http://${host}:${config.port}/api/library`, timeoutMs);
  const admin = await fetchStatus(`http://${host}:${config.port}/admin/providers`, timeoutMs, "manual");
  const failures = checks.filter((status) => status !== 200).length;
  const ok = failures === 0 && home < 500 && login < 500 && library === 200 && [200, 302, 303, 307, 308, 401, 403].includes(admin);
  return {
    service,
    port: config.port,
    ok,
    repeat,
    healthStatuses: checks,
    failures,
    home,
    login,
    library,
    adminProviders: admin,
    newApiCalled: false,
  };
}

async function fetchStatus(url, timeoutMs, redirect = "follow") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect });
    return response.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function cli() {
  const firstArg = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const requested = firstArg ? [firstArg] : serviceNames;
  const json = process.argv.includes("--json");
  const repeatIndex = process.argv.indexOf("--repeat");
  const repeat = repeatIndex >= 0 ? Number(process.argv[repeatIndex + 1]) : 10;
  const results = [];
  for (const service of requested) {
    results.push(await checkServiceHealth(service, { repeat }));
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.service}: ok=${result.ok} port=${result.port} healthFailures=${result.failures}/${result.repeat} home=${result.home} library=${result.library} newApiCalled=false`);
    }
  }
  if (results.some((result) => !result.ok)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
