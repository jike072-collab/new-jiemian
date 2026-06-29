#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  assertNoForbiddenRequests,
  assertNoHtmlErrors,
  extractScriptUrls,
  fetchTracked,
  studioModeRoutes,
  withStudioTestTarget,
} from "./studio-ui-test-utils.mjs";

const requiredRuntimeTokens = [
  "reference-image-input",
  "video-first-frame-input",
  "image-upscale-input",
  "video-upscale-input",
  "library-search",
  "studio-library-confirm",
  "studio-error-text",
  "studio-preview",
  "studio-primary-action",
  "studio-secondary-button",
  "studio-danger-button",
];

const allowedAdminStatuses = [200, 302, 303, 307, 308, 401, 403];

await runJsonFetchBehaviorTests();

const skipRuntime = process.env.STUDIO_TEST_SKIP_RUNTIME === "1" || process.argv.includes("--skip-runtime");
let runtimeResult = { skipped: true, reason: "STUDIO_TEST_SKIP_RUNTIME=1 or --skip-runtime" };
if (!skipRuntime) {
  runtimeResult = await runRuntimeRegressionChecks();
}

console.log(JSON.stringify({
  jsonFetchBehavior: "passed",
  runtime: runtimeResult,
  generationEndpointsCalled: false,
  newApiCalled: false,
}, null, 2));

async function runRuntimeRegressionChecks() {
  return withStudioTestTarget(async ({ baseUrl, managed }) => {
    const requests = [];
    const pages = {
      home: await fetchTracked(requests, baseUrl, "/"),
      preview: await fetchTracked(requests, baseUrl, "/?preview=1"),
      login: await fetchTracked(requests, baseUrl, "/login"),
      adminProviders: await fetchTracked(requests, baseUrl, "/admin/providers", { redirect: "manual" }),
      health: await fetchTracked(requests, baseUrl, "/api/health/backend"),
      library: await fetchTracked(requests, baseUrl, "/api/library"),
    };

    assert.equal(pages.home.status, 200, "home returns 200");
    assert.equal(pages.preview.status, 200, "preview home returns 200");
    assert.equal(pages.login.status, 200, "login returns 200");
    assert.equal(pages.health.status, 200, "health returns 200");
    assert.equal(pages.library.status, 401, "unauthenticated /api/library returns 401");
    assert(allowedAdminStatuses.includes(pages.adminProviders.status), `admin providers returned ${pages.adminProviders.status}`);

    for (const [name, response] of Object.entries(pages)) {
      assert(response.status < 500, `${name} returned ${response.status}`);
      assertNoHtmlErrors(name, response.text);
    }

    const routeStatuses = {};
    const routeBodies = [pages.home.text, pages.preview.text, pages.login.text];
    for (const modeRoute of studioModeRoutes) {
      const response = await fetchTracked(requests, baseUrl, `/?preview=1&tool=${modeRoute.tool}`);
      assert.equal(response.status, 200, `preview route ${modeRoute.tool} returns 200`);
      assertNoHtmlErrors(`preview route ${modeRoute.tool}`, response.text);
      routeStatuses[modeRoute.tool] = response.status;
      routeBodies.push(response.text);
    }

    const assetUrls = extractScriptUrls(pages.home.text, baseUrl);
    const assetBodies = [];
    for (const assetUrl of assetUrls) {
      const asset = await fetchTracked(requests, baseUrl, assetUrl);
      assert.equal(asset.status, 200, `asset returns 200: ${assetUrl}`);
      assetBodies.push(asset.text);
    }

    const corpus = [...routeBodies, ...assetBodies].join("\n");
    const modeLabels = Object.fromEntries(studioModeRoutes.map((route) => [route.label, corpus.includes(route.label)]));
    for (const [label, present] of Object.entries(modeLabels)) {
      assert.equal(present, true, `Studio mode label is present: ${label}`);
    }
    for (const token of requiredRuntimeTokens) {
      assert(corpus.includes(token), `runtime corpus contains ${token}`);
    }

    assertNoForbiddenRequests(requests);
    return {
      skipped: false,
      managed,
      baseUrl,
      home: pages.home.status,
      login: pages.login.status,
      adminProviders: pages.adminProviders.status,
      health: pages.health.status,
      library: pages.library.status,
      previewRoutes: routeStatuses,
      modeLabels,
      assetsChecked: assetUrls.length,
      no500: true,
      noReactRuntimeError: true,
      noHydrationCrash: true,
      noChunkLoadError: true,
      generationEndpointsCalled: false,
      newApiCalled: false,
    };
  });
}

async function runJsonFetchBehaviorTests() {
  const api = await import("../src/lib/client/api.ts");
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, "/ok");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    return new Response(JSON.stringify({ ok: true, value: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    assert.deepEqual(await api.fetchJson("/ok"), { ok: true, value: 42 });
  });

  await withMockFetch(async () => new Response(JSON.stringify({
    code: "quota_blocked",
    message: "Quota blocked",
    uiState: "blocked",
    retryAfterSeconds: 15,
  }), {
    status: 429,
    headers: { "content-type": "application/json" },
  }), async () => {
    await assert.rejects(
      () => api.fetchJson("/json-error"),
      (error) => error instanceof api.ApiError
        && error.status === 429
        && error.code === "quota_blocked"
        && error.uiState === "blocked"
        && error.retryAfterSeconds === 15
        && error.message === "Quota blocked",
    );
  });

  await withMockFetch(async () => new Response("plain backend error", { status: 500 }), async () => {
    await assert.rejects(
      () => api.fetchJson("/text-error"),
      (error) => error instanceof api.ApiError
        && error.status === 500
        && error.message === "plain backend error",
    );
  });

  await withMockFetch(async () => new Response(null, { status: 204 }), async () => {
    assert.equal(await api.fetchJson("/empty"), "");
  });

  await withMockFetch(async () => {
    throw new Error("network unavailable");
  }, async () => {
    await assert.rejects(
      () => api.fetchJson("/network"),
      (error) => error instanceof Error && error.message === "network unavailable",
    );
  });
}

async function withMockFetch(fetchImpl, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
