import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";

import { newApiAdminContext, newApiUserContext } from "../auth";
import { NewApiHttpClient } from "../client";
import { getNewApiConfig, normalizeNewApiBaseUrl } from "../config";
import { NewApiError } from "../errors";
import { redactHeaders, redactJson, redactSecret } from "../redaction";
import { adminSetNewApiUserQuota } from "../topup";
import { type NewApiConfig } from "../types";

type Handler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

const handlers = new Map<string, Handler>();
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const handler = handlers.get(`${request.method || "GET"} ${url.pathname}`) || handlers.get(url.pathname);
  if (!handler) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "missing test route" }));
    return;
  }
  await handler(request, response);
});

let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function config(overrides: Partial<NewApiConfig> = {}): NewApiConfig {
  return {
    enabled: true,
    baseUrl,
    timeoutMs: 500,
    maxResponseBytes: 1024,
    environment: "test",
    adminAccessToken: "admin-secret",
    adminUserId: 1,
    ...overrides,
  };
}

function client(overrides: Partial<NewApiConfig> = {}) {
  return new NewApiHttpClient(config(overrides));
}

test("parses normal JSON and sends user auth headers", async () => {
  handlers.set("GET /ok", (request, response) => {
    assert.equal(request.headers.authorization, "Bearer user-secret");
    assert.equal(request.headers["new-api-user"], "7");
    json(response, 200, { success: true });
  });

  const result = await client().request<{ success: boolean }>({
    path: "/ok",
    context: newApiUserContext({ newApiUserId: 7, accessToken: "user-secret" }),
  });

  assert.equal(result.data.success, true);
  assert.equal(result.upstreamStatus, 200);
});

test("sends admin auth only through admin context", async () => {
  handlers.set("GET /admin", (request, response) => {
    assert.equal(request.headers.authorization, "Bearer admin-secret");
    assert.equal(request.headers["new-api-user"], "1");
    json(response, 200, { success: true });
  });

  await client().request({
    path: "/admin",
    context: newApiAdminContext({ newApiUserId: 1, accessToken: "admin-secret" }),
  });

  await assert.rejects(
    () => client().request({ path: "/admin", context: newApiUserContext({ newApiUserId: 0, accessToken: "" }) }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_AUTH_FORBIDDEN",
  );
});

test("rejects invalid JSON", async () => {
  handlers.set("GET /invalid-json", (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{");
  });

  await assert.rejects(
    () => client().request({ path: "/invalid-json", context: { kind: "health" } }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_INVALID_JSON",
  );
});

test("rejects non JSON response", async () => {
  handlers.set("GET /text", (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("hello");
  });

  await assert.rejects(
    () => client().request({ path: "/text", context: { kind: "health" } }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_INVALID_CONTENT_TYPE",
  );
});

test("rejects oversized response", async () => {
  handlers.set("GET /large", (_request, response) => {
    json(response, 200, { value: "x".repeat(2000) });
  });

  await assert.rejects(
    () => client({ maxResponseBytes: 128 }).request({ path: "/large", context: { kind: "health" } }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_RESPONSE_TOO_LARGE",
  );
});

test("maps common upstream statuses", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    handlers.set(`GET /status-${status}`, (_request, response) => {
      json(response, status, { message: `status ${status}`, Authorization: "Bearer test-secret-token" });
    });

    await assert.rejects(
      () => client().request({ path: `/status-${status}`, context: { kind: "health" }, retry: false }),
      (error) => (
        error instanceof NewApiError
        && error.code === "NEW_API_UPSTREAM_ERROR"
        && error.upstreamStatus === status
        && !JSON.stringify(error.safeDetails).includes("test-secret-token")
      ),
    );
  }
});

test("retries GET but not write operations", async () => {
  let getCalls = 0;
  handlers.set("GET /retry-get", (_request, response) => {
    getCalls += 1;
    json(response, getCalls === 1 ? 500 : 200, { success: true, getCalls });
  });

  const getResult = await client().request<{ getCalls: number }>({
    path: "/retry-get",
    context: { kind: "health" },
  });
  assert.equal(getResult.data.getCalls, 2);

  let postCalls = 0;
  handlers.set("POST /retry-post", (_request, response) => {
    postCalls += 1;
    json(response, 500, { success: false });
  });

  await assert.rejects(
    () => client().request({ method: "POST", path: "/retry-post", context: { kind: "health" }, body: { a: 1 } }),
    (error) => error instanceof NewApiError && error.upstreamStatus === 500,
  );
  assert.equal(postCalls, 1);
});

test("sets user quota through the New API manage endpoint", async () => {
  handlers.set("POST /api/user/manage", async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer admin-secret");
    assert.equal(request.headers["new-api-user"], "1");

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.deepEqual(body, {
      id: 2,
      action: "add_quota",
      mode: "override",
      value: 880,
    });
    json(response, 200, { success: true });
  });

  const result = await adminSetNewApiUserQuota({ newApiUserId: 2, quota: 880 }, client());

  assert.equal(result.upstreamStatus, 200);
});

test("handles timeouts and network failures", async () => {
  handlers.set("GET /timeout", async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    json(response, 200, { success: true });
  });

  await assert.rejects(
    () => client({ timeoutMs: 10 }).request({ path: "/timeout", context: { kind: "health" }, retry: false }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_TIMEOUT",
  );

  await assert.rejects(
    () => new NewApiHttpClient(config({ baseUrl: "http://127.0.0.1:1", timeoutMs: 100 }))
      .request({ path: "/network", context: { kind: "health" }, retry: false }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_NETWORK",
  );
});

test("validates configuration", () => {
  assert.equal(normalizeNewApiBaseUrl("http://example.com/"), "http://example.com");
  assert.throws(() => normalizeNewApiBaseUrl("file:///tmp/new-api"), NewApiError);

  const oldEnv = { ...process.env };
  try {
    process.env.NEW_API_ENABLED = "true";
    delete process.env.NEW_API_BASE_URL;
    assert.throws(() => getNewApiConfig("123e4567-e89b-12d3-a456-426614174000"), NewApiError);
  } finally {
    process.env = oldEnv;
  }
});

test("redacts headers, json, and secret-shaped text", () => {
  const redacted = redactSecret("Authorization=Bearer test-secret-token");
  assert.equal(redacted.includes("test-secret-token"), false);
  assert.equal(redacted.includes("[REDACTED]"), true);
  assert.equal(redactSecret("Bearer abc.def"), "Bearer [REDACTED]");
  assert.deepEqual(redactHeaders({ Authorization: "Bearer abc", "X-Test": "ok" }), {
    Authorization: "[REDACTED]",
    "X-Test": "ok",
  });
  assert.deepEqual(redactJson({ token: "abc", nested: { password: "secret" } }), {
    token: "[REDACTED]",
    nested: { password: "[REDACTED]" },
  });
});
