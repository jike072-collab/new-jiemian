#!/usr/bin/env node

const defaultRoutes = [
  "/login",
  "/register",
  "/?preview=1",
  "/templates",
];

function numberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

const host = stringArg("--host", process.env.APP_BIND_HOST || "127.0.0.1");
const port = numberArg("--port", Number(process.env.PORT || 3106));
const timeoutMs = numberArg("--timeout-ms", 10000);
const readyTimeoutMs = numberArg("--ready-timeout-ms", 60000);
const routeArgs = process.argv.includes("--routes")
  ? String(process.argv[process.argv.indexOf("--routes") + 1] || "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean)
  : defaultRoutes;

function urlFor(path) {
  return `http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchStatus(url, timeout) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return {
      status: response.status,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 0,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.name : "fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + readyTimeoutMs;
  const healthUrl = urlFor("/api/health/backend");
  let last = { status: 0, ms: 0 };

  while (Date.now() < deadline) {
    last = await fetchStatus(healthUrl, timeoutMs);
    if (last.status === 200) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`service did not become ready: status=${last.status}`);
}

try {
  const ready = await waitUntilReady();
  const results = [];
  for (const route of routeArgs) {
    const result = await fetchStatus(urlFor(route), timeoutMs);
    results.push({ route, ...result });
  }

  console.log(JSON.stringify({
    ok: results.every((result) => result.status > 0 && result.status < 500),
    port,
    readyMs: ready.ms,
    routes: results,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
