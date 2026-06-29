#!/usr/bin/env node
import {
  assertNoForbiddenRequests,
  assertNoHtmlErrors,
  extractScriptUrls,
  fetchTracked,
  studioModeRoutes,
  withStudioTestTarget,
} from "./studio-ui-test-utils.mjs";

const modeLabels = studioModeRoutes.map((route) => route.label);

const result = await withStudioTestTarget(async ({ baseUrl }) => {
  const requests = [];
  const home = await fetchTracked(requests, baseUrl, "/");
  const login = await fetchTracked(requests, baseUrl, "/login");
  const adminProviders = await fetchTracked(requests, baseUrl, "/admin/providers", { redirect: "manual" });
  const health = await fetchTracked(requests, baseUrl, "/api/health/backend");
  const library = await fetchTracked(requests, baseUrl, "/api/library");

  if (home.status !== 200) throw new Error(`home returned ${home.status}`);
  if (login.status !== 200) throw new Error(`login returned ${login.status}`);
  if (![200, 302, 303, 307, 308, 401, 403].includes(adminProviders.status)) {
    throw new Error(`admin/providers returned unexpected status ${adminProviders.status}`);
  }
  if (health.status !== 200) throw new Error(`health returned ${health.status}`);
  if (library.status !== 401) throw new Error(`unauthenticated /api/library must return 401, got ${library.status}`);

  for (const [name, response] of [
    ["home", home],
    ["login", login],
    ["admin/providers", adminProviders],
    ["health", health],
    ["library", library],
  ]) {
    if (response.status >= 500) throw new Error(`${name} returned ${response.status}`);
  }

  assertNoHtmlErrors("home", home.text);
  assertNoHtmlErrors("login", login.text);

  const assetUrls = extractScriptUrls(home.text, baseUrl);
  const assetBodies = [];
  for (const assetUrl of assetUrls) {
    const asset = await fetchTracked(requests, baseUrl, assetUrl);
    if (asset.status !== 200) throw new Error(`asset returned ${asset.status}: ${assetUrl}`);
    assetBodies.push(asset.text);
  }

  const labelCorpus = [home.text, ...assetBodies].join("\n");
  const modeResults = Object.fromEntries(modeLabels.map((label) => [label, labelCorpus.includes(label)]));
  const missingModes = modeLabels.filter((label) => !modeResults[label]);
  if (missingModes.length) {
    throw new Error(`missing Studio mode labels: ${missingModes.join(", ")}`);
  }

  const modeRouteResults = {};
  for (const modeRoute of studioModeRoutes) {
    const response = await fetchTracked(requests, baseUrl, `/?preview=1&tool=${modeRoute.tool}`);
    if (response.status !== 200) {
      throw new Error(`preview route for ${modeRoute.tool} returned ${response.status}`);
    }
    assertNoHtmlErrors(`preview route ${modeRoute.tool}`, response.text);
    modeRouteResults[modeRoute.label] = response.status;
  }

  assertNoForbiddenRequests(requests);

  return {
    baseUrl,
    home: home.status,
    login: login.status,
    adminProviders: adminProviders.status,
    health: health.status,
    library: library.status,
    modes: modeResults,
    modeRoutes: modeRouteResults,
    assetsChecked: assetUrls.length,
    consoleErrors: "checked by HTML runtime markers",
    generationEndpointsCalled: false,
    newApiCalled: false,
    dataStagingChanged: false,
    uploadsStagingChanged: false,
  };
});

console.log(JSON.stringify(result, null, 2));
