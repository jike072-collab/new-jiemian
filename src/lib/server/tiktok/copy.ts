import "server-only";

import { buildCanvasAssistantVisualEvidence } from "@/lib/server/canvas-assistant-media";
import { isCanvasLibraryItemInScope, type CanvasLibraryScope } from "@/lib/canvas/library-scope";
import { NewApiError } from "@/lib/server/integrations/new-api";
import { readLibraryMetadataForOwners } from "@/lib/server/library";
import { createNewApiAdminPromptModelCaller, type PromptModelCaller } from "@/lib/server/prompts";
import { malaysiaShoeCopyPromptLibrary } from "@/lib/malaysia-shoe-copy-library";
import {
  malaysiaTikTokCopyAngle,
  malaysiaTikTokCopyAnglePrompt,
  malaysiaTikTokCopyAngles,
  parseTikTokCopyResponse,
} from "@/lib/tiktok-copy";
import { TikTokPublishingError } from "./service";

const TIKTOK_COPY_MODEL = "gpt-5.6-sol";

const systemPrompt = [
  "你是面向马来西亚市场的 TikTok 鞋类短视频文案编辑。",
  "必须先观察按时间顺序提供的视频代表帧，再根据视频真实可见内容写文案；不得使用素材的生成提示词代替发布文案。",
  "先判断最匹配的鞋类 category，再从马来鞋类文案库中选择对应口吻、钩子、CTA 和标签；一次只写一个核心卖点。",
  "按 TikTok Shop 的注意、兴趣与欲望、信任、行动结构分工：title 负责注意；caption 先补一个可见核心价值或可信细节，再给一个自然行动指令。不要逐帧复述视频，也不要在标题和正文重复同一句。",
  "可用证据优先级是功能演示、真实场景、可比较的前后变化、商品细节；只有画面明确出现真实用户表达时才可使用用户证言。",
  "输出自然的马来西亚马来语，可少量自然混用英语和 ni、je、tau、korang 等本地口语；不要逐字翻译中文，不要写成长篇商品说明。",
  "title 是 TikTok caption 的第一句钩子，写 5-12 个词；caption 只写 1-2 句，第一句承接核心价值或信任证据，第二句给自然 CTA。",
  "优先写第一眼反应、配色、造型、真实场景或一个清晰互动问题。默认加一个自然 CTA，但不要每次使用同一句。",
  "不得虚构品牌、价格、折扣、库存、材质、舒适度、功能、疗效或视频中无法确认的商品卖点。",
  "只有视频画面或可信上下文明确支持时，才能写品牌、价格、折扣、现货/售罄、尺码、材质、舒服、轻、防滑、防水、耐用、安全性能或很多人询问等内容。",
  "话题只选 4-6 个与具体鞋类、人群、场景和马来西亚受众相关的自然标签；不要默认加 #fyp，不要为了蹭热度加入无关总榜话题，不要堆标签。",
  `马来鞋类文案库：${malaysiaShoeCopyPromptLibrary()}`,
  "只学习文案库示例的结构和口吻，不得逐句复制示例或公开样本文案。",
  "只输出 JSON，不要 Markdown。结构：{\"title\":\"\",\"caption\":\"\",\"hashtags\":[\"#...\"],\"angle\":\"auto|transformation|daily|style|detail\",\"category\":\"auto|sports|women|men|kids|safety|outdoor|casual\"}",
  "文案要像马来西亚本地朋友分享刚看到的穿搭细节：短句、具体、自然，不要硬塞夸张带货词。优先从画面里真实可见的反差、颜色、局部细节或日常场景开场；避免空泛的 ‘terus nampak lain’、‘wajib ada’、‘confirm’ 或机械套话，除非画面本身能证明。标题用自然疑问、意外发现或具体观察吸引继续看；正文补充同一个可见细节，再给一句轻松、不施压的 CTA。仍只输出 JSON。",
].join("\n");

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function copyProviderUnavailableMessage(error: unknown) {
  const upstream = error instanceof NewApiError && error.upstreamStatus
    ? `（上游 HTTP ${error.upstreamStatus}）`
    : "";
  return `AI 文案模型 ${TIKTOK_COPY_MODEL} 暂时不可用${upstream}，请稍后重试。`;
}

export async function generateMalaysiaTikTokCopy(input: {
  libraryItemId: string;
  ownerIds: readonly string[];
  scope: CanvasLibraryScope;
  angle?: unknown;
  requestId?: string;
  caller?: PromptModelCaller;
}) {
  const item = (await readLibraryMetadataForOwners(input.ownerIds)).find((candidate) => candidate.id === input.libraryItemId && isCanvasLibraryItemInScope(candidate, input.scope));
  if (!item || item.type !== "video" || item.status !== "done") {
    throw new TikTokPublishingError("TIKTOK_VIDEO_NOT_FOUND", "视频不存在、尚未完成或无权生成文案。", 404);
  }
  const angle = malaysiaTikTokCopyAngle(input.angle);
  const visualEvidence = await buildCanvasAssistantVisualEvidence([{
    id: "tiktok-copy-video",
    kind: "media",
    title: "待发布视频",
    selected: true,
    mediaType: "video",
    libraryItemId: item.id,
    referenceLabels: [{ generatorId: "tiktok-copy", label: "@Video1" }],
  }], input.ownerIds, "分析选中的视频画面，为马来西亚鞋类 TikTok 生成发布标题、正文和相关话题。", input.scope);
  if (!visualEvidence.images.length) {
    throw new TikTokPublishingError("TIKTOK_COPY_VIDEO_UNREADABLE", "暂时无法读取视频画面，请稍后重试。", 409);
  }
  const caller = input.caller || createNewApiAdminPromptModelCaller({ model: TIKTOK_COPY_MODEL });
  const callInput = {
    systemPrompt,
    userPrompt: JSON.stringify({
      market: "Malaysia",
      language: "Bahasa Melayu",
      requestedAngle: angle,
      angleInstruction: malaysiaTikTokCopyAnglePrompt(angle),
      availableCopyAngles: malaysiaTikTokCopyAngles,
      instruction: "按时间顺序判断视频的开场钩子、一个核心价值、可信证据和结尾行动；只选择最强的一个文案角度，再按马来鞋类文案库输出短钩子、1-2 句正文和 4-6 个标签。",
      visualEvidence: visualEvidence.summary,
    }),
    images: visualEvidence.images,
    requestId: input.requestId,
    timeoutMs: 45_000,
  } satisfies Parameters<PromptModelCaller>[0];
  let output: string;
  try {
    output = await caller(callInput);
  } catch (error) {
    if (!(error instanceof NewApiError) || !error.retryable) {
      throw new TikTokPublishingError("TIKTOK_COPY_UPSTREAM_FAILED", copyProviderUnavailableMessage(error), 502);
    }
    await delay(350);
    try {
      output = await caller(callInput);
    } catch (retryError) {
      throw new TikTokPublishingError("TIKTOK_COPY_UPSTREAM_FAILED", copyProviderUnavailableMessage(retryError), 502);
    }
  }
  try {
    return parseTikTokCopyResponse(output, angle);
  } catch {
    throw new TikTokPublishingError("TIKTOK_COPY_INVALID", "AI 返回的文案格式无效，请重新生成。", 502);
  }
}
