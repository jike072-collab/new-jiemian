import type {
  CanvasCommerceAssistantState,
  CanvasCommerceCreativeOption,
  CanvasCommerceCreativeStyle,
  CanvasCommerceDirection,
  CanvasCommercePlan,
  CanvasCommercePlanHook,
  CanvasCommerceProductDraft,
  CanvasNodeData,
  CanvasReferenceBinding,
  CanvasReferenceRole,
  CanvasStoredEdge,
} from "./types";
import {
  isMalaysiaCommerceHookPairCompatible,
  malaysiaCommerceCopyHookPattern,
  malaysiaCommerceVisualHookPattern,
} from "#malaysia-commerce-video-hook-library";
import { composeTikTokCaption, normalizeTikTokCopyDraft, type TikTokCopyDraft } from "#tiktok-copy";

export const commerceDirectionOptions: Array<{
  id: CanvasCommerceDirection;
  label: string;
  detail: string;
  requiresHuman: boolean;
}> = [
  { id: "human-wear", label: "真人上脚", detail: "马来西亚本地真人，以痛点钩子进入上脚展示", requiresHuman: true },
  { id: "sport-motion", label: "运动动态", detail: "本地真人在匹配鞋型的快走、慢跑或轻运动场景展示", requiresHuman: true },
  { id: "daily-style", label: "日常穿搭", detail: "马来西亚本地人物的自然日常穿搭展示", requiresHuman: true },
  { id: "product-asmr", label: "产品细节 / ASMR", detail: "产品近景、可见结构与声音细节", requiresHuman: false },
  { id: "handheld", label: "手持展示", detail: "手部拿取和转动产品；有包装证据时才允许开箱", requiresHuman: false },
  { id: "malay-review", label: "马来语口播", detail: "本地真人用自然马来语痛点钩子和推荐", requiresHuman: true },
];

const directions = new Set(commerceDirectionOptions.map((item) => item.id));
const creativeStyles = new Set<CanvasCommerceCreativeStyle>(["pain-point", "contrast", "motion"]);
const roles = new Set<CanvasReferenceRole>([
  "identity", "first-frame", "last-frame", "product", "environment",
  "motion", "camera", "timing", "audio", "style",
]);

export type CanvasCommerceProductAnalysisResponse = {
  kind: "commerce-product-analysis";
  sameProduct: boolean;
  conflictMessage?: string;
  suggestedName: string;
  sellingPoints: string[];
  visibleFacts: string[];
  recommendedDirections: CanvasCommerceDirection[];
  creativeOptions?: CanvasCommerceCreativeOption[];
};

export type CanvasCommercePlanGenerationResponse = {
  kind: "commerce-plan-generation";
  plans: CanvasCommercePlan[];
};

export type CanvasCommerceCreationProvider = {
  id: string;
  model: string;
  videoOptions?: {
    maxReferenceImages?: number;
    resolution?: string;
    resolutions?: string[];
  };
};

export type CanvasCommerceCreationBranch = {
  plan: CanvasCommercePlan;
  provider: CanvasCommerceCreationProvider;
  imageLimit: number;
  omittedImageCount: number;
  resolution: string;
};

export function emptyCommerceAssistantState(): CanvasCommerceAssistantState {
  return { products: {} };
}

export function newCommerceProductDraft(): CanvasCommerceProductDraft {
  const now = new Date().toISOString();
  return {
    id: commerceId("product"),
    createdAt: now,
    updatedAt: now,
    images: [],
    productName: "",
    sellingPoints: [],
    visibleFacts: [],
    recommendedDirections: [],
    selectedDirections: [],
    directionSellingPoints: {},
    plans: [],
    extraRequirements: "",
    phase: "setup",
  };
}

export function normalizeCommerceProductAnalysis(value: unknown): CanvasCommerceProductAnalysisResponse {
  const record = object(value);
  if (record.kind !== "commerce-product-analysis") throw new Error("产品分析返回格式无效。");
  const sellingPoints = stringList(record.sellingPoints, 8, 160);
  const visibleFacts = stringList(record.visibleFacts, 16, 160);
  const recommendedDirections = directionList(record.recommendedDirections, 6);
  const creativeOptions = normalizeCommerceCreativeOptions(record.creativeOptions);
  const sameProduct = record.sameProduct === true;
  if (sameProduct && sellingPoints.length < 4) throw new Error("产品分析没有返回足够的可确认卖点。");
  return {
    kind: "commerce-product-analysis",
    sameProduct,
    conflictMessage: text(record.conflictMessage, 500) || undefined,
    suggestedName: text(record.suggestedName, 120),
    sellingPoints,
    visibleFacts,
    recommendedDirections,
    ...(creativeOptions.length ? { creativeOptions } : {}),
  };
}

export function normalizeCommerceCreativeOptions(value: unknown, limit = 3): CanvasCommerceCreativeOption[] {
  if (!Array.isArray(value)) return [];
  const seenStyles = new Set<CanvasCommerceCreativeStyle>();
  return value.slice(0, limit).flatMap((candidate, index) => {
    const item = object(candidate, false);
    if (!item) return [];
    const style = text(item.style, 32) as CanvasCommerceCreativeStyle;
    const title = text(item.title, 80);
    const hookLine = text(item.hookLine, 160);
    const scene = text(item.scene, 160);
    const visualBeat = text(item.visualBeat, 200);
    if (!creativeStyles.has(style) || seenStyles.has(style) || !title || !hookLine || !scene || !visualBeat) return [];
    seenStyles.add(style);
    return [{ id: text(item.id, 120) || `hook-${index + 1}`, style, title, hookLine, scene, visualBeat }];
  });
}

export function commerceCreativeStyleLabel(style: CanvasCommerceCreativeStyle) {
  if (style === "pain-point") return "痛点问句";
  if (style === "contrast") return "穿搭反差";
  return "运动场景";
}

export function normalizeCommercePlanGeneration(value: unknown, expectedDirections?: CanvasCommerceDirection[]): CanvasCommercePlanGenerationResponse {
  const record = object(value);
  if (record.kind !== "commerce-plan-generation" || !Array.isArray(record.plans)) throw new Error("提示词方案返回格式无效。");
  const expected = expectedDirections ? new Set(expectedDirections) : null;
  const seen = new Set<CanvasCommerceDirection>();
  const seenHookPairs = new Set<string>();
  const plans = record.plans.slice(0, 3).flatMap((candidate) => {
    const item = object(candidate, false);
    if (!item) return [];
    const direction = text(item.direction, 40) as CanvasCommerceDirection;
    const prompt = text(item.prompt, 8_000);
    if (!directions.has(direction) || seen.has(direction) || (expected && !expected.has(direction)) || !prompt) return [];
    const hook = normalizeCommercePlanHook(item.hook, direction);
    const publishingCopy = normalizeCommercePublishingCopy(item.publishingCopy);
    if (!hook || !publishingCopy) throw new Error(`“${commerceDirectionLabel(direction)}”缺少合法的钩子或发布文案。`);
    const hookPair = `${hook.visualPatternId}:${hook.copyPatternId}`;
    if (seenHookPairs.has(hookPair)) throw new Error("批量方案不能重复使用完全相同的视觉与话术钩子组合。");
    validateCommercePlanContent(prompt, hook, publishingCopy);
    seen.add(direction);
    seenHookPairs.add(hookPair);
    return [{
      id: text(item.id, 120) || commerceId("plan"),
      direction,
      title: text(item.title, 120) || commerceDirectionOptions.find((option) => option.id === direction)?.label || "15 秒带货方案",
      sellingPoint: text(item.sellingPoint, 160),
      prompt,
      referenceBindings: normalizeBindings(item.referenceBindings),
      hook,
      publishingCopy,
      selected: true,
    }];
  });
  if (!plans.length || (expected && plans.length !== expected.size)) throw new Error("助手没有完整返回所选方向的提示词方案。");
  return { kind: "commerce-plan-generation", plans };
}

export function normalizeCommercePlanHook(value: unknown, direction: CanvasCommerceDirection): CanvasCommercePlanHook | undefined {
  const item = object(value, false);
  if (!item) return undefined;
  const visualPatternId = text(item.visualPatternId, 80);
  const copyPatternId = text(item.copyPatternId, 80);
  if (!malaysiaCommerceVisualHookPattern(visualPatternId)
    || !malaysiaCommerceCopyHookPattern(copyPatternId)
    || !isMalaysiaCommerceHookPairCompatible(visualPatternId, copyPatternId, direction)) return undefined;
  const hook = {
    visualPatternId,
    copyPatternId,
    title: text(item.title, 120),
    reason: text(item.reason, 360),
    hookLine: text(item.hookLine, 240),
    onScreenText: text(item.onScreenText, 120),
    scene: text(item.scene, 240),
    visualBeat: text(item.visualBeat, 360),
  };
  return Object.values(hook).every(Boolean) ? hook : undefined;
}

export function normalizeCommercePublishingCopy(value: unknown): TikTokCopyDraft | undefined {
  const record = object(value, false);
  if (!record) return undefined;
  const normalized = normalizeTikTokCopyDraft(record);
  if (!normalized.title || !normalized.caption || normalized.hashtags.length < 4 || normalized.hashtags.length > 6) return undefined;
  return normalized;
}

export function commercePlanNotes(plan: Pick<CanvasCommercePlan, "hook" | "publishingCopy">) {
  const sections = [
    plan.hook ? [
      `钩子：${plan.hook.title}`,
      `选择理由：${plan.hook.reason}`,
      `视觉模式：${plan.hook.visualPatternId}`,
      `话术模式：${plan.hook.copyPatternId}`,
      `首句：${plan.hook.hookLine}`,
      `屏幕短字：${plan.hook.onScreenText}`,
      `场景与首帧：${plan.hook.scene}；${plan.hook.visualBeat}`,
    ].join("\n") : "",
    plan.publishingCopy ? `发布文案：\n${composeTikTokCaption(plan.publishingCopy)}` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function commerceDirectionLabel(direction: CanvasCommerceDirection) {
  return commerceDirectionOptions.find((item) => item.id === direction)?.label || direction;
}

export function commerceDirectionRequiresHuman(direction: CanvasCommerceDirection) {
  return commerceDirectionOptions.find((item) => item.id === direction)?.requiresHuman === true;
}

export function cloneCommercePlanForReuse(plan: CanvasCommercePlan, id = commerceId("plan")): CanvasCommercePlan {
  const clone = { ...plan, id, selected: true };
  delete clone.createdGroupId;
  delete clone.createdPromptNodeId;
  delete clone.createdGeneratorNodeId;
  return clone;
}

export function planCommerceCanvasCreation({
  draft,
  planIds,
  providers,
  existingPlanIds = [],
  imageCount,
}: {
  draft: CanvasCommerceProductDraft;
  planIds: string[];
  providers: CanvasCommerceCreationProvider[];
  existingPlanIds?: Iterable<string>;
  imageCount: number;
}): CanvasCommerceCreationBranch[] {
  const requested = new Set(planIds);
  const existing = new Set(existingPlanIds);
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const plans = draft.plans.filter((plan) => requested.has(plan.id) && !existing.has(plan.id));
  if (!plans.length) return [];
  if (imageCount < 1) throw new Error("产品图片已从画布或素材库中移除，请重新选择。");
  return plans.map((plan) => {
    const provider = plan.providerId ? providersById.get(plan.providerId) : undefined;
    if (!provider) throw new Error(`方案“${plan.title}”尚未选择可用模型。`);
    const capacity = Math.max(1, Math.floor(provider.videoOptions?.maxReferenceImages || 1));
    const imageLimit = Math.min(imageCount, capacity);
    const resolutions = provider.videoOptions?.resolutions?.length
      ? provider.videoOptions.resolutions
      : [provider.videoOptions?.resolution || "720p"];
    const resolution = resolutions.includes("720p")
      ? "720p"
      : resolutions.find((value) => resolutionNumber(value) >= 720) || resolutions[0];
    return {
      plan,
      provider,
      imageLimit,
      omittedImageCount: Math.max(0, imageCount - imageLimit),
      resolution,
    };
  });
}

export function buildCommerceCanvasBranchData({
  branch,
  productId,
  promptNodeId,
  generatorNodeId,
  imageNodeIds,
  createdAt,
}: {
  branch: CanvasCommerceCreationBranch;
  productId: string;
  promptNodeId: string;
  generatorNodeId: string;
  imageNodeIds: string[];
  createdAt: string;
}): {
  promptData: CanvasNodeData;
  generatorData: CanvasNodeData;
  edges: Array<Omit<CanvasStoredEdge, "id">>;
} {
  const connectedImageNodeIds = imageNodeIds.slice(0, branch.imageLimit);
  const promptData: CanvasNodeData = {
    kind: "prompt",
    title: branch.plan.title,
    prompt: branch.plan.prompt,
    notes: commercePlanNotes(branch.plan) || undefined,
    createdAt,
    referenceBindings: branch.plan.referenceBindings.slice(0, connectedImageNodeIds.length),
    assistantProductId: productId,
    assistantPlanId: branch.plan.id,
  };
  const generatorData: CanvasNodeData = {
    kind: "generator",
    title: `${branch.plan.title} · 视频生成`,
    generationKind: "video",
    providerId: branch.provider.id,
    model: branch.provider.model,
    createdAt,
    sourceNodeIds: [promptNodeId, ...connectedImageNodeIds],
    ratio: "9:16",
    ratioAutoAdjusted: true,
    quality: "1k",
    duration: 15,
    resolution: branch.resolution,
    status: "idle",
    progress: 0,
    assistantProductId: productId,
    assistantPlanId: branch.plan.id,
  };
  const edges = [...connectedImageNodeIds, promptNodeId].map((source) => ({
    source,
    sourceHandle: "output",
    target: generatorNodeId,
    targetHandle: "input",
  }));
  return { promptData, generatorData, edges };
}

function validateCommercePlanContent(prompt: string, hook: CanvasCommercePlanHook, publishingCopy: TikTokCopyDraft) {
  if (!prompt.includes(hook.hookLine) || !prompt.includes(hook.onScreenText)) {
    throw new Error("钩子口播和屏幕短字必须原样写入最终提示词。");
  }
  const wordCount = hook.onScreenText.match(/\p{L}+(?:['’-]\p{L}+)*/gu)?.length || 0;
  if (wordCount < 3 || wordCount > 7) throw new Error("马来语屏幕短字必须控制在 3-7 个词。");
  const requiredRanges = [/[0０]\s*[-–—]\s*2\s*秒/u, /2\s*[-–—]\s*7\s*秒/u, /7\s*[-–—]\s*12\s*秒/u, /12\s*[-–—]\s*15\s*秒/u];
  if (requiredRanges.some((range) => !range.test(prompt))) throw new Error("提示词必须完整包含四段 15 秒时间轴。");
  const claimSurface = [prompt.split(/禁止项/u, 1)[0], hook.hookLine, hook.onScreenText, publishingCopy.title, publishingCopy.caption].join("\n");
  if (/(?:价格|便宜|折扣|优惠|促销|清仓|退货|退款|销量|评价|舒适|防滑|耐磨|透气|脚痛|受伤|harga|murah|diskaun|promosi|clearance|refund|return|selesa|anti[- ]?slip|tahan lama|breathable|sakit|cedera)/iu.test(claimSurface)) {
    throw new Error("方案包含当前产品资料无法证明的价格、经历或性能话术。");
  }
  if (hook.copyPatternId === "numbered-specificity") {
    const count = /(?:\b2\b|\bdua\b)/iu.test(`${hook.hookLine} ${hook.onScreenText}`) ? 2
      : /(?:\b3\b|\btiga\b)/iu.test(`${hook.hookLine} ${hook.onScreenText}`) ? 3 : 0;
    const fulfilled = count === 2
      ? /(?:第一|pertama)/iu.test(prompt) && /(?:第二|kedua)/iu.test(prompt)
      : /(?:第一|pertama)/iu.test(prompt) && /(?:第二|kedua)/iu.test(prompt) && /(?:第三|ketiga)/iu.test(prompt);
    if (!count || !fulfilled) {
      throw new Error("数字式钩子必须使用 2 或 3，并在时间轴中兑现相同数量的画面证据。");
    }
  }
}

function normalizeBindings(value: unknown): CanvasReferenceBinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((candidate) => {
    const item = object(candidate, false);
    if (!item) return [];
    const label = text(item.label, 24);
    const role = text(item.role, 24) as CanvasReferenceRole;
    if (!/^@Image\d+$/i.test(label) || !roles.has(role)) return [];
    const transfer = text(item.transfer, 240);
    const ignore = text(item.ignore, 240);
    return [{ label, role, ...(transfer ? { transfer } : {}), ...(ignore ? { ignore } : {}) }];
  });
}

function directionList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => text(item, 40) as CanvasCommerceDirection).filter((item) => directions.has(item)))];
}

function stringList(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => text(item, maxLength)).filter(Boolean))];
}

function object(value: unknown): Record<string, unknown>;
function object(value: unknown, required: false): Record<string, unknown> | null;
function object(value: unknown, required = true): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (required) throw new Error("助手返回格式无效。");
  return null;
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function resolutionNumber(value: string) {
  if (value.toLowerCase() === "4k") return 2160;
  return Number(value.match(/\d+/)?.[0] || 0);
}

function commerceId(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
