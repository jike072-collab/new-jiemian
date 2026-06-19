import { NewApiError } from "../integrations/new-api/errors";
import { NewApiHttpClient, newApiAdminRequestContext } from "../integrations/new-api";
import { newApiLogger } from "../integrations/new-api/logger";
import { redactSecret } from "../integrations/new-api/redaction";

export type PromptOptimizeTool = "image-generator" | "image-editor";

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

const tools = new Set<PromptOptimizeTool>(["image-generator", "image-editor"]);
const DEFAULT_MAX_INPUT_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = "gpt-4o-mini";

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
    : "图片生成：生成可用于商品展示的电商视觉，不能改变用户描述的商品事实。";
  const imageInstruction = input.hasImage
    ? "参考图：存在。输出中要写清保留项与修改项。"
    : "参考图：不存在。不要声称看到了图片。";

  return [
    scenario,
    imageInstruction,
    `平台用途：${targetPlatform}`,
    input.templateId ? `模板：${input.templateId}` : "",
    input.aspectRatio ? `画幅：${input.aspectRatio}` : "",
    input.quality ? `质量：${input.quality}` : "",
    "优化重点：主体清晰、构图适合电商点击、背景干净可信、光线突出材质和细节。",
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

export function createNewApiPromptModelCaller(client = new NewApiHttpClient()): PromptModelCaller {
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
