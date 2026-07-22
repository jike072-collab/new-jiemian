import "server-only";

import { buildCanvasAssistantVisualEvidence } from "@/lib/server/canvas-assistant-media";
import { isCanvasLibraryItemInScope, type CanvasLibraryScope } from "@/lib/canvas/library-scope";
import { NewApiError } from "@/lib/server/integrations/new-api";
import { readLibraryMetadataForOwners } from "@/lib/server/library";
import { createNewApiPromptModelCaller, type PromptModelCaller } from "@/lib/server/prompts";
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
  "输出自然的马来西亚马来语，不要逐字翻译中文，不要写成长篇商品说明。",
  "标题要像 TikTok 第一行钩子，正文用 2-4 句突出视频里最吸引人的视觉变化、配色、穿搭或细节。",
  "不得虚构品牌、价格、折扣、库存、材质、舒适度、功能、疗效或视频中无法确认的商品卖点。",
  "话题只选 4-7 个与鞋类、穿搭、视频内容和马来西亚受众相关的标签；不要为了蹭热度加入无关总榜话题，不要堆砌 #fyp。",
  "只输出 JSON，不要 Markdown。结构：{\"title\":\"\",\"caption\":\"\",\"hashtags\":[\"#...\"],\"angle\":\"auto|transformation|daily|style|detail\"}",
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
