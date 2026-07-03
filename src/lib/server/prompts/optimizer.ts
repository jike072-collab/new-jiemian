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

const systemPrompt = [
  "将用户的简单要求整理成可直接提交给图片模型的专业提示词。",
  "保留商品真实外观、颜色、材质、结构、品牌和数量。",
  "补充主体、构图、背景、光线、风格和平台用途。",
  "不添加用户未要求的文字、品牌、人物或装饰。",
  "图片编辑场景必须明确保留项和修改项。",
  "默认面向 TikTok Shop 电商视觉，优化构图、背景、光线和用途。",
  "只输出最终提示词，不输出解释、Markdown、标题或列表。",
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

function composeUserPrompt(input: PromptOptimizeInput) {
  const targetPlatform = input.targetPlatform || "TikTok Shop";
  const scenario = input.tool === "image-editor"
    ? "图片编辑：基于参考图进行局部修改，必须保留参考图中商品真实外观、颜色、材质、结构、品牌和数量。"
    : input.tool === "video-generator"
      ? "视频生成：将用户的简短要求整理成可直接提交给视频模型的镜头、动作、节奏和画面描述，不能改变用户描述的主体事实。"
      : "图片生成：生成可用于商品展示的电商视觉，不能改变用户描述的商品事实。";
  const imageInstruction = input.hasImage
    ? input.tool === "video-generator"
      ? "参考图：存在。输出中要说明首帧主体、镜头运动、人物或商品动作，并保持参考图主体一致。"
      : "参考图：存在。输出中要写清保留项与修改项。"
    : "参考图：不存在。不要声称看到了图片。";
  const optimizeFocus = input.tool === "video-generator"
    ? "优化重点：主体清晰、动作自然、镜头运动明确、节奏适合短视频、画面连续稳定、光线和场景细节具体。"
    : "优化重点：主体清晰、构图适合电商点击、背景干净可信、光线突出材质和细节。";

  return [
    scenario,
    imageInstruction,
    `平台用途：${targetPlatform}`,
    input.templateId ? `模板：${input.templateId}` : "",
    input.aspectRatio ? `画幅：${input.aspectRatio}` : "",
    input.quality ? `质量：${input.quality}` : "",
    optimizeFocus,
    "用户原始要求：",
    input.prompt,
  ].filter(Boolean).join("\n");
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
} = {}) {
  const caller = options.caller || createNewApiPromptModelCaller();
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
          systemPrompt,
          userPrompt: composeUserPrompt(validated),
          requestId: context.requestId,
          timeoutMs,
        }));

        if (!optimizedPrompt) {
          return modelFailure("optimizer_failed", 502, "Prompt optimizer returned an empty response.", true);
        }

        return {
          ok: true,
          optimizedPrompt,
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
          return modelFailure("optimizer_timeout", 504, "Prompt optimizer timed out.", true);
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
