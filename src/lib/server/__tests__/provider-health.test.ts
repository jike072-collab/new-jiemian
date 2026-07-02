import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkProviderHealth } from "../provider-health";
import { type ProviderConfig } from "../types";

type MockRequest = {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
};

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "image-main",
    kind: "image",
    title: "图片生成",
    role: "文生图与图生图/图片编辑",
    apiUrl: "https://provider.example.test/v1/images/generations",
    model: "gpt-image-2",
    apiKey: "stage4-test-provider-key-1234",
    enabled: true,
    endpointType: "images-generations",
    custom: false,
    ...overrides,
  };
}

function issueCodes(report: Awaited<ReturnType<typeof checkProviderHealth>>, providerId = "image-main") {
  return report.providers
    .find((item) => item.id === providerId)
    ?.issues.map((issue) => issue.code) || [];
}

async function withMockServer(
  handler: (request: MockRequest, response: ServerResponse) => void | Promise<void>,
  callback: (baseUrl: string, requests: MockRequest[]) => Promise<void>,
) {
  const requests: MockRequest[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const recorded = {
      method: request.method || "GET",
      url: request.url || "/",
      headers: request.headers,
      body,
    };
    requests.push(recorded);
    await handler(recorded, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function text(response: ServerResponse, status: number, payload: string, contentType = "text/plain") {
  response.writeHead(status, { "content-type": contentType });
  response.end(payload);
}

function assertNoGenerationRequest(requests: MockRequest[]) {
  for (const request of requests) {
    assert.equal(/\/api\/generate\//.test(request.url), false, `generation API was called: ${request.url}`);
    assert.equal(/\/api\/upscale\/(?:image|video)$/.test(request.url), false, `upscale API was called: ${request.url}`);
    assert.equal(/\/images\/(?:generations|edits)/.test(request.url), false, `image generation endpoint was called: ${request.url}`);
    assert.equal(/\/videos\/generations/.test(request.url), false, `video generation endpoint was called: ${request.url}`);
    assert.equal(/prompt/i.test(request.body), false, "prompt was sent to provider health check");
    assert.equal(/data:image|data:video|multipart\/form-data/i.test(request.body), false, "media payload was sent to provider health check");
  }
}

function assertNoSecretLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    "stage4-test-provider-key-1234",
    "volc-ak:volc-sk-secret",
    "APP_DATABASE_URL",
    "ADMIN_PASSWORD",
    "postgresql://",
    "Bearer stage4-test-provider-key-1234",
  ]) {
    assert.equal(serialized.includes(secret), false, `secret leaked: ${secret}`);
  }
}

test("static provider health distinguishes missing config, disabled providers, duplicate ids, trimming, and model kinds", async () => {
  const report = await checkProviderHealth({
    mode: "static",
    now: new Date("2026-06-26T00:00:00.000Z"),
    providers: [
      provider({ id: "missing-endpoint", apiUrl: "", apiKey: "", model: "", title: " " }),
      provider({ id: "invalid-endpoint", apiUrl: "file:///tmp/provider", enabled: false }),
      provider({ id: "duplicate-id", apiUrl: " https://provider.example.test/v1/images/edits ", endpointType: "images-edits", model: "" }),
      provider({ id: "duplicate-id", kind: "video", endpointType: "videos-generations", model: "" }),
      provider({ id: "image-upscale", kind: "image-upscale", endpointType: "volcengine-imagex-upscale", model: "" }),
      provider({ id: "video-upscale", kind: "video-upscale", endpointType: "volcengine-vod-upscale", model: "" }),
      provider({ id: "ok-provider" }),
    ],
  });

  assert.equal(report.mode, "static");
  assert.equal(report.liveGenerationEnabled, false);
  assert.equal(report.summary.total, 7);
  assert(issueCodes(report, "missing-endpoint").includes("PROVIDER_MISSING_ENDPOINT"));
  assert(issueCodes(report, "missing-endpoint").includes("PROVIDER_MISSING_API_KEY"));
  assert(issueCodes(report, "missing-endpoint").includes("MODEL_MISSING_IMAGE"));
  assert(issueCodes(report, "missing-endpoint").includes("MODEL_MISSING_IMAGE_EDIT"));
  assert(issueCodes(report, "invalid-endpoint").includes("PROVIDER_INVALID_ENDPOINT"));
  assert(issueCodes(report, "invalid-endpoint").includes("PROVIDER_DISABLED"));
  assert(issueCodes(report, "duplicate-id").includes("PROVIDER_DUPLICATE_ID"));
  assert(issueCodes(report, "duplicate-id").includes("PROVIDER_TRIMMED_VALUE"));
  assert(issueCodes(report, "duplicate-id").includes("MODEL_MISSING_IMAGE_EDIT"));
  assert(issueCodes(report, "video-upscale").includes("MODEL_MISSING_VIDEO_UPSCALE"));
  assert.equal(report.providers.find((item) => item.id === "ok-provider")?.status, "ok");
  assertNoSecretLeak(report);
});

test("static provider health handles no providers", async () => {
  const report = await checkProviderHealth({ mode: "static", providers: [] });
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { total: 0, ok: 0, warning: 0, error: 0, unknown: 0 });
});

test("connectivity checks use safe HEAD requests and classify HTTP statuses", async () => {
  const statuses = [200, 401, 403, 404, 429, 500];
  await withMockServer((request, response) => {
    const status = Number((request.url.match(/\/s(\d+)/) || [])[1] || 200);
    if (request.method !== "HEAD") {
      text(response, 405, "");
      return;
    }
    response.writeHead(status);
    response.end();
  }, async (baseUrl, requests) => {
    const report = await checkProviderHealth({
      mode: "connectivity",
      timeoutMs: 1000,
      providers: statuses.map((status) => provider({
        id: `s${status}`,
        apiUrl: `${baseUrl}/s${status}/v1/images/generations`,
      })),
    });
    assert.equal(report.providers.find((item) => item.id === "s200")?.status, "ok");
    assert(issueCodes(report, "s401").includes("PROVIDER_AUTH_FAILED"));
    assert(issueCodes(report, "s403").includes("PROVIDER_FORBIDDEN"));
    assert(issueCodes(report, "s404").includes("PROVIDER_BAD_RESPONSE"));
    assert(issueCodes(report, "s429").includes("PROVIDER_RATE_LIMITED"));
    assert(issueCodes(report, "s500").includes("PROVIDER_BAD_RESPONSE"));
    assert(requests.every((request) => request.method === "HEAD"));
    assert(requests.every((request) => request.url.endsWith("/v1/models")));
    assertNoGenerationRequest(requests);
    assertNoSecretLeak(report);
  });
});

test("connectivity checks classify timeouts and network failures without failing the full report", async () => {
  await withMockServer(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    text(response, 200, "");
  }, async (baseUrl) => {
    const timeoutReport = await checkProviderHealth({
      mode: "connectivity",
      timeoutMs: 10,
      providers: [provider({ id: "timeout", apiUrl: `${baseUrl}/slow/v1/images/generations` })],
    });
    assert(issueCodes(timeoutReport, "timeout").includes("PROVIDER_TIMEOUT"));
  });

  const networkReport = await checkProviderHealth({
    mode: "connectivity",
    timeoutMs: 100,
    providers: [provider({ id: "network", apiUrl: "http://127.0.0.1:9/v1/images/generations" })],
  });
  assert(issueCodes(networkReport, "network").includes("PROVIDER_NETWORK_ERROR"));
});

test("model list checks are skipped by default to avoid external provider calls", async () => {
  const report = await checkProviderHealth({
    mode: "models",
    providers: [provider({ id: "image-ok", apiUrl: "https://provider.example.test/v1/images/generations", model: "gpt-image-2" })],
  });
  assert.equal(report.providers.find((item) => item.id === "image-ok")?.reachable, "skipped");
  assert(issueCodes(report, "image-ok").includes("MODEL_LIST_SKIPPED"));
  assertNoSecretLeak(report);
});

test("explicitly authorized model list checks parse safe model ids, detect missing models, and never call generation endpoints", async () => {
  await withMockServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer stage4-test-provider-key-1234");
    json(response, 200, {
      data: [
        { id: "gpt-image-2", object: "model", ignored_secret: "hidden" },
        { id: "video-model" },
      ],
    });
  }, async (baseUrl, requests) => {
    const report = await checkProviderHealth({
      mode: "models",
      allowExternalProviderModelList: true,
      providers: [
        provider({ id: "image-ok", apiUrl: `${baseUrl}/v1/images/generations`, model: "gpt-image-2" }),
        provider({ id: "video-missing", kind: "video", endpointType: "videos-generations", apiUrl: `${baseUrl}/v1/videos/generations`, model: "missing-video" }),
      ],
    });
    assert.equal(report.providers.find((item) => item.id === "image-ok")?.models.image.available, "yes");
    assert.equal(report.providers.find((item) => item.id === "video-missing")?.models.video.available, "no");
    assert(issueCodes(report, "video-missing").includes("MODEL_NOT_FOUND"));
    assert(requests.every((request) => request.method === "GET"));
    assert(requests.every((request) => request.url === "/v1/models"));
    assertNoGenerationRequest(requests);
    assertNoSecretLeak(report);
  });
});

test("model list checks classify empty, malformed, non-json, auth, and timeout responses", async () => {
  await withMockServer(async (request, response) => {
    if (request.url.includes("empty")) return json(response, 200, { data: [] });
    if (request.url.includes("malformed")) return json(response, 200, { data: [{ title: "missing id" }] });
    if (request.url.includes("html")) return text(response, 200, "<html>no</html>", "text/html");
    if (request.url.includes("auth")) return json(response, 401, { error: "bad key" });
    if (request.url.includes("slow")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return json(response, 200, { data: [{ id: "slow-model" }] });
    }
    return json(response, 200, { data: [{ id: "ok" }] });
  }, async (baseUrl) => {
    const report = await checkProviderHealth({
      mode: "models",
      allowExternalProviderModelList: true,
      timeoutMs: 20,
      providers: [
        provider({ id: "empty", apiUrl: `${baseUrl}/empty/v1/images/generations` }),
        provider({ id: "malformed", apiUrl: `${baseUrl}/malformed/v1/images/generations` }),
        provider({ id: "html", apiUrl: `${baseUrl}/html/v1/images/generations` }),
        provider({ id: "auth", apiUrl: `${baseUrl}/auth/v1/images/generations` }),
        provider({ id: "slow", apiUrl: `${baseUrl}/slow/v1/images/generations` }),
      ],
    });
    assert(issueCodes(report, "empty").includes("MODEL_LIST_EMPTY"));
    assert(issueCodes(report, "malformed").includes("PROVIDER_BAD_RESPONSE"));
    assert(issueCodes(report, "html").includes("PROVIDER_NON_JSON_RESPONSE"));
    assert(issueCodes(report, "auth").includes("PROVIDER_AUTH_FAILED"));
    assert(issueCodes(report, "slow").includes("PROVIDER_TIMEOUT"));
    assertNoSecretLeak(report);
  });
});

test("model list checks do not call unsupported provider model endpoints", async () => {
  await withMockServer((_request, response) => {
    json(response, 500, { error: "should not be called" });
  }, async (baseUrl, requests) => {
    const report = await checkProviderHealth({
      mode: "models",
      allowExternalProviderModelList: true,
      providers: [
        provider({
          id: "image-upscale",
          kind: "image-upscale",
          endpointType: "volcengine-imagex-upscale",
          apiUrl: baseUrl,
          model: "imagex-service-id",
        }),
      ],
    });
    assert(issueCodes(report, "image-upscale").includes("MODEL_LIST_UNAVAILABLE"));
    assert.equal(requests.length, 0);
    assertNoSecretLeak(report);
  });
});

test("model list response size is limited", async () => {
  await withMockServer((_request, response) => {
    json(response, 200, { data: [{ id: "x".repeat(2048) }] });
  }, async (baseUrl) => {
    const report = await checkProviderHealth({
      mode: "models",
      allowExternalProviderModelList: true,
      maxResponseBytes: 64,
      providers: [provider({ id: "large", apiUrl: `${baseUrl}/v1/images/generations` })],
    });
    assert(issueCodes(report, "large").includes("PROVIDER_BAD_RESPONSE"));
    assertNoSecretLeak(report);
  });
});

test("live generation checks are blocked by design", async () => {
  await assert.rejects(
    () => checkProviderHealth({ mode: "static", providers: [provider()], allowLiveGeneration: true }),
    /does not support live generation/,
  );
});

test("admin provider health route is protected by the existing admin gate", async () => {
  const { createAdminService } = await import("../admin/service.js");
  const anonymous = createAdminService({
    currentUser: async () => ({
      ok: false,
      status: 401,
      code: "AUTH_SESSION_EXPIRED",
      uiState: "session_expired",
      message: "Session is missing or expired.",
    }),
  });
  const normalUser = createAdminService({
    currentUser: async () => ({
      ok: true,
      status: 200,
      uiState: "success",
      user: {
        local_user_id: "normal-user",
        email: "normal@example.com",
        username: "normal",
        display_name: "Normal",
        status: "active",
        role: "user",
      },
      mappingStatus: null,
      session: null,
      redirectTo: "/",
    }),
  });
  const admin = createAdminService({
    currentUser: async () => ({
      ok: true,
      status: 200,
      uiState: "success",
      user: {
        local_user_id: "admin-user",
        email: "admin@example.com",
        username: "admin",
        display_name: "Admin",
        status: "active",
        role: "admin",
      },
      mappingStatus: null,
      session: null,
      redirectTo: "/",
    }),
  });

  const deniedAnonymous = await anonymous.requireAdmin(null);
  assert.equal(deniedAnonymous.ok, false);
  if (!deniedAnonymous.ok) assert.equal(deniedAnonymous.status, 401);

  const deniedUser = await normalUser.requireAdmin("user-session");
  assert.equal(deniedUser.ok, false);
  if (!deniedUser.ok) assert.equal(deniedUser.status, 403);

  const allowedAdmin = await admin.requireAdmin("admin-session");
  assert.equal(allowedAdmin.ok, true);
});

test("admin provider health frontend contains safe states and no generation call wiring", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "admin-providers-client.tsx"), "utf8");
  assert(source.includes("data-stage4-provider-health"));
  assert(source.includes("静态检测"));
  assert(source.includes("连接检测"));
  assert(source.includes("模型列表检测"));
  assert(source.includes("尚未检测"));
  assert(source.includes("正常"));
  assert(source.includes("警告"));
  assert(source.includes("错误"));
  assert(source.includes("图片生成"));
  assert(source.includes("图片编辑"));
  assert(source.includes("视频生成"));
  assert(source.includes("图片高清增强"));
  assert(source.includes("视频高清增强"));
  assert(source.includes("Loader2"));
  assert(source.includes("/api/admin/provider-health"));
  assert.equal(source.includes("/api/generate/"), false);
  assert.equal(source.includes("/api/upscale/image"), false);
  assert.equal(source.includes("/api/upscale/video"), false);
  assert.equal(source.includes("console."), false);
  assert.equal(source.includes("Authorization"), false);
});
