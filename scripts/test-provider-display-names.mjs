#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const outDir = join(root, "dist", "provider-display-name-tests");
const fixtureRoot = join(root, ".runtime", "provider-display-name-tests");
const dataDir = join(fixtureRoot, "data");
const uploadsDir = join(fixtureRoot, "uploads");
const providerStore = join(dataDir, "providers.json");

for (const key of [
  "IMAGE_MODEL_API_KEY",
  "IMG2_IMAGE_API_KEY",
  "VIDEO_MODEL_API_KEY",
  "GROK_VIDEO_API_KEY",
  "PROMPT_OPTIMIZER_API_KEY",
  "DEEPSEEK_API_KEY",
  "VOLCENGINE_ACCESS_KEY_PAIR",
  "VOLCENGINE_ACCESS_KEY_ID",
  "VOLCENGINE_SECRET_ACCESS_KEY",
]) {
  process.env[key] = "";
}
process.env.DATA_DIR = dataDir;
process.env.UPLOADS_DIR = uploadsDir;

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
if (existsSync(fixtureRoot)) {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.provider-display-name-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const providersModule = await import("../dist/provider-display-name-tests/src/lib/server/providers.js");

async function writeProviders(value) {
  await mkdir(dirname(providerStore), { recursive: true });
  await writeFile(providerStore, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertProviderDisplayNamesRoundTrip() {
  const saved = await providersModule.updateProviders([
    {
      id: "image-main",
      apiUrl: "https://example.test/v1/images/generations",
      model: "image-model-raw",
      models: ["image-model-raw"],
      enabledModels: ["image-model-raw"],
      displayName: "Image display model",
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
      displayName: "Seedance video model",
      endpointType: "videos-generations",
      enabled: true,
      apiKey: "provider-test-key",
    },
  ]);

  assert.equal(saved.find((provider) => provider.id === "image-main")?.displayName, "Image display model");
  assert.equal(saved.find((provider) => provider.id === "video-main")?.displayName, "Seedance video model");

  const reread = await providersModule.readPublicProviders();
  const imageAdmin = reread.find((provider) => provider.id === "image-main");
  assert.equal(imageAdmin?.model, "image-model-raw");
  assert.equal(imageAdmin?.displayName, "Image display model");
  assert.equal(imageAdmin?.keyPreview.includes("provider-test-key"), false);

  const enabled = await providersModule.readFrontendProviders("image");
  assert.equal(enabled.length, 1);
  assert.equal("apiKey" in enabled[0], false);
  assert.equal("apiUrl" in enabled[0], false);
  assert.equal("keyPreview" in enabled[0], false);
  assert.equal(enabled[0].model, "image-model-raw");
  assert.equal(enabled[0].displayName, "Image display model");
  assert.deepEqual(enabled[0].capabilities, ["image"]);
  assert.equal(enabled[0].enabled, true);
  assert.equal(enabled[0].endpointType, "images-generations");
  assert.equal(enabled[0].videoOptions, undefined);

  const serialized = JSON.stringify(enabled);
  for (const forbidden of ["apiKey", "provider-test-key", "keyPreview", "apiUrl", root, "ADMIN_PASSWORD"]) {
    assert.equal(serialized.includes(forbidden), false, `frontend provider response leaked ${forbidden}`);
  }
}

async function assertMissingDisplayNameFallsBackToModel() {
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
}

async function assertBlankDisplayNameFallsBackToModel() {
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
}

async function assertStoredVideoProviderExpansion() {
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
}

async function assertLegacyLocalUpscaleMapsAtReadBoundary() {
  await writeProviders([
    ...providersModule.defaultProviders().map((provider) => {
      if (provider.id === "image-upscale") {
        return {
          ...provider,
          endpointType: "upscayl-cli",
          apiUrl: "C:/legacy/upscayl-bin.exe",
          model: "legacy-local-image-model",
          displayName: "Legacy local image upscale",
          apiKey: "legacy-image-secret",
          enabled: true,
        };
      }
      if (provider.id === "video-upscale") {
        return {
          ...provider,
          endpointType: "video2x-cli",
          apiUrl: "C:/legacy/video2x.exe",
          model: "legacy-local-video-model",
          displayName: "Legacy local video upscale",
          apiKey: "legacy-video-secret",
          enabled: true,
        };
      }
      return provider;
    }),
  ]);

  const publicProviders = await providersModule.readPublicProviders();
  const image = publicProviders.find((provider) => provider.id === "image-upscale");
  const video = publicProviders.find((provider) => provider.id === "video-upscale");
  assert.equal(image?.endpointType, "volcengine-imagex-upscale");
  assert.equal(video?.endpointType, "volcengine-vod-upscale");
  assert.equal(image?.apiUrl, "https://imagex.volcengineapi.com");
  assert.equal(video?.apiUrl, "https://vod.volcengineapi.com");
  assert.equal(image?.keyPreview.includes("legacy-image-secret"), false);
  assert.equal(video?.keyPreview.includes("legacy-video-secret"), false);

  const serialized = JSON.stringify(publicProviders);
  for (const legacy of ["upscayl-cli", "video2x-cli", "upscale-placeholder", "legacy-local-image-model", "legacy-local-video-model", "C:/legacy"]) {
    assert.equal(serialized.includes(legacy), false, `legacy upscale value leaked: ${legacy}`);
  }
}

async function assertSavingProvidersWritesOnlyCurrentUpscaleTypes() {
  const saved = await providersModule.updateProviders([
    {
      id: "image-upscale",
      apiUrl: "https://imagex.volcengineapi.com",
      model: "imagex-service-id",
      displayName: "ImageX enhanced",
      endpointType: "upscayl-cli",
      enabled: true,
      apiKey: "imagex-secret",
    },
    {
      id: "video-upscale",
      apiUrl: "https://vod.volcengineapi.com",
      model: "vod-space",
      displayName: "VOD enhanced",
      endpointType: "video2x-cli",
      enabled: true,
      apiKey: "vod-secret",
    },
  ]);

  assert.equal(saved.find((provider) => provider.id === "image-upscale")?.endpointType, "volcengine-imagex-upscale");
  assert.equal(saved.find((provider) => provider.id === "video-upscale")?.endpointType, "volcengine-vod-upscale");

  const raw = await readFile(providerStore, "utf8");
  for (const legacy of ["upscayl-cli", "video2x-cli", "upscale-placeholder"]) {
    assert.equal(raw.includes(legacy), false, `saved providers.json still contains ${legacy}`);
  }
}

async function assertLegacyPlaceholderMapsByKindAndIsNotPersisted() {
  await writeProviders([
    ...providersModule.defaultProviders().map((provider) => {
      if (provider.id === "image-upscale") {
        return {
          ...provider,
          endpointType: "upscale-placeholder",
          apiUrl: "C:/legacy/image-placeholder.exe",
          model: "legacy-image-placeholder",
          enabled: true,
        };
      }
      if (provider.id === "video-upscale") {
        return {
          ...provider,
          endpointType: "upscale-placeholder",
          apiUrl: "C:/legacy/video-placeholder.exe",
          model: "legacy-video-placeholder",
          enabled: true,
        };
      }
      return provider;
    }),
  ]);

  const publicProviders = await providersModule.readPublicProviders();
  assert.equal(publicProviders.find((provider) => provider.id === "image-upscale")?.endpointType, "volcengine-imagex-upscale");
  assert.equal(publicProviders.find((provider) => provider.id === "video-upscale")?.endpointType, "volcengine-vod-upscale");

  await providersModule.updateProviders([
    {
      id: "image-upscale",
      model: "current-imagex-service",
      endpointType: "upscale-placeholder",
      enabled: true,
    },
    {
      id: "video-upscale",
      model: "current-vod-space",
      endpointType: "upscale-placeholder",
      enabled: true,
    },
  ]);

  const raw = await readFile(providerStore, "utf8");
  assert.equal(raw.includes("upscale-placeholder"), false);
  assert.equal(raw.includes("volcengine-imagex-upscale"), true);
  assert.equal(raw.includes("volcengine-vod-upscale"), true);
}

async function assertUnknownEndpointTypesAreRejectedSafely() {
  await assert.rejects(
    () => providersModule.updateProviders([
      {
        id: "image-upscale",
        apiUrl: "https://imagex.volcengineapi.com",
        model: "imagex-service-id",
        displayName: "ImageX enhanced",
        endpointType: "unknown-upscale-provider",
        enabled: true,
        apiKey: "unknown-secret-should-not-leak",
      },
    ]),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Unsupported provider endpoint type/);
      assert.equal(message.includes("unknown-secret-should-not-leak"), false);
      assert.equal(message.includes("https://imagex.volcengineapi.com"), false);
      return true;
    },
  );
}

test("provider display-name persistence and legacy upscale compatibility", async () => {
  await assertProviderDisplayNamesRoundTrip();
  await assertMissingDisplayNameFallsBackToModel();
  await assertBlankDisplayNameFallsBackToModel();
  await assertStoredVideoProviderExpansion();
  await assertLegacyLocalUpscaleMapsAtReadBoundary();
  await assertSavingProvidersWritesOnlyCurrentUpscaleTypes();
  await assertLegacyPlaceholderMapsByKindAndIsNotPersisted();
  await assertUnknownEndpointTypesAreRejectedSafely();
});

test.after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});
