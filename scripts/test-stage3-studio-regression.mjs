#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertNoForbiddenRequests,
  assertNoHtmlErrors,
  extractScriptUrls,
  fetchTracked,
  studioModeRoutes,
  withStudioTestTarget,
} from "./studio-ui-test-utils.mjs";

const root = process.cwd();
const requiredRuntimeTokens = [
  "reference-image-input",
  "studio-error-text",
  "studio-preview",
  "studio-primary-action",
  "studio-secondary-button",
];

const lazyPanelSourceTokens = [
  ["src/components/studio/video-generator.tsx", "video-first-frame-input"],
  ["src/components/studio/upscale-form.tsx", "image-upscale-input"],
  ["src/components/studio/upscale-form.tsx", "video-upscale-input"],
  ["src/components/studio/library-view.tsx", "library-search"],
  ["src/components/studio/library-view.tsx", "studio-library-confirm"],
  ["src/components/studio/library-view.tsx", "studio-danger-button"],
];

const allowedAdminStatuses = [200, 302, 303, 307, 308, 401, 403];

await runJsonFetchBehaviorTests();
await runImageGenerationQueueTests();
runImageGenerationSourceChecks();

const skipRuntime = process.env.STUDIO_TEST_SKIP_RUNTIME === "1" || process.argv.includes("--skip-runtime");
let runtimeResult = { skipped: true, reason: "STUDIO_TEST_SKIP_RUNTIME=1 or --skip-runtime" };
if (!skipRuntime) {
  runtimeResult = await runRuntimeRegressionChecks();
}

console.log(JSON.stringify({
  jsonFetchBehavior: "passed",
  imageGenerationQueue: "passed",
  imageGenerationSourceChecks: "passed",
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
    for (const [file, token] of lazyPanelSourceTokens) {
      assert(readFileSync(join(root, file), "utf8").includes(token), `lazy panel source contains ${token}`);
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

  api.resetCsrfTokenForTests();
  let csrfRequests = 0;
  const csrfHeaders = [];
  await withMockFetch(async (url, options = {}) => {
    if (url === "/api/auth/csrf") {
      csrfRequests += 1;
      return new Response(JSON.stringify({ ok: true, csrfToken: "shared-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    csrfHeaders.push(new Headers(options.headers).get("x-csrf-token"));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    await Promise.all(Array.from({ length: 4 }, () => api.fetchJsonWithCsrf("/write", { method: "POST", body: "{}" })));
  });
  assert.equal(csrfRequests, 1, "concurrent writes share one CSRF token request");
  assert.deepEqual(csrfHeaders, ["shared-token", "shared-token", "shared-token", "shared-token"]);

  api.resetCsrfTokenForTests();
  let refreshRequests = 0;
  let writeRequests = 0;
  await withMockFetch(async (url, options = {}) => {
    if (url === "/api/auth/csrf") {
      refreshRequests += 1;
      return new Response(JSON.stringify({ ok: true, csrfToken: `token-${refreshRequests}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    writeRequests += 1;
    const token = new Headers(options.headers).get("x-csrf-token");
    return new Response(JSON.stringify(token === "token-1"
      ? { code: "AUTH_CSRF_REQUIRED", message: "CSRF token is required." }
      : { ok: true }), {
      status: token === "token-1" ? 403 : 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    assert.deepEqual(await api.fetchJsonWithCsrf("/write", { method: "POST", body: "{}" }), { ok: true });
  });
  assert.equal(refreshRequests, 2, "a stale CSRF token is refreshed once");
  assert.equal(writeRequests, 2, "the write is retried once after a CSRF rejection");
}

async function runImageGenerationQueueTests() {
  const { createTaskRunner } = await import("../src/lib/task-runner.ts");
  const runWithSlot = createTaskRunner(4);
  let active = 0;
  let maximumActive = 0;
  const tasks = Array.from({ length: 12 }, (_, index) => runWithSlot(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
    return index;
  }));

  assert.deepEqual(await Promise.all(tasks), Array.from({ length: 12 }, (_, index) => index));
  assert.equal(maximumActive, 4, "all submissions finish through the four-slot execution pool");
}

function runImageGenerationSourceChecks() {
  const studioSource = readFileSync(join(root, "src/components/studio-app.tsx"), "utf8");
  const previewSource = readFileSync(join(root, "src/components/studio/result-preview.tsx"), "utf8");
  const imageRouteSource = readFileSync(join(root, "src/app/api/generate/image/route.ts"), "utf8");
  const stylesSource = readFileSync(join(root, "src/app/globals.css"), "utf8");

  assert(studioSource.includes("activeImageWorkspaceScope === \"image-editor\" && activeImageInFlightCountRef.current >= 1"));
  assert(studioSource.includes("runImageGenerationWithSlot(async () =>"));
  assert(studioSource.includes("progress.total - progress.current"));
  assert(studioSource.includes("if (recoveredItems.length) return publishItems(recoveredItems)"));
  assert(studioSource.includes('scope: "video"'));
  assert(studioSource.includes("handleVideoResult(currentItem, itemBackedJob)"));
  assert(studioSource.includes('updateVideoGenerationProgress("failed", "生成失败")'));
  assert(previewSource.includes("window.setTimeout(() => setLeaving(true), 3200)"));
  assert(previewSource.includes(".slice(0, 3)"));
  assert(previewSource.includes('const isVideo = item.scope === "video"'));
  assert(studioSource.includes("itemBackedJob.progress"));
  assert(studioSource.includes("data.job?.progress"));
  assert(studioSource.includes('snapshot.providerId.startsWith("video-main::model::")'));
  assert(studioSource.includes("await refreshLibraryAfterMutation().catch(() => undefined)"));
  assert(studioSource.includes("await refreshAccountAfterGeneration().catch(() => undefined)"));
  assert(previewSource.includes("Math.max(current, providerRatio) + 0.001"));
  assert(previewSource.includes("const ceiling = providerRatio >= 0.85 ? 0.98 : 0.84"));
  assert(previewSource.includes("isVideo && providerProgressRatio !== null"));
  assert(stylesSource.includes(".studio-upload-item .studio-icon-button {\n    position: absolute;\n    top: 4px;\n    right: 4px;"));
  assert(stylesSource.includes(".studio-video-frame-slot__remove {\n    position: absolute;\n    top: 8px;\n    right: 8px;"));
  assert(imageRouteSource.includes("if (error instanceof WorkloadLimitError) await failBeforeSubmit(error)"));
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
