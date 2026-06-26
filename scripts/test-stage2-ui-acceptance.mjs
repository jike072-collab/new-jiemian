#!/usr/bin/env node
import { snapshotDirectory } from "./ops/backup-utils.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";

const host = "127.0.0.1";
const timeoutMs = 10000;
const modeLabels = [
  "图片生成",
  "图片编辑",
  "视频生成",
  "图片高清",
  "视频高清",
  "作品库",
];
const modeRoutes = [
  { tool: "image", label: "图片生成" },
  { tool: "image-editor", label: "图片编辑" },
  { tool: "video", label: "视频生成" },
  { tool: "image-upscale", label: "图片高清" },
  { tool: "video-upscale", label: "视频高清" },
  { tool: "library", label: "作品库" },
];
const htmlErrorMarkers = [
  "Application error:",
  "Internal Server Error",
  "Minified React error",
  "Hydration failed",
];

function fail(message) {
  throw new Error(message);
}

async function fetchResource(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: options.redirect || "follow",
      signal: controller.signal,
    });
    return {
      url,
      status: response.status,
      text: options.readText === false ? "" : await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractScriptUrls(html, baseUrl) {
  const matches = html.matchAll(/<script[^>]+src="([^"]+)"/g);
  return [...new Set([...matches].map((match) => new URL(match[1], baseUrl).toString()))];
}

function assertNoHtmlErrors(name, text) {
  for (const marker of htmlErrorMarkers) {
    if (text.includes(marker)) {
      fail(`${name} contains runtime error marker: ${marker}`);
    }
  }
}

function sameSnapshot(before, after) {
  return before.exists === after.exists
    && before.count === after.count
    && before.size === after.size
    && before.sha256 === after.sha256;
}

const config = getServiceConfig("staging");
const baseUrl = `http://${host}:${config.port}`;
const dataBefore = snapshotDirectory(config.dataDir);
const uploadsBefore = snapshotDirectory(config.uploadsDir);

const home = await fetchResource(`${baseUrl}/`);
const login = await fetchResource(`${baseUrl}/login`);
const adminProviders = await fetchResource(`${baseUrl}/admin/providers`, { redirect: "manual" });
const health = await fetchResource(`${baseUrl}/api/health/backend`);
const library = await fetchResource(`${baseUrl}/api/library`);

if (home.status !== 200) fail(`home returned ${home.status}`);
if (login.status !== 200) fail(`login returned ${login.status}`);
if (![200, 302, 303, 307, 308, 401, 403].includes(adminProviders.status)) {
  fail(`admin/providers returned unexpected status ${adminProviders.status}`);
}
if (health.status !== 200) fail(`health returned ${health.status}`);
if (library.status !== 200) fail(`library returned ${library.status}`);
for (const page of [
  ["home", home],
  ["login", login],
  ["admin/providers", adminProviders],
  ["health", health],
  ["library", library],
]) {
  const [name, response] = page;
  if (response.status >= 500) fail(`${name} returned ${response.status}`);
}

assertNoHtmlErrors("home", home.text);
assertNoHtmlErrors("login", login.text);

const assetUrls = extractScriptUrls(home.text, baseUrl);
const assetBodies = [];
for (const assetUrl of assetUrls) {
  const asset = await fetchResource(assetUrl);
  if (asset.status !== 200) fail(`asset returned ${asset.status}: ${assetUrl}`);
  assetBodies.push(asset.text);
}

const labelCorpus = [home.text, ...assetBodies].join("\n");
const modeResults = Object.fromEntries(modeLabels.map((label) => [label, labelCorpus.includes(label)]));
const missingModes = modeLabels.filter((label) => !modeResults[label]);
if (missingModes.length) {
  fail(`missing Studio mode labels: ${missingModes.join(", ")}`);
}

const modeRouteResults = {};
for (const modeRoute of modeRoutes) {
  const response = await fetchResource(`${baseUrl}/?preview=1&tool=${modeRoute.tool}`);
  if (response.status !== 200) {
    fail(`preview route for ${modeRoute.tool} returned ${response.status}`);
  }
  assertNoHtmlErrors(`preview route ${modeRoute.tool}`, response.text);
  modeRouteResults[modeRoute.label] = response.status;
}

const dataAfter = snapshotDirectory(config.dataDir);
const uploadsAfter = snapshotDirectory(config.uploadsDir);
if (!sameSnapshot(dataBefore, dataAfter)) fail("data-staging changed during UI acceptance.");
if (!sameSnapshot(uploadsBefore, uploadsAfter)) fail("uploads-staging changed during UI acceptance.");

console.log(JSON.stringify({
  baseUrl,
  home: home.status,
  login: login.status,
  adminProviders: adminProviders.status,
  health: health.status,
  library: library.status,
  modes: modeResults,
  modeRoutes: modeRouteResults,
  assetsChecked: assetUrls.length,
  consoleErrors: "verified separately via browser automation",
  generationEndpointsCalled: false,
  newApiCalled: false,
  dataStagingChanged: false,
  uploadsStagingChanged: false,
}, null, 2));
