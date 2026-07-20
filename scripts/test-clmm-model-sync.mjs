#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractModelNames,
  isTargetClmmSeedanceModel,
  runSync,
  selectClmmModels,
  syncProviderDocument,
} from "./ops/sync-clmm-seedance-models.mjs";

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
    ]);
    await writeFile(providerPath, JSON.stringify(result.document));
    const saved = JSON.parse(await readFile(providerPath, "utf8"));
    assert.equal(saved[0].apiKey, "other-secret");
    assert.equal(saved[1].apiKey, "secret-that-must-not-print");
    assert.deepEqual(saved[1].enabledModels, result.selection.models);
    assert.equal(saved[1].modelDisplayNames["bb-seedance2.0 720p-fast-gz-15s"], "Fast 15 秒 不卡真人");
    assert.equal(saved[1].modelDisplayNames["oe-seedance-2.0-pro-720p-14s-gz"], "Pro 14 秒 不卡真人");
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
