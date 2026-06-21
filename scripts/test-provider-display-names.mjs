#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const outDir = join(root, "dist", "provider-display-name-tests");
const providerStore = join(root, "data", "providers.json");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.provider-display-name-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const providersModule = await import("../dist/provider-display-name-tests/src/lib/server/providers.js");

const original = await readFile(providerStore, "utf8").catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});

async function writeProviders(value) {
  await mkdir(dirname(providerStore), { recursive: true });
  await writeFile(providerStore, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("provider display names are saved, re-read, and exposed safely to the frontend", async () => {
  const saved = await providersModule.updateProviders([
    {
      id: "image-main",
      apiUrl: "https://example.test/v1/images/generations",
      model: "image-model-raw",
      models: ["image-model-raw"],
      enabledModels: ["image-model-raw"],
      displayName: "极速图片模型",
      endpointType: "images-generations",
      enabled: true,
      apiKey: "provider-test-key",
    },
    {
      id: "video-main",
      apiUrl: "https://example.test/v1/videos/generations",
      model: "seedance-raw-model",
      models: ["seedance-raw-model"],
      enabledModels: ["seedance-raw-model"],
      displayName: "Seedance 视频模型",
      endpointType: "videos-generations",
      enabled: true,
      apiKey: "provider-test-key",
    },
  ]);

  assert.equal(saved.find((provider) => provider.id === "image-main")?.displayName, "极速图片模型");
  assert.equal(saved.find((provider) => provider.id === "video-main")?.displayName, "Seedance 视频模型");

  const reread = await providersModule.readPublicProviders();
  const imageAdmin = reread.find((provider) => provider.id === "image-main");
  assert.equal(imageAdmin?.model, "image-model-raw");
  assert.equal(imageAdmin?.displayName, "极速图片模型");
  assert.equal(imageAdmin?.keyPreview.includes("provider-test-key"), false);

  const enabled = await providersModule.readFrontendProviders("image");
  assert.equal(enabled.length, 1);
  assert.equal("apiKey" in enabled[0], false);
  assert.equal("apiUrl" in enabled[0], false);
  assert.equal("keyPreview" in enabled[0], false);
  assert.equal(enabled[0].model, "image-model-raw");
  assert.equal(enabled[0].displayName, "极速图片模型");
  assert.deepEqual(enabled[0].capabilities, ["image"]);
  assert.equal(enabled[0].enabled, true);
  assert.equal(enabled[0].endpointType, "images-generations");
  assert.equal(enabled[0].videoOptions, undefined);

  const serialized = JSON.stringify(enabled);
  for (const forbidden of ["apiKey", "provider-test-key", "keyPreview", "apiUrl", root, "ADMIN_PASSWORD"]) {
    assert.equal(serialized.includes(forbidden), false, `frontend provider response leaked ${forbidden}`);
  }
});

test("old provider config without displayName falls back to model id", async () => {
  const defaults = providersModule.defaultProviders();
  await writeProviders(defaults.map((provider) => {
    const copy = { ...provider };
    delete copy.displayName;
    if (copy.id === "image-main") {
      copy.apiUrl = "https://example.test/v1/images/generations";
      copy.model = "legacy-image-model";
      copy.apiKey = "legacy-provider-key";
      copy.enabled = true;
    }
    return copy;
  }));

  const publicProviders = await providersModule.readPublicProviders();
  const imageAdmin = publicProviders.find((provider) => provider.id === "image-main");
  assert.equal(imageAdmin?.model, "legacy-image-model");
  assert.equal(imageAdmin?.displayName, "legacy-image-model");

  const enabled = await providersModule.readFrontendProviders("image");
  assert.equal(enabled[0]?.model, "legacy-image-model");
  assert.equal(enabled[0]?.displayName, "legacy-image-model");
});

test("blank display name falls back to the raw model id", async () => {
  await providersModule.updateProviders([
    {
      id: "image-main",
      apiUrl: "https://example.test/v1/images/generations",
      model: "fallback-image-model",
      displayName: "   ",
      endpointType: "images-generations",
      enabled: true,
      apiKey: "provider-test-key",
    },
  ]);

  const enabled = await providersModule.readFrontendProviders("image");
  assert.equal(enabled[0]?.model, "fallback-image-model");
  assert.equal(enabled[0]?.displayName, "fallback-image-model");
});

test("stored non-default video providers are preserved and expanded for frontend models", async () => {
  await writeProviders([
    ...providersModule.defaultProviders(),
    {
      id: "stored-video-extra",
      kind: "video",
      title: "Stored Video",
      role: "Stored video provider",
      apiUrl: "https://example.test/v1/videos/generations",
      model: "extra-model-1",
      models: ["extra-model-1", "extra-model-2"],
      modelDisplayNames: {
        "extra-model-2": "Extra Video Two",
      },
      enabledModels: ["extra-model-2"],
      displayName: "Stored Video",
      apiKey: "extra-provider-key",
      enabled: true,
      endpointType: "videos-generations",
      custom: false,
    },
  ]);

  const enabled = await providersModule.readFrontendProviders("video");
  const extra = enabled.find((provider) => provider.id.includes("stored-video-extra"));
  assert.equal(extra?.id, "stored-video-extra::model::extra-model-2");
  assert.equal(extra?.model, "extra-model-2");
  assert.equal(extra?.displayName, "Extra Video Two");
  assert.equal(extra?.endpointType, "videos-generations");
  assert.deepEqual(extra?.capabilities, ["video"]);

  const serialized = JSON.stringify(enabled);
  assert.equal(serialized.includes("extra-provider-key"), false);
});

test.after(async () => {
  if (original === null) {
    await rm(providerStore, { force: true });
    return;
  }
  await mkdir(dirname(providerStore), { recursive: true });
  await writeFile(providerStore, original, "utf8");
});
