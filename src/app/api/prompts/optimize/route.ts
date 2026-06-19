import { NextResponse } from "next/server";

import { readProviders } from "@/lib/server/providers";

export const runtime = "nodejs";

type OptimizePromptRequest = {
  tool?: string;
  templateId?: string;
  prompt?: string;
  hasImage?: boolean;
  aspectRatio?: string;
  quality?: string;
  duration?: number;
  targetPlatform?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function promptOptimizerEndpoint(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (/\/(?:v1\/)?chat\/completions$/i.test(pathname)) {
      parsed.pathname = pathname;
    } else if (/\/v1(?:\/.*)?$/i.test(pathname)) {
      parsed.pathname = pathname.replace(/\/v1(?:\/.*)?$/i, "/v1/chat/completions");
    } else {
      parsed.pathname = `${pathname === "" ? "" : pathname}/chat/completions`;
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function readProviderJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = asRecord(payload);
    const message = firstString(asRecord(record.error).message, record.message)
      || `提示词优化请求失败：HTTP ${response.status}`;
    throw new Error(normalizePromptOptimizerError(message));
  }
  return payload;
}

function normalizePromptOptimizerError(message: string) {
  const noAccess = message.match(/no access to model\s+([^\s(]+)/i);
  if (noAccess?.[1]) {
    return `当前密钥没有访问提示词优化模型 ${noAccess[1]} 的权限，请在后台切换模型或更换密钥。`;
  }
  if (/video model.*not available|not available on this endpoint/i.test(message)) {
    return "当前选择的是视频模型，不能用于提示词优化，请在后台填写可用的文本模型。";
  }
  return message;
}

function optimizerInstruction(input: Required<Pick<OptimizePromptRequest, "tool" | "prompt">> & OptimizePromptRequest) {
  const isVideo = input.tool === "video-generator";
  const context = [
    `目标平台：${input.targetPlatform || "TikTok Shop"}`,
    `是否有参考图：${input.hasImage ? "有" : "无"}`,
    `比例：${input.aspectRatio || "未指定"}`,
    isVideo ? `时长：${input.duration || "未指定"} 秒` : `清晰度：${input.quality || "未指定"}`,
    input.templateId ? `模板 ID：${input.templateId}` : "",
  ].filter(Boolean).join("\n");

  return [
    "你是电商内容创作提示词优化助手。",
    isVideo
      ? "请把用户的简短视频要求优化为适合 AI 视频生成的中文提示词，补充主体、动作、镜头、运镜、节奏、场景、光线和商品卖点。"
      : "请把用户的简短图片要求优化为适合 AI 图片生成或图片编辑的中文提示词，补充主体、构图、场景、光线、材质、商品卖点和画面风格。",
    "只输出优化后的提示词，不要解释，不要编号，不要自动开始生成。",
    context,
    `用户原始提示词：${input.prompt}`,
  ].join("\n\n");
}

function parseOptimizedPrompt(payload: unknown) {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  return firstString(message.content, first.text, root.content, root.prompt);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as OptimizePromptRequest;
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "请先填写提示词。" }, { status: 400 });
    }

    const providers = await readProviders();
    const provider = providers.find((item) => (
      item.kind === "prompt"
      && item.endpointType === "chat-completions"
      && item.enabled
      && item.apiKey.trim()
    ));

    if (!provider) {
      return NextResponse.json({ error: "提示词优化模型暂未配置，请先在后台配置可用的文本模型。" }, { status: 400 });
    }

    if (!provider.model.trim()) {
      return NextResponse.json({ error: "提示词优化模型暂未填写，请先在后台填写可用的文本模型 ID。" }, { status: 400 });
    }

    const endpoint = promptOptimizerEndpoint(provider.apiUrl);
    if (!endpoint) {
      return NextResponse.json({ error: "提示词优化接口地址无效。" }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "user", content: optimizerInstruction({ ...body, tool: body.tool || "image-generator", prompt }) },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const optimizedPrompt = parseOptimizedPrompt(await readProviderJson(response)).trim();
    if (!optimizedPrompt) {
      return NextResponse.json({ error: "提示词优化没有返回内容，请稍后重试。" }, { status: 502 });
    }
    return NextResponse.json({ optimizedPrompt });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "提示词优化失败，请稍后重试。",
    }, { status: 400 });
  }
}
