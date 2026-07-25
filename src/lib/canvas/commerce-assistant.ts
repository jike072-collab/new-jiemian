import type {
  CanvasCommerceAssistantState,
  CanvasCommerceDirection,
  CanvasCommercePlan,
  CanvasCommerceProductDraft,
  CanvasNodeData,
  CanvasReferenceBinding,
  CanvasReferenceRole,
  CanvasStoredEdge,
} from "./types";

export const commerceDirectionOptions: Array<{
  id: CanvasCommerceDirection;
  label: string;
  detail: string;
  requiresHuman: boolean;
}> = [
  { id: "human-wear", label: "真人上脚", detail: "真人自然穿着与动作展示", requiresHuman: true },
  { id: "sport-motion", label: "运动动态", detail: "以一个运动动作呈现鞋型和动态视觉", requiresHuman: true },
  { id: "daily-style", label: "日常穿搭", detail: "贴近马来西亚日常场景的穿搭展示", requiresHuman: true },
  { id: "product-asmr", label: "产品细节 / ASMR", detail: "产品近景、可见结构与声音细节", requiresHuman: false },
  { id: "handheld", label: "手持展示", detail: "手部拿取和转动产品；有包装证据时才允许开箱", requiresHuman: false },
  { id: "malay-review", label: "马来语口播", detail: "自然马来语口播和产品展示", requiresHuman: true },
];

const directions = new Set(commerceDirectionOptions.map((item) => item.id));
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
  };
}

export function normalizeCommercePlanGeneration(value: unknown, expectedDirections?: CanvasCommerceDirection[]): CanvasCommercePlanGenerationResponse {
  const record = object(value);
  if (record.kind !== "commerce-plan-generation" || !Array.isArray(record.plans)) throw new Error("提示词方案返回格式无效。");
  const expected = expectedDirections ? new Set(expectedDirections) : null;
  const seen = new Set<CanvasCommerceDirection>();
  const plans = record.plans.slice(0, 3).flatMap((candidate) => {
    const item = object(candidate, false);
    if (!item) return [];
    const direction = text(item.direction, 40) as CanvasCommerceDirection;
    const prompt = text(item.prompt, 8_000);
    if (!directions.has(direction) || seen.has(direction) || (expected && !expected.has(direction)) || !prompt) return [];
    seen.add(direction);
    return [{
      id: text(item.id, 120) || commerceId("plan"),
      direction,
      title: text(item.title, 120) || commerceDirectionOptions.find((option) => option.id === direction)?.label || "15 秒带货方案",
      sellingPoint: text(item.sellingPoint, 160),
      prompt,
      referenceBindings: normalizeBindings(item.referenceBindings),
      selected: true,
    }];
  });
  if (!plans.length || (expected && plans.length !== expected.size)) throw new Error("助手没有完整返回所选方向的提示词方案。");
  return { kind: "commerce-plan-generation", plans };
}

export function commerceDirectionLabel(direction: CanvasCommerceDirection) {
  return commerceDirectionOptions.find((item) => item.id === direction)?.label || direction;
}

export function commerceDirectionRequiresHuman(direction: CanvasCommerceDirection) {
  return commerceDirectionOptions.find((item) => item.id === direction)?.requiresHuman === true;
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
