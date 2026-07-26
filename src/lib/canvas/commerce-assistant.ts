import type {
  CanvasCommerceAssistantState,
  CanvasCommerceCreativeOption,
  CanvasCommerceCreativeStyle,
  CanvasCommerceDirection,
  CanvasCommercePlan,
  CanvasCommercePlanHook,
  CanvasCommerceProductionRecipe,
  CanvasCommerceProductDraft,
  CanvasCommerceShot,
  CanvasNodeData,
  CanvasReferenceBinding,
  CanvasReferenceRole,
  CanvasStoredEdge,
} from "./types";
import {
  isMalaysiaCommerceCopyHookFormulaSatisfied,
  isMalaysiaCommerceHookPairCompatible,
  isMalaysiaCommerceProductionRecipeCompatible,
  malaysiaCommerceCopyHookPattern,
  malaysiaCommercePerformancePattern,
  malaysiaCommerceScenePattern,
  malaysiaCommerceShotPattern,
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

export function normalizeCommercePlanGeneration(
  value: unknown,
  expectedDirections?: CanvasCommerceDirection[],
  context: {
    visibleFacts?: string[];
    imageCount?: number;
    usedHookPatterns?: Array<{
      direction: CanvasCommerceDirection;
      visualPatternId: string;
      copyPatternId: string;
      scenePatternId?: string;
      shotPatternId?: string;
      performancePatternId?: string;
    }>;
  } = {},
): CanvasCommercePlanGenerationResponse {
  const record = object(value);
  if (record.kind !== "commerce-plan-generation" || !Array.isArray(record.plans)) throw new Error("提示词方案返回格式无效。");
  const expected = expectedDirections ? new Set(expectedDirections) : null;
  const seen = new Set<CanvasCommerceDirection>();
  const seenHookPairs = new Set<string>();
  const seenProductionRecipes = new Set<string>();
  const usedRecipes = new Set((context.usedHookPatterns || []).flatMap((pattern) => pattern.scenePatternId && pattern.shotPatternId && pattern.performancePatternId ? [
    `${pattern.direction}:${pattern.visualPatternId}:${pattern.copyPatternId}:${pattern.scenePatternId}:${pattern.shotPatternId}:${pattern.performancePatternId}`,
  ] : []));
  const plans = record.plans.slice(0, 3).flatMap((candidate) => {
    const item = object(candidate, false);
    if (!item) return [];
    const direction = text(item.direction, 40) as CanvasCommerceDirection;
    if (!directions.has(direction) || seen.has(direction) || (expected && !expected.has(direction))) return [];
    const hook = normalizeCommercePlanHook(item.hook, direction);
    if (!hook) throw new Error(`“${commerceDirectionLabel(direction)}”的钩子模式、话术或首帧字段不合法。`);
    const production = normalizeCommerceProductionRecipe(item.production, direction);
    if (!production) throw new Error(`“${commerceDirectionLabel(direction)}”的场景、镜头节奏或表演模式不兼容。`);
    const shots = normalizeCommerceShots(item.shots, direction, hook);
    if (!shots) throw new Error(`“${commerceDirectionLabel(direction)}”必须返回四个完整镜头，且首镜头口播和屏幕短字必须与钩子完全一致。`);
    const publishingCopy = normalizeCommercePublishingCopy(item.publishingCopy);
    if (!publishingCopy) throw new Error(`“${commerceDirectionLabel(direction)}”的发布文案必须包含马来语标题、正文和 4-6 个有效标签。`);
    const hookPair = `${hook.visualPatternId}:${hook.copyPatternId}`;
    if (seenHookPairs.has(hookPair)) throw new Error("批量方案不能重复使用完全相同的视觉与话术钩子组合。");
    const productionRecipe = `${production.scenePatternId}:${production.shotPatternId}:${production.performancePatternId}`;
    if (seenProductionRecipes.has(productionRecipe)) throw new Error("批量方案不能重复使用完全相同的场景、镜头节奏与表演组合。");
    const completeRecipe = `${direction}:${hookPair}:${productionRecipe}`;
    if (usedRecipes.has(completeRecipe)) throw new Error(`“${commerceDirectionLabel(direction)}”重复使用了历史完整制作配方，请重新分析。`);
    const referenceBindings = normalizeBindings(item.referenceBindings);
    const prompt = composeCommerceSeedancePrompt({
      hook,
      production,
      shots,
      referenceBindings,
      visibleFacts: context.visibleFacts || stringList(item.visibleFacts, 16, 160),
      imageCount: context.imageCount,
    });
    validateCommercePlanContent(prompt, hook, shots, publishingCopy);
    seen.add(direction);
    seenHookPairs.add(hookPair);
    seenProductionRecipes.add(productionRecipe);
    return [{
      id: text(item.id, 120) || commerceId("plan"),
      direction,
      title: text(item.title, 120) || commerceDirectionOptions.find((option) => option.id === direction)?.label || "15 秒带货方案",
      sellingPoint: text(item.sellingPoint, 160),
      prompt,
      referenceBindings,
      hook,
      production,
      shots,
      publishingCopy,
      selected: true,
    }];
  });
  if (!plans.length || (expected && plans.length !== expected.size)) throw new Error("助手没有完整返回所选方向的提示词方案。");
  return { kind: "commerce-plan-generation", plans };
}

export function normalizeCommerceProductionRecipe(value: unknown, direction: CanvasCommerceDirection): CanvasCommerceProductionRecipe | undefined {
  const item = object(value, false);
  if (!item) return undefined;
  const scenePatternId = text(item.scenePatternId, 80);
  const shotPatternId = text(item.shotPatternId, 80);
  const performancePatternId = text(item.performancePatternId, 80);
  if (!malaysiaCommerceScenePattern(scenePatternId)
    || !malaysiaCommerceShotPattern(shotPatternId)
    || !malaysiaCommercePerformancePattern(performancePatternId)
    || !isMalaysiaCommerceProductionRecipeCompatible(scenePatternId, shotPatternId, performancePatternId, direction)) return undefined;
  const energy = text(item.energy, 24) as CanvasCommerceProductionRecipe["energy"];
  const emotionArc = text(item.emotionArc, 360);
  const realismNotes = text(item.realismNotes, 500);
  if (!(["calm", "balanced", "dynamic"] as const).includes(energy) || !emotionArc || !realismNotes) return undefined;
  if (direction === "sport-motion" && energy !== "dynamic") return undefined;
  if (direction === "product-asmr" && energy === "dynamic") return undefined;
  return { scenePatternId, shotPatternId, performancePatternId, energy, emotionArc, realismNotes };
}

export function normalizeCommerceShots(value: unknown, direction: CanvasCommerceDirection, hook?: CanvasCommercePlanHook): CanvasCommerceShot[] | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !hook) return undefined;
  const timeRanges: CanvasCommerceShot["timeRange"][] = ["0-2秒", "2-7秒", "7-12秒", "12-15秒"];
  const shots = value.flatMap((candidate, index) => {
    const item = object(candidate, false);
    const timeRange = text(item?.timeRange, 24).replace(/\s+/gu, "").replace(/[–—]/gu, "-").replace(/s$/iu, "秒");
    if (!item || timeRange !== timeRanges[index]) return [];
    const shot = {
      timeRange: timeRanges[index],
      shotSize: text(item.shotSize, 80),
      camera: text(item.camera, 240),
      action: text(item.action, 360),
      performance: text(item.performance, 360),
      productState: text(item.productState, 300),
      dialogue: text(item.dialogue, 240),
      onScreenText: text(item.onScreenText, 160),
      sound: text(item.sound, 240),
      transition: text(item.transition, 240),
    } satisfies CanvasCommerceShot;
    if (!shot.shotSize || !shot.camera || !shot.action || !shot.performance || !shot.productState || !shot.dialogue || !shot.sound || !shot.transition) return [];
    if (!/(?:全景|中景|近景|特写|极近景|半身|全身|POV|主观)/u.test(shot.shotSize)) return [];
    if (!/(?:固定|推进|后拉|跟拍|侧移|环绕|低机位|手持|俯拍|仰拍|摇镜|主观|POV|匹配剪辑)/u.test(shot.camera)) return [];
    return [shot];
  });
  if (shots.length !== 4) return undefined;
  return shots.map((shot, index) => {
    const dialogue = index === 0 ? hook.hookLine : shot.dialogue;
    return {
      ...shot,
      dialogue,
      onScreenText: dialogue === "无口播" ? "" : dialogue,
    };
  });
}

export function composeCommerceSeedancePrompt({
  hook,
  production,
  shots,
  referenceBindings,
  visibleFacts,
  imageCount,
}: {
  hook: CanvasCommercePlanHook;
  production: CanvasCommerceProductionRecipe;
  shots: CanvasCommerceShot[];
  referenceBindings: CanvasReferenceBinding[];
  visibleFacts: string[];
  imageCount?: number;
}) {
  const references = referenceBindings.length ? referenceBindings : Array.from({ length: Math.max(1, Math.min(4, imageCount || 1)) }, (_, index) => ({
    label: `@Image${index + 1}`,
    role: "product" as const,
    transfer: "鞋子真实外观、配色和可见结构",
    ignore: "原图背景、文字和不可验证信息",
  }));
  const referenceText = references.map((binding) => `${binding.label}：${binding.transfer || "产品外观"}；不继承${binding.ignore || "原图背景"}`).join("\n");
  const facts = visibleFacts.length ? visibleFacts.map((fact) => `- ${fact}`).join("\n") : "- 只使用参考图可直接核对的鞋型、配色和结构";
  const visualPattern = malaysiaCommerceVisualHookPattern(hook.visualPatternId);
  const copyPattern = malaysiaCommerceCopyHookPattern(hook.copyPatternId);
  const scenePattern = malaysiaCommerceScenePattern(production.scenePatternId);
  const shotPattern = malaysiaCommerceShotPattern(production.shotPatternId);
  const performancePattern = malaysiaCommercePerformancePattern(production.performancePatternId);
  const energyGuidance = production.energy === "dynamic"
    ? "剪辑紧凑但动作完整，脚步强拍驱动切镜，跟拍有真实加减速和轻微惯性"
    : production.energy === "balanced"
      ? "节奏有起伏，揭示段加快、证据段放稳，镜头运动有清楚起止"
      : "节奏克制，依靠触感声和细节变化维持注意力，运镜平稳且不僵硬";
  const openingVoice = `开头口播“${hook.hookLine}”，同步字幕逐字使用“${hook.onScreenText}”`;
  const shotText = shots.map((shot, index) => [
    `镜头 ${index + 1}｜${shot.timeRange}｜${shot.shotSize}`,
    `动作：${shot.action}`,
    `人物与情绪：${shot.performance}`,
    `产品状态：${shot.productState}`,
    `镜头：${shot.camera}`,
    `台词/旁白：${shot.dialogue}`,
    `屏幕短字：${shot.onScreenText || "无"}`,
    `声音：${shot.sound}`,
    `转场：${shot.transition}`,
  ].join("\n")).join("\n\n");
  return [
    "素材职责：",
    referenceText,
    "产品可见事实：",
    facts,
    `开头机制：${visualPattern?.label || hook.visualPatternId} + ${copyPattern?.label || hook.copyPatternId}。${hook.reason}`,
    `场景与当地细节：${scenePattern?.setting || hook.scene}；${scenePattern?.localDetails || hook.scene}。动作边界：${scenePattern?.movementBoundary || "只做与鞋型匹配的低风险动作"}。`,
    `镜头节奏：${shotPattern?.label || production.shotPatternId}。${shotPattern?.cameraRhythm || "四个镜头景别清楚变化"}。转场原则：${shotPattern?.transitionRule || "只使用由人物动作触发的自然转场"}。`,
    `动感强度：${production.energy}。${energyGuidance}。`,
    `情绪弧线：${production.emotionArc}`,
    `表演基准：${performancePattern?.performance || production.realismNotes}。情绪参考：${performancePattern?.emotionArc || production.emotionArc}。`,
    `真人真实感：${production.realismNotes}。9:16 原生手机短视频观感；马来西亚当地成年人物像真实生活中的普通人，不是完美广告模特。保留自然皮肤纹理、轻微出汗或碎发、衣服轻微褶皱、眨眼、呼吸、视线转移、重心变化和动作惯性；普通公寓、商场、遮雨走廊或公园允许少量背景杂物、自然人流、轻微手持微抖和曝光调整，禁止塑料皮肤、过度磨皮、完美影棚布光和空无一人的豪华广告场景；鞋子结构、配色、左右脚和参考图全程一致。`,
    "承上启下与连续性：镜头 1 提出可见问题或信息缺口；镜头 2 必须承接镜头 1 的人物、产品和动作状态并揭示答案；镜头 3 延续同一动作或结果，用不同景别提供证据；镜头 4 延续已证明的状态闭合开头并 CTA。上一镜头结束状态就是下一镜头开始状态，人物、服装、鞋子穿着状态、动作方向、情绪和场景不得跳变；每次转场必须由动作、遮挡、落点或声音桥接。",
    "四镜头分镜脚本：",
    shotText,
    `声音/口播：从第 0 秒开始；${openingVoice}；最多三句短马来语，每个有口播镜头的屏幕字幕必须与该镜头台词逐字相同，无口播镜头才不显示字幕；动作声与节拍承担中段情绪。`,
    "禁止项：优惠钩子不得出现具体金额、百分比、降价幅度、限时、库存或销量；不得虚构评价、品牌、材料、舒适、防滑、耐磨、透气或健康功效；不得使用危险动作、事故、受伤、街头骚扰；不得出现僵硬口型、广告式连续点头、塑料皮肤、过度磨皮、完美影棚布光、漂浮滑步、无重力步态、肢体畸变、鞋子变形、文字乱码或无动机炫技运镜。",
  ].join("\n\n").slice(0, 8_000);
}

export function normalizeCommercePlanHook(value: unknown, direction: CanvasCommerceDirection): CanvasCommercePlanHook | undefined {
  const item = object(value, false);
  if (!item) return undefined;
  const visualPatternId = text(item.visualPatternId, 80);
  const copyPatternId = text(item.copyPatternId, 80);
  if (!malaysiaCommerceVisualHookPattern(visualPatternId)
    || !malaysiaCommerceCopyHookPattern(copyPatternId)
    || !isMalaysiaCommerceHookPairCompatible(visualPatternId, copyPatternId, direction)) return undefined;
  const hookLine = text(item.hookLine, 240);
  if (!isMalaysiaCommerceCopyHookFormulaSatisfied(copyPatternId, hookLine)) return undefined;
  const hook = {
    visualPatternId,
    copyPatternId,
    title: text(item.title, 120),
    reason: text(item.reason, 360),
    hookLine,
    onScreenText: hookLine,
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

function validateCommercePlanContent(prompt: string, hook: CanvasCommercePlanHook, shots: CanvasCommerceShot[], publishingCopy: TikTokCopyDraft) {
  if (!prompt.includes(hook.hookLine) || !prompt.includes(hook.onScreenText)) {
    throw new Error("钩子口播和屏幕短字必须原样写入最终提示词。");
  }
  const wordCount = hook.onScreenText.match(/\p{L}+(?:['’-]\p{L}+)*/gu)?.length || 0;
  if (wordCount < 3 || wordCount > 7) throw new Error("马来语屏幕短字必须控制在 3-7 个词。");
  if (!isMalaysiaCommerceCopyHookFormulaSatisfied(hook.copyPatternId, hook.hookLine)) {
    throw new Error("钩子首句没有实际使用所选话术公式。");
  }
  const spokenShots = shots.filter((shot) => shot.dialogue !== "无口播");
  if (spokenShots.length > 3) throw new Error("15 秒视频最多只能有三句短马来语口播。");
  if (spokenShots.some((shot) => shot.onScreenText !== shot.dialogue)
    || shots.some((shot) => shot.dialogue === "无口播" && shot.onScreenText)) {
    throw new Error("每句马来语口播的字幕必须与口播逐字相同，无口播镜头不得显示字幕。");
  }
  if (hook.visualPatternId === "middle-of-action") {
    const openingVisual = `${hook.visualBeat}\n${shots[0]?.action || ""}\n${shots[0]?.performance || ""}`;
    const hasVisibleTension = /(?:问题|困扰|犹豫|拿错|配错|不协调|反差|落差|异常|遮挡|卡住|误拿|比较|差别|线索|发现|忘记|来不及)/u.test(openingVisual);
    if (!hasVisibleTension) {
      throw new Error("系鞋带、站起、走路或拿起鞋只是动作，不是钩子；首帧还必须呈现可见问题、冲突、反差或信息缺口。");
    }
  }
  const invalidTransition = shots.slice(0, 3).find((shot) => /(?:直接|然后)?切到(?:下一个|下一)镜头|普通切换|自然切换/u.test(shot.transition));
  if (invalidTransition) throw new Error("镜头之间必须用动作、遮挡、落点或声音桥接，不能只写切到下一镜头。");
  const bridgePattern = /(?:动作|遮挡|落点|脚步|前景|移开|经过|转动|提示音|声音|强拍|匹配|节拍|光影|后拉|推进|跟随|连续)/u;
  if (shots.slice(0, 3).some((shot) => !bridgePattern.test(shot.transition))) {
    throw new Error("前三个镜头的转场必须明确承接人物动作、产品状态或声音节拍。");
  }
  let shoesAreWorn = false;
  for (const shot of shots) {
    if (/(?:已穿|穿着|双脚.*目标鞋|目标鞋.*上脚)/u.test(shot.productState)) shoesAreWorn = true;
    if (shoesAreWorn && /(?:未穿|尚未穿)/u.test(shot.productState)) {
      throw new Error("鞋子从已穿状态跳回未穿状态，四镜头产品状态不连续。");
    }
  }
  const requiredRanges = [/[0０]\s*[-–—]\s*2\s*秒/u, /2\s*[-–—]\s*7\s*秒/u, /7\s*[-–—]\s*12\s*秒/u, /12\s*[-–—]\s*15\s*秒/u];
  if (requiredRanges.some((range) => !range.test(prompt))) throw new Error("提示词必须完整包含四段 15 秒时间轴。");
  const shotClaims = shots.flatMap((shot) => [shot.action, shot.productState, shot.dialogue, shot.onScreenText]).join("\n");
  const claimSurface = [shotClaims, hook.hookLine, hook.onScreenText, publishingCopy.title, publishingCopy.caption].join("\n");
  const unsupportedClaim = claimSurface.match(/(?:价格|原价|现价|限时|库存|清仓|退货|退款|销量|评价|舒适|防滑|耐磨|透气|脚痛|受伤|harga|limited[ -]?time|stok|stock|clearance|refund|return|selesa|anti[- ]?slip|tahan lama|breathable|sakit|cedera)/iu)?.[0];
  if (unsupportedClaim) {
    throw new Error(`方案包含当前产品资料无法证明的话术“${unsupportedClaim}”。`);
  }
  const numericPromotion = claimSurface.match(/(?:\b(?:RM|MYR)\s*\d|[¥￥$]\s*\d|\d+(?:\.\d+)?\s*(?:%|折|off\b)|(?:折扣|优惠|促销|降价|diskaun|promosi|discount).{0,12}\d)/iu)?.[0];
  if (numericPromotion) throw new Error("优惠钩子不得包含具体金额、百分比或降价数字。");
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
