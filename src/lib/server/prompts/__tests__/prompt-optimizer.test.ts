import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";

import { NewApiHttpClient } from "../../integrations/new-api/client";
import { NewApiError } from "../../integrations/new-api/errors";
import { type ProviderConfig } from "../../types";
import {
  builtInPromptPresets,
  emptyPromptPreferences,
  promptPreferenceFields,
} from "../../../prompt-preferences";
import {
  createNewApiPromptModelCaller,
  createProviderPromptModelCaller,
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

test("provides tool-specific defaults and practical task presets", () => {
  assert.equal(new Set(builtInPromptPresets.map((preset) => preset.id)).size, builtInPromptPresets.length);
  for (const [tool, fields] of Object.entries(promptPreferenceFields)) {
    assert.equal(new Set(fields.map((field) => field.key)).size, fields.length, `${tool} has duplicate fields`);
    for (const field of fields) {
      assert.equal(
        new Set(field.options.map((option) => option.value)).size,
        field.options.length,
        `${tool}.${field.key} has duplicate option values`,
      );
    }
  }

  assert.deepEqual(emptyPromptPreferences(), {});

  const editModes = promptPreferenceFields["image-editor"]
    .find((field) => field.key === "editMode")?.options.map((option) => option.value) || [];
  for (const expected of ["background-remove", "background-white", "background-replace", "text-translate", "text-replace", "object-remove", "outpaint", "restore"]) {
    assert(editModes.includes(expected), `missing image edit mode: ${expected}`);
  }

  const videoTypes = promptPreferenceFields["video-generator"]
    .find((field) => field.key === "videoType")?.options.map((option) => option.value) || [];
  for (const expected of ["talking-head", "tutorial", "before-after", "product-closeup", "seamless-loop"]) {
    assert(videoTypes.includes(expected), `missing video type: ${expected}`);
  }

  assert(builtInPromptPresets.some((preset) => preset.id === "edit-cutout"));
  assert(builtInPromptPresets.some((preset) => preset.id === "edit-translate"));
  assert(builtInPromptPresets.some((preset) => preset.id === "video-tutorial"));
});

test("builds distinct instructions for image generation, image editing, and video generation", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    return seen.length === 1
      ? "陶瓷杯商品主图，主体完整，纯净背景，不添加文字。"
      : seen.length === 2
        ? "将杯子从原图中干净抠出，背景透明，保留杯身颜色、釉面、Logo 和轮廓，不新增阴影。"
        : "双手依次打开咖啡机包装、取出主机并展示操作面板，动作连续，保留真实包装与商品结构。";
  });

  await service.optimize(baseInput({
    prompt: "陶瓷杯主图",
    preferences: { purpose: "product-main", market: "united-states", platform: "amazon", language: "none" },
  }), { localUserId: "user-1" });
  await service.optimize(baseInput({
    tool: "image-editor",
    hasImage: true,
    prompt: "把杯子抠出来",
    preferences: { editMode: "background-remove", preserve: "product", platform: "none" },
  }), { localUserId: "user-1" });
  await service.optimize(baseInput({
    tool: "video-generator",
    prompt: "展示咖啡机开箱过程",
    preferences: { videoType: "tutorial", motion: "static", pace: "steady", audio: "product-sfx", platform: "none" },
  }), { localUserId: "user-1" });

  assert.equal(seen.length, 3);
  assert.match(seen[0].userPrompt, /电商商品主图/);
  assert.match(seen[0].userPrompt, /目标国家\/地区：美国/);
  assert.match(seen[0].userPrompt, /用途平台：Amazon/);
  assert.match(seen[0].userPrompt, /图片生成/);
  assert.match(seen[1].userPrompt, /抠图透明背景/);
  assert.match(seen[1].userPrompt, /背景透明、不新增阴影/);
  assert.match(seen[1].userPrompt, /编辑动作和作用区域/);
  assert.match(seen[2].userPrompt, /教程视频/);
  assert.match(seen[2].userPrompt, /实际操作先后/);
  assert.match(seen[2].userPrompt, /主体起始状态、关键动作、镜头运动、前后连续性/);
  assert.notEqual(seen[0].userPrompt, seen[1].userPrompt);
  assert.notEqual(seen[1].userPrompt, seen[2].userPrompt);
});

test("routes Seedance guidance by model without changing other video providers", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    return seen.length === 1
      ? "参考 @Image1 锁定人物身份，@Video1 只参考连续动作和运镜，@Audio1 只控制节奏，不改变场景。"
      : "一只小猫从窗边跳到沙发上，镜头稳定跟随动作，结束时小猫坐下。";
  });

  await service.optimize(baseInput({
    tool: "video-generator",
    model: "mg-seedance2.0 -720p fast",
    prompt: "参考 @Image1 的人物，按素材动作和 @Audio1 的节奏",
    hasImage: true,
    duration: 15,
    referenceMediaTypes: ["image", "video", "audio"],
  }), { localUserId: "user-1" });
  await service.optimize(baseInput({
    tool: "video-generator",
    model: "veo-3.1-pro",
    prompt: "一只小猫从窗边跳到沙发上",
  }), { localUserId: "user-1" });

  assert.equal(seen.length, 2);
  assert.match(seen[0].userPrompt, /Seedance 专用规则/);
  assert.match(seen[0].userPrompt, /Seedance 任务模式：参考生视频/);
  assert.match(seen[0].userPrompt, /精确保留用户写出的 @ImageN、@VideoN、@AudioN 标签/);
  assert.match(seen[0].userPrompt, /动作或运镜参考不得覆盖图片引用锁定的人物、产品和场景/);
  assert.match(seen[0].userPrompt, /界面时长为 15 秒/);
  assert.doesNotMatch(seen[1].userPrompt, /Seedance 专用规则/);
});

test("grounds Seedance continuation in the accepted clip end state", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    return "将 @Video1 继续向前延展，人物从视频实际结束姿势继续向门口行走，不重复已经完成的起身动作。";
  });

  await service.optimize(baseInput({
    tool: "video-generator",
    model: "mg-seedance2.0 -720p pro",
    prompt: "将 @Video1 延长，人物继续走向门口",
  }), { localUserId: "user-1" });

  assert.equal(seen.length, 1);
  assert.match(seen[0].userPrompt, /Seedance 任务模式：视频续写或延长/);
  assert.match(seen[0].userPrompt, /已成功视频的实际结束画面/);
  assert.match(seen[0].userPrompt, /不重复已经完成的情节/);
});

test("optimizes common ecommerce image prompt scenarios", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    const relatedTerms = ["真丝睡衣", "纯白背景", "透明背景", "文字翻译", "厨房台面", "限时折扣"];
    return `${relatedTerms[seen.length - 1]}电商商品展示画面提示词 ${seen.length}`;
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
      assert.match(result.optimizedPrompt, /电商商品展示画面提示词/);
      assert.equal(result.billingPolicy, "deferred");
    }
  }

  assert.equal(seen.length, cases.length);
  assert(seen.every((call) => call.systemPrompt.includes("最终输出必须使用简体中文")));
  assert(seen.every((call) => call.systemPrompt.includes("禁止输出整句英文")));
  assert(seen.every((call) => !call.userPrompt.includes("TikTok Shop")));
  assert(seen.every((call) => call.systemPrompt.includes("不要默认用户在做电商")));
  assert(seen.every((call) => call.userPrompt.includes("禁止在最终提示词中复述")));
  assert(seen.some((call) => call.userPrompt.includes("任务类型：图片编辑")));
  assert(seen.some((call) => call.userPrompt.includes("保留项、修改项")));
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

test("can fall back to a local prompt when optimizer provider fails", async () => {
  const service = createPromptOptimizeService({
    caller: async () => {
      throw new NewApiError({
        code: "NEW_API_UPSTREAM_ERROR",
        message: "upstream failed sk-test-secret",
        status: 502,
        retryable: true,
        requestId: "req-local-fallback",
        upstreamStatus: 500,
      });
    },
    fallbackOnModelFailure: true,
  });

  const result = await service.optimize(baseInput({ prompt: "白底商品主图，突出质感" }), {
    localUserId: "user-1",
    requestId: "req-local-fallback",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.optimizedPrompt, /白底商品主图/);
  assert.match(result.optimizedPrompt, /[\u4e00-\u9fff]/);
  assert.equal(result.optimizedPrompt.includes("TikTok Shop"), false);
  assert.equal(result.optimizedPrompt.includes("画幅 1:1"), false);
  assert.equal(result.optimizedPrompt.includes("质量 high"), false);
  assert.equal(result.optimizedPrompt.includes("sk-test-secret"), false);
});

test("uses mode preferences without forcing platform or repeating technical controls", async () => {
  const seen: PromptModelCall[] = [];
  const service = serviceWith(async (input) => {
    seen.push(input);
    return "一只小猫在雨后窗边观察水滴，电影质感，柔和逆光，安静而好奇。";
  });

  const result = await service.optimize(baseInput({
    prompt: "一只小猫看窗外的雨",
    aspectRatio: "16:9",
    quality: "4k",
    preferences: {
      purpose: "free-create",
      style: "cinematic",
      lighting: "backlight",
      platform: "none",
      negativePrompt: "不要文字和水印",
    },
  }), { localUserId: "user-1" });

  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].userPrompt, /创作目的：自由创作/);
  assert.match(seen[0].userPrompt, /视觉风格：电影质感/);
  assert.match(seen[0].userPrompt, /用途平台：不限定平台/);
  assert.match(seen[0].userPrompt, /避免内容：不要文字和水印/);
  assert.match(seen[0].userPrompt, /界面画幅：16:9/);
  assert.match(seen[0].userPrompt, /界面清晰度：4k/);
  if (result.ok) {
    assert.equal(result.optimizedPrompt.includes("16:9"), false);
    assert.equal(result.optimizedPrompt.includes("4k"), false);
    assert.equal(result.optimizedPrompt.includes("TikTok"), false);
  }
});

test("returns only optimized prompt text and redacts secret-shaped output", async () => {
  const service = serviceWith(async () => "```markdown\n最终提示词：白底商品主图，使用干净自然的布光展示商品细节 sk-test-secret-value\n```");
  const result = await service.optimize(baseInput(), { localUserId: "user-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.optimizedPrompt.includes("```"), false);
  assert.equal(result.optimizedPrompt.includes("最终提示词"), false);
  assert.equal(result.optimizedPrompt.includes("sk-test-secret-value"), false);
  assert.equal(result.optimizedPrompt.includes("[REDACTED]"), true);
});

test("preserves the complete long optimized prompt", async () => {
  const optimizedPrompt = `真丝睡衣商品主图，${"保留面料垂坠感、自然褶皱与柔和侧光，".repeat(120)}末尾限制：不要新增文字或品牌标识。`;
  const result = await serviceWith(async () => optimizedPrompt).optimize(baseInput(), { localUserId: "user-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.optimizedPrompt, optimizedPrompt);
  assert.equal(result.optimizedPrompt.endsWith("末尾限制：不要新增文字或品牌标识。"), true);
});

test("falls back to local Chinese prompt when provider returns empty or non-Chinese content", async () => {
  const emptyService = createPromptOptimizeService({
    caller: async () => "",
    fallbackOnModelFailure: true,
  });
  const emptyResult = await emptyService.optimize(baseInput({ prompt: "白底商品主图，突出杯身材质" }), { localUserId: "user-1" });
  assert.equal(emptyResult.ok, true);
  if (!emptyResult.ok) return;
  assert.match(emptyResult.optimizedPrompt, /[\u4e00-\u9fff]/);

  const englishService = createPromptOptimizeService({
    caller: async () => "Professional ecommerce lighting prompt",
    fallbackOnModelFailure: true,
  });
  const englishResult = await englishService.optimize(baseInput({ prompt: "白底商品主图，突出杯身材质" }), { localUserId: "user-1" });
  assert.equal(englishResult.ok, true);
  if (!englishResult.ok) return;
  assert.match(englishResult.optimizedPrompt, /[\u4e00-\u9fff]/);
  assert.equal(englishResult.optimizedPrompt.includes("Professional ecommerce lighting prompt"), false);
});

test("falls back when provider returns Chinese text unrelated to the original request", async () => {
  const service = createPromptOptimizeService({
    caller: async () => "A 是 B 是现代汉语中最常见的判断句式，用于说明分类关系。",
    fallbackOnModelFailure: true,
  });
  const result = await service.optimize(baseInput({ prompt: "白底陶瓷马克杯商品主图，突出杯身釉面质感" }), { localUserId: "user-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.optimizedPrompt, /马克杯|陶瓷|釉面/);
  assert.equal(result.optimizedPrompt.includes("现代汉语"), false);
});

test("provider caller uses prompt-optimizer provider configuration", async () => {
  handlers.set("POST /provider/chat/completions", async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer provider-secret");
    assert.equal(request.headers["new-api-user"], undefined);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.model, "deepseek-v4-pro");
    assert.equal(body.max_tokens, 2400);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    json(response, 200, {
      choices: [
        { message: { content: "来自专用 provider 的中文提示词" } },
      ],
    });
  });

  const provider: ProviderConfig = {
    id: "prompt-optimizer",
    kind: "prompt",
    title: "Prompt optimizer",
    role: "Prompt optimizer",
    apiUrl: `${baseUrl}/provider/chat/completions`,
    model: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    apiKey: "provider-secret",
    enabled: true,
    endpointType: "chat-completions",
    custom: false,
  };
  const caller = createProviderPromptModelCaller(async () => provider);
  const output = await caller({
    systemPrompt: "system",
    userPrompt: "user",
    requestId: "req-provider-config",
    timeoutMs: 500,
  });

  assert.equal(output, "来自专用 provider 的中文提示词");
});

test("provider caller sends labeled visual evidence as multimodal content", async () => {
  handlers.set("POST /provider/vision", async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.deepEqual(body.messages[1].content, [
      { type: "text", text: "analyze canvas" },
      { type: "text", text: "@Image1：目标产品参考" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA==" } },
    ]);
    json(response, 200, { choices: [{ message: { content: "已分析视觉素材" } }] });
  });
  const caller = createProviderPromptModelCaller(async () => ({
    id: "prompt-optimizer",
    kind: "prompt",
    title: "Prompt optimizer",
    role: "Prompt optimizer",
    apiUrl: `${baseUrl}/provider/vision`,
    model: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    apiKey: "provider-secret",
    enabled: true,
    endpointType: "chat-completions",
    custom: false,
  }));
  const output = await caller({
    systemPrompt: "system",
    userPrompt: "analyze canvas",
    images: [{ label: "@Image1", description: "目标产品参考", dataUrl: "data:image/jpeg;base64,AA==" }],
    requestId: "req-provider-vision",
    timeoutMs: 500,
  });
  assert.equal(output, "已分析视觉素材");
});

test("New API caller uses chat completions without exposing admin credentials", async () => {
  handlers.set("POST /v1/chat/completions", async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer admin-secret");
    assert.equal(request.headers["new-api-user"], "1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.model, "prompt-test-model");
    assert.equal(body.max_tokens, 2400);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    json(response, 200, {
      choices: [
        { message: { content: "来自 New API 的中文提示词" } },
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
    assert.equal(output, "来自 New API 的中文提示词");
  } finally {
    if (previousModel === undefined) delete process.env.PROMPT_OPTIMIZER_MODEL;
    else process.env.PROMPT_OPTIMIZER_MODEL = previousModel;
  }
});
