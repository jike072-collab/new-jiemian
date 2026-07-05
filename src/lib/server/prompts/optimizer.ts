import { NewApiError } from "../integrations/new-api/errors";
import { NewApiHttpClient, newApiAdminRequestContext } from "../integrations/new-api";
import { newApiLogger } from "../integrations/new-api/logger";
import { redactJson, redactSecret } from "../integrations/new-api/redaction";
import { providerById } from "../providers";
import { type ProviderConfig } from "../types";

export type PromptOptimizeTool = "image-generator" | "image-editor" | "video-generator";

export type PromptOptimizeInput = {
  tool: PromptOptimizeTool;
  templateId?: string;
  prompt: string;
  hasImage: boolean;
  aspectRatio?: string;
  quality?: string;
  targetPlatform?: string;
};

export type PromptOptimizeContext = {
  localUserId: string;
  requestId?: string;
};

export type PromptOptimizeErrorCode =
  | "invalid_request"
  | "optimizer_unavailable"
  | "optimizer_timeout"
  | "optimizer_failed";

export type PromptOptimizeFailure = {
  ok: false;
  status: number;
  code: PromptOptimizeErrorCode;
  message: string;
  retryable?: boolean;
};

export type PromptOptimizeSuccess = {
  ok: true;
  optimizedPrompt: string;
  billingPolicy: "deferred";
};

export type PromptOptimizeResult = PromptOptimizeSuccess | PromptOptimizeFailure;

export type PromptModelCall = {
  systemPrompt: string;
  userPrompt: string;
  requestId?: string;
  timeoutMs: number;
};

export type PromptModelCaller = (input: PromptModelCall) => Promise<string>;

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  output_text?: string;
  text?: string;
  data?: {
    output_text?: string;
    text?: string;
  };
};

type PromptProviderLoader = () => Promise<ProviderConfig | null>;

const tools = new Set<PromptOptimizeTool>(["image-generator", "image-editor", "video-generator"]);
const DEFAULT_MAX_INPUT_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = "gpt-4o-mini";
const PROMPT_OPTIMIZER_PROVIDER_ID = "prompt-optimizer";
const PROMPT_PROVIDER_RESPONSE_LIMIT_BYTES = 65536;
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const strictChineseSystemPrompt = [
  "请把用户的原始需求整理成可直接提交给生成模型的最终提示词。",
  "最终输出必须使用简体中文。",
  "品牌名、平台名、型号名等不可翻译的专有名词可以保留原文，但禁止输出整句英文。",
  "保留用户已经明确给出的商品、人物、场景、颜色、材质、结构、数量、品牌和动作事实。",
  "不要臆造用户没有要求的新元素、新文字、新品牌、新人物或新装饰。",
  "只输出最终提示词，不要解释，不要标题，不要 Markdown，不要列表，不要额外客套话。",
].join("\n");

function envNumber(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function envText(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function validateInput(input: Partial<PromptOptimizeInput>, maxInputChars: number): PromptOptimizeInput | PromptOptimizeFailure {
  const tool = text(input.tool);
  const prompt = text(input.prompt);
  const hasImage = bool(input.hasImage);

  if (!tools.has(tool as PromptOptimizeTool)) {
    return invalidRequest("Prompt optimization tool is invalid.");
  }
  if (!prompt) {
    return invalidRequest("Prompt is required.");
  }
  if (prompt.length > maxInputChars) {
    return invalidRequest(`Prompt must be ${maxInputChars} characters or fewer.`);
  }
  if (hasImage === null) {
    return invalidRequest("hasImage must be a boolean.");
  }

  return {
    tool: tool as PromptOptimizeTool,
    templateId: boundedOptional(input.templateId, 80),
    prompt,
    hasImage,
    aspectRatio: boundedOptional(input.aspectRatio, 40),
    quality: boundedOptional(input.quality, 40),
    targetPlatform: boundedOptional(input.targetPlatform, 80),
  };
}

function boundedOptional(value: unknown, max: number) {
  const normalized = text(value);
  if (!normalized) return undefined;
  return normalized.slice(0, max);
}

function invalidRequest(message: string): PromptOptimizeFailure {
  return {
    ok: false,
    status: 400,
    code: "invalid_request",
    message,
    retryable: false,
  };
}

function modelFailure(code: PromptOptimizeErrorCode, status: number, message: string, retryable = false): PromptOptimizeFailure {
  return { ok: false, status, code, message, retryable };
}

function extractChatText(payload: ChatCompletionPayload) {
  const first = payload.choices?.[0];
  return text(
    first?.message?.content
    || first?.text
    || payload.output_text
    || payload.text
    || payload.data?.output_text
    || payload.data?.text,
  );
}

function cleanOptimizedPrompt(value: string) {
  let output = redactSecret(value).trim();
  output = output.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
  output = output.replace(/^(优化后?提示词|最终提示词|prompt)\s*[:：]\s*/i, "").trim();
  return output;
}

function containsChineseCharacters(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

const weakChinesePromptTerms = new Set([
  "生成",
  "图片",
  "视频",
  "画面",
  "商品",
  "展示",
  "一个",
  "一张",
  "进行",
  "突出",
  "清晰",
  "自然",
  "背景",
]);

function chineseTerms(value: string) {
  return Array.from(new Set(value.match(/[\u3400-\u9fff]{2,}/gu) || []))
    .flatMap((term) => {
      if (term.length <= 4) return [term];
      const grams: string[] = [];
      for (let index = 0; index <= term.length - 2; index += 2) {
        grams.push(term.slice(index, index + 2));
      }
      return grams;
    })
    .filter((term) => term.length >= 2 && !weakChinesePromptTerms.has(term));
}

function looksRelatedToInput(output: string, input: PromptOptimizeInput) {
  const sourceTerms = chineseTerms(input.prompt);
  if (!sourceTerms.length) return true;
  return sourceTerms.some((term) => output.includes(term));
}

function composeStrictChineseUserPrompt(input: PromptOptimizeInput) {
  const targetPlatform = input.targetPlatform || "TikTok Shop";
  const scenarioGuidance = promptScenarioGuidance(input);
  const scenario = input.tool === "image-editor"
    ? "任务类型：图片编辑。基于参考图进行修改，必须明确写出保留项与修改项。"
    : input.tool === "video-generator"
      ? "任务类型：视频生成。需要写清主体、镜头、动作、节奏、光线和场景连续性。"
      : "任务类型：图片生成。需要写清主体、构图、背景、光线、材质和电商展示重点。";
  const referenceInstruction = input.hasImage
    ? input.tool === "image-editor"
      ? "参考图：已提供。必须保留参考图主体事实，只调整用户明确要求修改的部分。"
      : "参考图：已提供。输出中要强调与参考主体保持一致。"
    : "参考图：未提供。不要声称看到了参考图。";
  const qualityInstruction = input.tool === "video-generator"
    ? "优化重点：主体清晰，动作自然，镜头运动明确，画面稳定，适合短视频传播。"
    : "优化重点：主体突出，构图干净可信，光线自然，材质细节清晰，适合电商转化。";

  return [
    scenario,
    referenceInstruction,
    scenarioGuidance,
    `目标平台：${targetPlatform}`,
    input.templateId ? `模板：${input.templateId}` : "",
    input.aspectRatio ? `画幅：${input.aspectRatio}` : "",
    input.quality ? `质量档位：${input.quality}` : "",
    qualityInstruction,
    "输出结构要求：把用户需求整理成一段自然提示词，必须覆盖主体与目标、场景与构图、光线与材质、镜头或动作、文字与品牌约束、负向约束。不要用列表或标题。",
    "请直接输出一段可以提交给模型的简体中文提示词。",
    "用户原始要求：",
    input.prompt,
  ].filter(Boolean).join("\n");
}

function promptScenarioGuidance(input: PromptOptimizeInput) {
  const prompt = input.prompt;
  if (input.tool === "video-generator") {
    if (/口播|讲解|带货|达人|主播|真人/u.test(prompt)) {
      return "场景策略：这是口播或带货类短视频，强调首秒钩子、人物自然表情、手势克制、商品露出节奏、镜头稳定和真实生活背景。";
    }
    if (/开箱|拆箱|包装/u.test(prompt)) {
      return "场景策略：这是开箱类短视频，按包装外观、打开动作、取出商品、细节特写、完整展示的顺序组织镜头。";
    }
    return "场景策略：这是短视频生成，写清楚首秒画面、镜头运动、主体动作、节奏变化、场景连续性和结尾停留画面。";
  }
  if (input.tool === "image-editor") {
    if (/抠图|透明|去背|透明背景/u.test(prompt)) {
      return "场景策略：这是透明素材或抠图任务，重点写清保留主体事实、边缘干净、透明背景、真实阴影和不改变商品结构。";
    }
    if (/文字|翻译|改字|替换文案/u.test(prompt)) {
      return "场景策略：这是文字编辑任务，重点写清只改指定文字，保留原排版、字体风格、透视、背景和主体不变。";
    }
    return "场景策略：这是图生图编辑任务，必须区分保留项、修改项和禁止改动项，避免模型重绘无关内容。";
  }
  if (/详情|长图|卖点|参数|对比/u.test(prompt)) {
    return "场景策略：这是电商详情或卖点图，强调信息层级、卖点拆解、对比关系、参数区、留白和中文可读性。";
  }
  if (/封面|小红书|社媒|笔记|UGC|种草/u.test(prompt)) {
    return "场景策略：这是社媒封面或种草图，强调首屏吸引力、真实生活感、标题预留区、点击动机和不过度广告化。";
  }
  if (/海报|促销|活动|品牌|主视觉/u.test(prompt)) {
    return "场景策略：这是海报或品牌主视觉，强调标题区、主体层级、活动氛围、版式秩序和不要出现乱码文字。";
  }
  return "场景策略：这是图片生成任务，优先补足主体、构图、背景、光线、材质、风格边界和不希望出现的内容。";
}

function localChineseOptimizedPrompt(input: PromptOptimizeInput) {
  const targetPlatform = input.targetPlatform || "TikTok Shop";
  const scenarioGuidance = promptScenarioGuidance(input);
  const scene = input.tool === "image-editor"
    ? "基于参考图进行图片编辑，保留原有主体外观、颜色、材质、结构、品牌和数量，只修改用户明确指定的部分"
    : input.tool === "video-generator"
      ? "生成短视频画面，主体清晰，动作自然，镜头稳定，节奏适合短视频传播"
      : "生成电商商品展示画面，主体突出，构图干净，背景可信，突出材质与细节";
  const referenceInstruction = input.hasImage
    ? input.tool === "image-editor"
      ? "已提供参考图，输出中明确保留项与修改项"
      : "已提供参考图，保持主体事实一致"
    : "未提供参考图，不要描述未给出的图像内容";
  const parts = [
    input.prompt,
    scene,
    referenceInstruction,
    `适用平台：${targetPlatform}`,
    input.aspectRatio ? `画幅 ${input.aspectRatio}` : "",
    input.quality ? `质量 ${input.quality}` : "",
    scenarioGuidance,
    "补全主体与目标、场景与构图、镜头或动作、光线与材质、文字与品牌约束、负向约束",
    "使用简体中文表达，画面真实可信，光线自然，细节清晰，不额外添加用户未要求的文字、品牌、人物或装饰",
  ].filter(Boolean);
  return cleanOptimizedPrompt(parts.join("，"));
}

function requestIdFor(input: PromptModelCall) {
  return input.requestId || PROMPT_OPTIMIZER_PROVIDER_ID;
}

function mapProviderStatus(status: number) {
  if (status === 401) return 401;
  if (status === 403) return 403;
  if (status === 404) return 404;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 502;
}

function providerRetryable(status: number) {
  return RETRYABLE_PROVIDER_STATUSES.has(status);
}

function providerConfigError(input: PromptModelCall, message: string, code: "NEW_API_CONFIG_MISSING" | "NEW_API_CONFIG_INVALID" | "NEW_API_DISABLED" = "NEW_API_CONFIG_MISSING") {
  return new NewApiError({
    code,
    message,
    status: code === "NEW_API_DISABLED" ? 503 : 500,
    retryable: false,
    requestId: requestIdFor(input),
    safeDetails: { providerId: PROMPT_OPTIMIZER_PROVIDER_ID },
  });
}

function assertPromptProviderReady(provider: ProviderConfig | null, input: PromptModelCall) {
  if (!provider) {
    throw providerConfigError(input, "Prompt optimizer provider is not configured.");
  }
  if (provider.kind !== "prompt" || provider.endpointType !== "chat-completions") {
    throw providerConfigError(input, "Prompt optimizer provider must use chat completions.", "NEW_API_CONFIG_INVALID");
  }
  if (!provider.enabled) {
    throw providerConfigError(input, "Prompt optimizer provider is disabled.", "NEW_API_DISABLED");
  }
  if (!provider.apiUrl.trim() || !provider.apiKey.trim() || !provider.model.trim()) {
    throw providerConfigError(input, "Prompt optimizer provider is missing endpoint, API key, or model.");
  }
  try {
    const parsed = new URL(provider.apiUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw providerConfigError(input, "Prompt optimizer provider endpoint is invalid.", "NEW_API_CONFIG_INVALID");
  }
  return provider;
}

async function readPromptProviderJson(response: Response, input: PromptModelCall) {
  const requestId = requestIdFor(input);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new NewApiError({
      code: "NEW_API_INVALID_CONTENT_TYPE",
      message: "Prompt optimizer provider returned a non-JSON response.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
      safeDetails: { providerId: PROMPT_OPTIMIZER_PROVIDER_ID, contentType },
    });
  }

  const contentLength = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(contentLength) && contentLength > PROMPT_PROVIDER_RESPONSE_LIMIT_BYTES) {
    throw new NewApiError({
      code: "NEW_API_RESPONSE_TOO_LARGE",
      message: "Prompt optimizer provider response exceeded the size limit.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
      safeDetails: { providerId: PROMPT_OPTIMIZER_PROVIDER_ID, maxResponseBytes: PROMPT_PROVIDER_RESPONSE_LIMIT_BYTES },
    });
  }

  const textValue = await response.text();
  if (new TextEncoder().encode(textValue).byteLength > PROMPT_PROVIDER_RESPONSE_LIMIT_BYTES) {
    throw new NewApiError({
      code: "NEW_API_RESPONSE_TOO_LARGE",
      message: "Prompt optimizer provider response exceeded the size limit.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
      safeDetails: { providerId: PROMPT_OPTIMIZER_PROVIDER_ID, maxResponseBytes: PROMPT_PROVIDER_RESPONSE_LIMIT_BYTES },
    });
  }

  try {
    return textValue ? JSON.parse(textValue) as unknown : null;
  } catch {
    throw new NewApiError({
      code: "NEW_API_INVALID_JSON",
      message: "Prompt optimizer provider returned invalid JSON.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
      safeDetails: { providerId: PROMPT_OPTIMIZER_PROVIDER_ID },
    });
  }
}

async function callPromptProvider(provider: ProviderConfig, input: PromptModelCall) {
  let response: Response;
  try {
    response = await fetch(provider.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        max_tokens: envNumber("PROMPT_OPTIMIZER_MAX_TOKENS", 500, 100, 1200),
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    if ((error as Error).name === "TimeoutError" || (error as Error).name === "AbortError") {
      throw new NewApiError({
        code: "NEW_API_TIMEOUT",
        message: "Prompt optimizer provider request timed out.",
        status: 504,
        retryable: true,
        requestId: requestIdFor(input),
        safeDetails: { providerId: provider.id },
      });
    }
    throw new NewApiError({
      code: "NEW_API_NETWORK",
      message: "Prompt optimizer provider network request failed.",
      status: 502,
      retryable: true,
      requestId: requestIdFor(input),
      safeDetails: { providerId: provider.id },
    });
  }

  const payload = await readPromptProviderJson(response, input);
  if (!response.ok) {
    throw new NewApiError({
      code: "NEW_API_UPSTREAM_ERROR",
      message: `Prompt optimizer provider rejected the request with HTTP ${response.status}.`,
      status: mapProviderStatus(response.status),
      retryable: providerRetryable(response.status),
      requestId: requestIdFor(input),
      upstreamStatus: response.status,
      safeDetails: {
        providerId: provider.id,
        upstreamStatus: response.status,
        body: JSON.stringify(redactJson(payload)).slice(0, 500),
      },
    });
  }
  return extractChatText(payload as ChatCompletionPayload);
}

export function createProviderPromptModelCaller(loadProvider: PromptProviderLoader = () => providerById(PROMPT_OPTIMIZER_PROVIDER_ID)): PromptModelCaller {
  return async (input) => {
    const provider = assertPromptProviderReady(await loadProvider(), input);
    return callPromptProvider(provider, input);
  };
}

function isProviderConfigFallback(error: unknown) {
  return error instanceof NewApiError
    && (error.code === "NEW_API_CONFIG_MISSING" || error.code === "NEW_API_CONFIG_INVALID" || error.code === "NEW_API_DISABLED")
    && error.safeDetails?.providerId === PROMPT_OPTIMIZER_PROVIDER_ID;
}

function createNewApiAdminPromptModelCaller(client: NewApiHttpClient): PromptModelCaller {
  return async (input) => {
    const response = await client.request<ChatCompletionPayload>({
      method: "POST",
      path: "/v1/chat/completions",
      context: newApiAdminRequestContext(client.config, input.requestId),
      timeoutMs: input.timeoutMs,
      maxResponseBytes: 65536,
      retry: false,
      body: {
        model: envText("PROMPT_OPTIMIZER_MODEL", DEFAULT_MODEL),
        temperature: 0.2,
        max_tokens: envNumber("PROMPT_OPTIMIZER_MAX_TOKENS", 500, 100, 1200),
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      },
    });
    return extractChatText(response.data);
  };
}

export function createNewApiPromptModelCaller(client?: NewApiHttpClient): PromptModelCaller {
  const adminCaller = createNewApiAdminPromptModelCaller(client || new NewApiHttpClient());
  if (client) return adminCaller;

  const providerCaller = createProviderPromptModelCaller();
  return async (input) => {
    try {
      return await providerCaller(input);
    } catch (error) {
      if (!isProviderConfigFallback(error)) throw error;
      return adminCaller(input);
    }
  };
}

export function createPromptOptimizeService(options: {
  caller?: PromptModelCaller;
  maxInputChars?: number;
  timeoutMs?: number;
  fallbackOnModelFailure?: boolean;
} = {}) {
  const caller = options.caller || createNewApiPromptModelCaller();
  const fallbackOnModelFailure = options.fallbackOnModelFailure ?? !options.caller;
  const maxInputChars = options.maxInputChars ?? envNumber(
    "PROMPT_OPTIMIZER_MAX_INPUT_CHARS",
    DEFAULT_MAX_INPUT_CHARS,
    100,
    8000,
  );
  const timeoutMs = options.timeoutMs ?? envNumber("PROMPT_OPTIMIZER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1000, 60000);

  return {
    async optimize(input: Partial<PromptOptimizeInput>, context: PromptOptimizeContext): Promise<PromptOptimizeResult> {
      const validated = validateInput(input, maxInputChars);
      if ("ok" in validated) return validated;

      try {
        const optimizedPrompt = cleanOptimizedPrompt(await caller({
          systemPrompt: strictChineseSystemPrompt,
          userPrompt: composeStrictChineseUserPrompt(validated),
          requestId: context.requestId,
          timeoutMs,
        }));

        if (!optimizedPrompt) {
          if (fallbackOnModelFailure) {
            return {
              ok: true,
              optimizedPrompt: localChineseOptimizedPrompt(validated),
              billingPolicy: "deferred",
            };
          }
          return modelFailure("optimizer_failed", 502, "Prompt optimizer returned an empty response.", true);
        }

        return {
          ok: true,
          optimizedPrompt: containsChineseCharacters(optimizedPrompt)
            && looksRelatedToInput(optimizedPrompt, validated)
            ? optimizedPrompt
            : localChineseOptimizedPrompt(validated),
          billingPolicy: "deferred",
        };
      } catch (error) {
        newApiLogger.warn({
          event: "prompt_optimizer_failed",
          requestId: context.requestId,
          context: "prompt-optimizer",
          retryable: error instanceof NewApiError ? error.retryable : false,
          details: {
            tool: validated.tool,
            promptLength: validated.prompt.length,
            errorCode: error instanceof NewApiError ? error.code : "PROMPT_OPTIMIZER_ERROR",
          },
        });

        if (error instanceof NewApiError) {
          if (fallbackOnModelFailure) {
            return {
              ok: true,
              optimizedPrompt: localChineseOptimizedPrompt(validated),
              billingPolicy: "deferred",
            };
          }
          if (error.code === "NEW_API_DISABLED" || error.code === "NEW_API_CONFIG_MISSING") {
            return modelFailure("optimizer_unavailable", 503, "Prompt optimizer is unavailable.", false);
          }
          if (error.code === "NEW_API_TIMEOUT") {
            return modelFailure("optimizer_timeout", 504, "Prompt optimizer timed out.", true);
          }
          return modelFailure("optimizer_failed", error.status || 502, "Prompt optimizer request failed.", Boolean(error.retryable));
        }

        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          if (fallbackOnModelFailure) {
            return {
              ok: true,
              optimizedPrompt: localChineseOptimizedPrompt(validated),
              billingPolicy: "deferred",
            };
          }
          return modelFailure("optimizer_timeout", 504, "Prompt optimizer timed out.", true);
        }
        if (fallbackOnModelFailure) {
          return {
            ok: true,
            optimizedPrompt: localChineseOptimizedPrompt(validated),
            billingPolicy: "deferred",
          };
        }
        return modelFailure("optimizer_failed", 502, "Prompt optimizer request failed.", true);
      }
    },
  };
}

let singleton: ReturnType<typeof createPromptOptimizeService> | null = null;

export function getPromptOptimizeService() {
  singleton ||= createPromptOptimizeService();
  return singleton;
}
