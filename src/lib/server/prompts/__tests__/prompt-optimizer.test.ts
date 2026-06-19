import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";

import { NewApiHttpClient } from "../../integrations/new-api/client";
import { NewApiError } from "../../integrations/new-api/errors";
import {
  createNewApiPromptModelCaller,
  createPromptOptimizeService,
  type PromptModelCall,
  type PromptModelCaller,
  type PromptOptimizeInput,
} from "../optimizer";

type Handler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

const handlers = new Map<string, Handler>();
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const handler = handlers.get(`${request.method || "GET"} ${url.pathname}`);
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

function baseInput(input: Partial<PromptOptimizeInput> = {}): PromptOptimizeInput {
  return {
    tool: "image-generator",
    prompt: "商品主图，突出真丝睡衣质感",
    hasImage: false,
    aspectRatio: "1:1",
    quality: "high",
    targetPlatform: "TikTok Shop",
    ...input,
  };
}

function serviceWith(caller: PromptModelCaller) {
  return createPromptOptimizeService({
    caller,
    maxInputChars: 80,
    timeoutMs: 25,
  });
}

test("optimizes common ecommerce image prompt scenarios", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    return `Professional ecommerce visual prompt for ${seen.length}`;
  });

  const cases: Array<Partial<PromptOptimizeInput>> = [
    { prompt: "商品主图，突出真丝睡衣质感" },
    { prompt: "纯白背景，保留原商品颜色" },
    { prompt: "抠图，透明背景，边缘干净" },
    { tool: "image-editor", hasImage: true, prompt: "图片文字翻译成英文，其他不变" },
    { prompt: "商品场景图，厨房台面自然光" },
    { prompt: "促销海报，突出限时折扣但不要新增品牌" },
  ];

  for (const item of cases) {
    const result = await service.optimize(baseInput(item), { localUserId: "user-1", requestId: "req-1" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.optimizedPrompt, /^Professional ecommerce visual prompt/);
      assert.equal(result.billingPolicy, "deferred");
    }
  }

  assert.equal(seen.length, cases.length);
  assert(seen.every((call) => call.systemPrompt.includes("只输出最终提示词")));
  assert(seen.every((call) => call.systemPrompt.includes("保留商品真实外观")));
  assert(seen.every((call) => call.userPrompt.includes("TikTok Shop")));
  assert(seen.some((call) => call.userPrompt.includes("图片编辑")));
  assert(seen.some((call) => call.userPrompt.includes("保留项与修改项")));
});

test("rejects empty and overlong prompt input before calling model", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls += 1;
    return "should not run";
  });

  const empty = await service.optimize(baseInput({ prompt: "   " }), { localUserId: "user-1" });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "invalid_request");

  const long = await service.optimize(baseInput({ prompt: "x".repeat(81) }), { localUserId: "user-1" });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.code, "invalid_request");

  assert.equal(calls, 0);
});

test("maps model timeout and provider failure to safe errors", async () => {
  const timeoutError = new Error("secret timeout");
  timeoutError.name = "AbortError";
  const timeout = await serviceWith(async () => {
    throw timeoutError;
  }).optimize(baseInput(), { localUserId: "user-1", requestId: "req-timeout" });
  assert.equal(timeout.ok, false);
  if (!timeout.ok) {
    assert.equal(timeout.code, "optimizer_timeout");
    assert.equal(JSON.stringify(timeout).includes("secret timeout"), false);
  }

  const provider = await serviceWith(async () => {
    throw new NewApiError({
      code: "NEW_API_UPSTREAM_ERROR",
      message: "upstream leaked sk-test-secret",
      status: 502,
      retryable: true,
      requestId: "req-provider",
      upstreamStatus: 500,
    });
  }).optimize(baseInput(), { localUserId: "user-1", requestId: "req-provider" });
  assert.equal(provider.ok, false);
  if (!provider.ok) {
    assert.equal(provider.code, "optimizer_failed");
    assert.equal(provider.retryable, true);
    assert.equal(JSON.stringify(provider).includes("sk-test-secret"), false);
  }
});

test("returns only optimized prompt text and redacts secret-shaped output", async () => {
  const service = serviceWith(async () => "```markdown\n最终提示词：Use clean lighting sk-test-secret-value\n```");
  const result = await service.optimize(baseInput(), { localUserId: "user-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.optimizedPrompt.includes("```"), false);
  assert.equal(result.optimizedPrompt.includes("最终提示词"), false);
  assert.equal(result.optimizedPrompt.includes("sk-test-secret-value"), false);
  assert.equal(result.optimizedPrompt.includes("[REDACTED]"), true);
});

test("New API caller uses chat completions without exposing admin credentials", async () => {
  handlers.set("POST /v1/chat/completions", async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer admin-secret");
    assert.equal(request.headers["new-api-user"], "1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.model, "prompt-test-model");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    json(response, 200, {
      choices: [
        { message: { content: "Optimized prompt from New API" } },
      ],
    });
  });

  const previousModel = process.env.PROMPT_OPTIMIZER_MODEL;
  process.env.PROMPT_OPTIMIZER_MODEL = "prompt-test-model";
  try {
    const caller = createNewApiPromptModelCaller(new NewApiHttpClient({
      enabled: true,
      baseUrl,
      timeoutMs: 500,
      maxResponseBytes: 65536,
      environment: "test",
      adminAccessToken: "admin-secret",
      adminUserId: 1,
    }));
    const output = await caller({
      systemPrompt: "system",
      userPrompt: "user",
      requestId: "req-new-api",
      timeoutMs: 500,
    });
    assert.equal(output, "Optimized prompt from New API");
  } finally {
    if (previousModel === undefined) delete process.env.PROMPT_OPTIMIZER_MODEL;
    else process.env.PROMPT_OPTIMIZER_MODEL = previousModel;
  }
});
