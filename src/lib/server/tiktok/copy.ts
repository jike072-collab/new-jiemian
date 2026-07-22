import "server-only";

import { buildCanvasAssistantVisualEvidence } from "@/lib/server/canvas-assistant-media";
import { isCanvasLibraryItemInScope, type CanvasLibraryScope } from "@/lib/canvas/library-scope";
import { NewApiError } from "@/lib/server/integrations/new-api";
import { readLibraryMetadataForOwners } from "@/lib/server/library";
import { createNewApiPromptModelCaller, type PromptModelCaller } from "@/lib/server/prompts";
import { malaysiaShoeCopyPromptLibrary } from "@/lib/malaysia-shoe-copy-library";
import {
  malaysiaTikTokCopyAngle,
  malaysiaTikTokCopyAnglePrompt,
  malaysiaTikTokCopyAngles,
  parseTikTokCopyResponse,
} from "@/lib/tiktok-copy";
import { TikTokPublishingError } from "./service";

const systemPrompt = [
  "你是面向马来西亚市场的 TikTok 鞋类短视频文案编辑。",
  "必须先观察按时间顺序提供的视频代表帧，再根据视频真实可见内容写文案；不得使用素材的生成提示词代替发布文案。",
  "先判断最匹配的鞋类 category，再从马来鞋类文案库中选择对应口吻、钩子、CTA 和标签；一次只写一个核心卖点。",
  "输出自然的马来西亚马来语，可少量自然混用英语和 ni、je、tau、korang 等本地口语；不要逐字翻译中文，不要写成长篇商品说明。",
  "title 是 TikTok caption 的第一句钩子，写 5-12 个词；caption 只写 1-2 句，避免逐帧复述和重复 title。",
  "优先写第一眼反应、配色、造型、真实场景或一个清晰互动问题。默认加一个自然 CTA，但不要每次使用同一句。",
  "不得虚构品牌、价格、折扣、库存、材质、舒适度、功能、疗效或视频中无法确认的商品卖点。",
  "只有视频画面或可信上下文明确支持时，才能写品牌、价格、折扣、现货/售罄、尺码、材质、舒服、轻、防滑、防水、耐用、安全性能或很多人询问等内容。",
  "话题只选 4-6 个与具体鞋类、人群、场景和马来西亚受众相关的自然标签；不要默认加 #fyp，不要为了蹭热度加入无关总榜话题，不要堆标签。",
  `马来鞋类文案库：${malaysiaShoeCopyPromptLibrary()}`,
  "只学习文案库示例的结构和口吻，不得逐句复制示例或公开样本文案。",
  "只输出 JSON，不要 Markdown。结构：{\"title\":\"\",\"caption\":\"\",\"hashtags\":[\"#...\"],\"angle\":\"auto|transformation|daily|style|detail\",\"category\":\"auto|sports|women|men|kids|safety|outdoor|casual\"}",
].join("\n");

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const caller = input.caller || createNewApiPromptModelCaller();
  const callInput = {
    systemPrompt,
    userPrompt: JSON.stringify({
      market: "Malaysia",
      language: "Bahasa Melayu",
      requestedAngle: angle,
      angleInstruction: malaysiaTikTokCopyAnglePrompt(angle),
      availableCopyAngles: malaysiaTikTokCopyAngles,
      instruction: "先识别鞋类和最强可见卖点，只选择一个文案角度，再按马来鞋类文案库输出短钩子、1-2 句正文和 4-6 个标签。",
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
      throw new TikTokPublishingError("TIKTOK_COPY_UPSTREAM_FAILED", "AI 文案生成暂时不可用，请稍后重试。", 502);
    }
    await delay(350);
    try {
      output = await caller(callInput);
    } catch {
      throw new TikTokPublishingError("TIKTOK_COPY_UPSTREAM_FAILED", "AI 文案生成暂时不可用，请稍后重试。", 502);
    }
  }
  try {
    return parseTikTokCopyResponse(output, angle);
  } catch {
    throw new TikTokPublishingError("TIKTOK_COPY_INVALID", "AI 返回的文案格式无效，请重新生成。", 502);
  }
}
