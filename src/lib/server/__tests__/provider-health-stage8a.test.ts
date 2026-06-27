import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkProviderHealth } from "../provider-health";
import { sanitizeProvider } from "../providers";
import { type ProviderConfig } from "../types";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "stage8a-image",
    kind: "image",
    title: "图片生成",
    role: "图片生成与图片编辑",
    apiUrl: "https://provider.example.test/v1/images/generations",
    model: "gpt-image-2",
    apiKey: "stage8a-provider-secret-key",
    enabled: true,
    endpointType: "images-generations",
    custom: false,
    ...overrides,
  };
}

function assertNoSecretLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    "stage8a-provider-secret-key",
    "stage8a-newapi-admin-token",
    "stage8a-admin-password",
    "postgresql://stage8a:secret@127.0.0.1:5432/app",
    "Authorization=Bearer",
    "Cookie=session",
  ]) {
    assert.equal(serialized.includes(secret), false, `secret leaked: ${secret}`);
  }
}

test("Stage 8A provider health report exposes only read-only model health fields", async () => {
  process.env.NEW_API_ENABLED = "1";
  process.env.NEW_API_BASE_URL = "https://new-api.example.test";
  process.env.NEW_API_ADMIN_ACCESS_TOKEN = "stage8a-newapi-admin-token";
  process.env.NEW_API_ADMIN_USER_ID = "1";

  const report = await checkProviderHealth({
    mode: "static",
    now: new Date("2026-06-27T00:00:00.000Z"),
    providers: [
      provider(),
      provider({
        id: "stage8a-video",
        kind: "video",
        title: "视频生成",
        role: "视频生成",
        endpointType: "videos-generations",
        apiUrl: "https://provider.example.test/v1/videos/generations",
        model: "",
      }),
      provider({
        id: "stage8a-image-upscale",
        kind: "image-upscale",
        title: "图片高清",
        role: "图片高清",
        endpointType: "volcengine-imagex-upscale",
        apiUrl: "https://imagex.volcengineapi.com",
        model: "imagex-service-id",
      }),
    ],
  });

  assert.equal(report.liveGenerationEnabled, false);
  assert.equal(report.newApi.configured, true);
  assert.equal(report.newApi.adminConfigured, true);
  assert.equal(report.newApi.reachable, "skipped");
  assert.equal(report.modelHealth.image.configured, 1);
  assert.equal(report.modelHealth.imageEdit.configured, 1);
  assert.equal(report.modelHealth.video.missing, 1);
  assert.equal(report.modelHealth.imageUpscale.configured, 1);

  const image = report.providers.find((item) => item.providerId === "stage8a-image");
  assert(image);
  assert.equal(image.configured, true);
  assert.equal(image.authConfigured, true);
  assert.equal(image.modelsConfigured, true);
  assert.deepEqual(image.supportedTools, ["image", "image-edit"]);
  assert.equal(image.reachable, "unchecked");
  assert.equal(image.apiKey.masked.includes("stage8a-provider-secret-key"), false);
  assert.equal(image.apiKey.masked.startsWith("sta"), false);

  const video = report.providers.find((item) => item.providerId === "stage8a-video");
  assert(video);
  assert.equal(video.configured, false);
  assert.equal(video.modelsConfigured, false);
  assert.equal(video.errors.some((issue) => issue.code === "MODEL_MISSING_VIDEO"), true);
  assertNoSecretLeak(report);
});

test("Stage 8A configured flags match public provider sanitization without exposing apiKey", () => {
  const publicConfigured = sanitizeProvider(provider());
  assert.equal(publicConfigured.configured, true);
  assert.equal("apiKey" in publicConfigured, false);
  assert.equal(publicConfigured.keyPreview.includes("stage8a-provider-secret-key"), false);

  const publicDisabled = sanitizeProvider(provider({ enabled: false }));
  assert.equal(publicDisabled.configured, false);

  const publicMissingKey = sanitizeProvider(provider({ apiKey: "" }));
  assert.equal(publicMissingKey.configured, false);
});

test("Stage 8A model health skips external provider model-list calls by default", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("external provider fetch should not be called by default");
  };

  const report = await checkProviderHealth({
    mode: "models",
    fetchImpl,
    providers: [provider()],
  });

  assert.equal(report.providers[0]?.models.image.available, "unknown");
  assert.equal(report.providers[0]?.reachable, "skipped");
  assert.equal(report.providers[0]?.warnings.some((issue) => issue.code === "MODEL_LIST_SKIPPED"), true);
  assertNoSecretLeak(report);
});

test("Stage 8A explicitly authorized model list check only reads /models and never sends generation payloads", async () => {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({
      method: String(init?.method || "GET"),
      url: String(url),
      body: String(init?.body || ""),
    });
    return new Response(JSON.stringify({ data: [{ id: "gpt-image-2" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const report = await checkProviderHealth({
    mode: "models",
    allowExternalProviderModelList: true,
    fetchImpl,
    providers: [provider()],
  });

  assert.equal(report.providers[0]?.models.image.available, "yes");
  assert.equal(report.providers[0]?.reachable, "reachable");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(new URL(requests[0]?.url || "").pathname, "/v1/models");
  assert.equal(/prompt|data:image|multipart|generations|edits|videos/i.test(requests[0]?.body || ""), false);
});

test("Stage 8A admin routes and page keep admin gate and read-only contracts", () => {
  const providerRoute = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "provider-health", "route.ts"), "utf8");
  const modelRoute = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "models", "health", "route.ts"), "utf8");
  const page = readFileSync(join(process.cwd(), "src", "app", "admin", "providers", "page.tsx"), "utf8");
  const client = readFileSync(join(process.cwd(), "src", "components", "admin-providers-client.tsx"), "utf8");

  for (const source of [providerRoute, modelRoute]) {
    assert(source.includes("adminResponse"));
    assert(source.includes("readProviders"));
    assert(source.includes("checkProviderHealth"));
    assert.equal(source.includes("updateProviders"), false);
    assert.equal(source.includes("/api/generate/"), false);
    assert.equal(source.includes("/api/upscale/"), false);
  }

  assert(page.includes("session.user.role === \"admin\""));
  assert(page.includes("redirect(\"/?preview=1\")"));
  assert(client.includes("data-stage4-provider-health"));
  assert(client.includes("NewAPI"));
  assert(client.includes("模型可用性"));
  assert(client.includes("不会提交图片、视频或高清生成任务"));
  assert.equal(client.includes("/api/generate/"), false);
  assert.equal(client.includes("/api/upscale/image"), false);
  assert.equal(client.includes("/api/upscale/video"), false);
});
