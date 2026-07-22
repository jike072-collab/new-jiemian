#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  extractModelNames,
  extractPricingEntries,
  isMainModule,
  isTargetClmmSeedanceModel,
  runSync,
  selectClmmModels,
  syncProviderDocument,
} from "./ops/sync-clmm-seedance-models.mjs";

test("recognizes execution through the current release symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "clmm-model-sync-entry-"));
  try {
    const scriptUrl = new URL("./ops/sync-clmm-seedance-models.mjs", import.meta.url);
    const linkedScript = join(root, "sync-clmm-seedance-models.mjs");
    try {
      await symlink(fileURLToPath(scriptUrl), linkedScript, "file");
    } catch (error) {
      if (error?.code === "EPERM") {
        context.skip("file symlinks are unavailable in this environment");
        return;
      }
      throw error;
    }
    assert.equal(isMainModule(scriptUrl.href, linkedScript), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filters only Seedance 2.0 720p or 1080p models", () => {
  assert.equal(isTargetClmmSeedanceModel("bb-seedance2.0 720p-fast-gz-15s"), true);
  assert.equal(isTargetClmmSeedanceModel("bb-seedance2.0 1080p-pro-gz-15s"), true);
  assert.equal(isTargetClmmSeedanceModel("mg-seedance2.0 -480p fast"), false);
  assert.equal(isTargetClmmSeedanceModel("seedance2.0 720p-dark"), false);
  assert.equal(isTargetClmmSeedanceModel("mg-seedance 720-gz-fast-15s"), false);
});

test("extracts common upstream model response shapes", () => {
  assert.deepEqual(extractModelNames({ data: [{ id: "a" }, { model: "b" }, "c"] }), ["a", "b", "c"]);
  assert.deepEqual(extractModelNames({ models: ["a", { name: "b" }] }), ["a", "b"]);
});

test("extracts CLMM video prices with request and second units", () => {
  assert.deepEqual(extractPricingEntries({ data: [
    { model_name: "mg-seedance2.0 -1080p", model_price: 0.368, description: "按秒计费", supported_endpoint_types: ["openai-video"] },
    { model_name: "mg-seedance2.0 -720p-gz-15s", model_price: 2.48, description: "固定价格", supported_endpoint_types: ["openai-video"] },
    { model_name: "gpt-5.6-sol", model_price: 1, supported_endpoint_types: ["openai"] },
  ] }), [
    { model: "mg-seedance2.0 -1080p", amount: 0.368, currency: "CNY", unit: "second" },
    { model: "mg-seedance2.0 -720p-gz-15s", amount: 2.48, currency: "CNY", unit: "request" },
  ]);
});

test("adds new models and removes retired models, including the old 933 entry", () => {
  const selection = selectClmmModels([
    "bb-seedance2.0 720p-fast-gz-15s",
    "oe-seedance-2.0-pro-720p-14s",
    "mg-seedance2.0 -480p",
  ], ["old-seedance2.0 720p-pro", "seedance2.0 720p-933-pro-gz-15s"]);
  assert.deepEqual(selection.models, [
    "bb-seedance2.0 720p-fast-gz-15s",
    "oe-seedance-2.0-pro-720p-14s",
  ]);
  assert.deepEqual(selection.added, ["bb-seedance2.0 720p-fast-gz-15s", "oe-seedance-2.0-pro-720p-14s"]);
  assert.deepEqual(selection.removed, ["old-seedance2.0 720p-pro", "seedance2.0 720p-933-pro-gz-15s"]);
});

test("does not add target models whose pricing tier cannot be identified", () => {
  const selection = selectClmmModels(["seedance2.0 720p-experimental"]);
  assert.deepEqual(selection.models, []);
  assert.deepEqual(selection.unpricedModels, ["seedance2.0 720p-experimental"]);
});

test("adds structurally ambiguous target models when the upstream pricing catalog confirms them", () => {
  const pricing = extractPricingEntries({ data: [
    { model_name: "mg-seedance2.0 -1080p", model_price: 0.368, description: "按秒计费", supported_endpoint_types: ["openai-video"] },
    { model_name: "mg-seedance2.0 -720p-gz-15s", model_price: 2.48, description: "固定价格", supported_endpoint_types: ["openai-video"] },
  ] });
  const selection = selectClmmModels([
    "mg-seedance2.0 -1080p",
    "mg-seedance2.0 -720p-gz-15s",
  ], [], pricing);
  assert.deepEqual(selection.models, [
    "mg-seedance2.0 -1080p",
    "mg-seedance2.0 -720p-gz-15s",
  ]);
  assert.deepEqual(selection.unpricedModels, []);
});

test("updates only the CLMM provider document and keeps its key unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "clmm-model-sync-"));
  try {
    const providerPath = join(root, "providers.json");
    const document = [{ id: "other", apiKey: "other-secret" }, {
      id: "video-seedance-new",
      apiKey: "secret-that-must-not-print",
      apiUrl: "https://clmm-mall.top/v1/videos",
      model: "old-seedance2.0 720p-fast",
      models: ["old-seedance2.0 720p-fast"],
      enabledModels: ["old-seedance2.0 720p-fast"],
    }];
    const result = syncProviderDocument(document, [
      "bb-seedance2.0 720p-fast-gz-15s",
      "oe-seedance-2.0-pro-720p-14s-gz",
    ], [
      { model: "bb-seedance2.0 720p-fast-gz-15s", amount: 3.78, currency: "CNY", unit: "request" },
      { model: "oe-seedance-2.0-pro-720p-14s-gz", amount: 4.68, currency: "CNY", unit: "request" },
    ]);
    await writeFile(providerPath, JSON.stringify(result.document));
    const saved = JSON.parse(await readFile(providerPath, "utf8"));
    assert.equal(saved[0].apiKey, "other-secret");
    assert.equal(saved[1].apiKey, "secret-that-must-not-print");
    assert.deepEqual(saved[1].enabledModels, result.selection.models);
    assert.equal(saved[1].modelDisplayNames["bb-seedance2.0 720p-fast-gz-15s"], "Fast 15 秒");
    assert.equal(saved[1].modelDisplayNames["oe-seedance-2.0-pro-720p-14s-gz"], "Pro 14 秒");
    assert.deepEqual(saved[1].modelUpstreamPrices["bb-seedance2.0 720p-fast-gz-15s"], { amount: 3.78, currency: "CNY", unit: "request" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upstream failure does not write providers.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "clmm-model-sync-failure-"));
  try {
    const providerPath = join(root, "providers.json");
    const document = [{
      id: "video-seedance-new",
      apiKey: "secret-that-must-not-print",
      apiUrl: "https://clmm-mall.top/v1/videos",
      model: "seedance2.0 720p-933-pro-gz-15s",
      models: ["seedance2.0 720p-933-pro-gz-15s"],
      enabledModels: ["seedance2.0 720p-933-pro-gz-15s"],
    }];
    await writeFile(providerPath, `${JSON.stringify(document)}\n`);
    const before = await readFile(providerPath, "utf8");
    await assert.rejects(() => runSync({
      providerPath,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }), /HTTP 503/);
    assert.equal(await readFile(providerPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
