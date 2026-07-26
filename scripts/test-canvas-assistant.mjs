#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/canvas/assistant/route.ts");
const service = read("src/lib/server/canvas-assistant.ts");
const assistantTypes = read("src/lib/canvas/assistant.ts");
const assistantMedia = read("src/lib/server/canvas-assistant-media.ts");
const optimizer = read("src/lib/server/prompts/optimizer.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const commercePanel = read("src/components/canvas/canvas-commerce-assistant.tsx");
const commerceContract = read("src/lib/canvas/commerce-assistant.ts");
const hookLibrarySource = read("src/lib/malaysia-commerce-video-hook-library.ts");
const { canvasAssistantVideoTimestamps, localCanvasAssistantFallback, normalizeCanvasAssistantResponse, restrictCanvasAssistantResponse } = await import(new URL("../src/lib/canvas/assistant.ts", import.meta.url));
const { resolveCanvasAssistantMediaFocus } = await import(new URL("../src/lib/canvas/assistant-focus.ts", import.meta.url));
const { inferSeedancePromptMode, seedancePromptGuidance, seedanceReferenceIssues } = await import(new URL("../src/lib/seedance/prompt-guidance.ts", import.meta.url));
const { isTikTokShopVideoRequest, tiktokShopVideoGuidance, tiktokShopVideoTiming } = await import(new URL("../src/lib/tiktok-shop-video-guidance.ts", import.meta.url));
const {
  buildCommerceCanvasBranchData,
  cloneCommercePlanForReuse,
  normalizeCommercePlanGeneration,
  normalizeCommerceProductAnalysis,
  planCommerceCanvasCreation,
} = await import(new URL("../src/lib/canvas/commerce-assistant.ts", import.meta.url));
const {
  isMalaysiaCommerceHookPairCompatible,
  isMalaysiaCommerceProductionRecipeCompatible,
  malaysiaCommerceCopyHookPatterns,
  malaysiaCommercePerformancePatterns,
  malaysiaCommerceScenePatterns,
  malaysiaCommerceShotPatterns,
  malaysiaCommerceVisualHookPatterns,
} = await import(new URL("../src/lib/malaysia-commerce-video-hook-library.ts", import.meta.url));

assert.match(route, /isInternalCanvasHostname/);
assert.match(route, /getInternalCanvasAccess/);
assert.match(route, /requireCsrf/);
assert.match(route, /getInternalCanvasWorkspaceMemberIds/);
assert.match(route, /buildCanvasAssistantVisualEvidence/);
assert.match(service, /禁止自动提交任何生成任务/);
assert.match(service, /replace_selected_prompt/);
assert.match(service, /add_generator/);
assert.match(service, /connect_nodes/);
assert.match(service, /group_nodes/);
assert.match(service, /禁止输出删除、运行生成/);
assert.match(service, /timeoutMs: 45_000/);
assert.match(service, /canvasAssistantRetryDelayMs/);
assert.match(service, /error\.retryable/);
assert.match(service, /canvas_assistant_failed/);
assert.match(service, /upstreamStatus/);
assert.match(service, /upstreamBody/);
assert.match(service, /localCanvasAssistantFallback/);
assert.match(service, /seedanceCanvasAssistantRules/);
assert.match(service, /seedanceTaskGuidance/);
assert.match(service, /tiktokShopTaskGuidance/);
assert.match(service, /visualEvidence/);
assert.match(service, /准确 @ImageN、@VideoN、@AudioN 标签/);
assert.match(service, /attachUnambiguousPromptTargets/);
assert.match(service, /targetGeneratorId/);
assert.match(service, /@Video\\d\+/);
assert.match(service, /用户明确说出的目标和关注点具有最高优先级/);
assert.match(service, /原对象不存在时目标物也必须不存在/);
assert.match(service, /光脚一侧保持光脚/);
assert.match(assistantMedia, /resolveLibraryMediaForOwners/);
assert.match(assistantMedia, /spawn\("ffmpeg"/);
assert.match(assistantMedia, /maxEvidenceItems = 8/);
assert.match(assistantMedia, /canvasAssistantVideoTimestamps/);
assert.match(assistantMedia, /canvasAssistantVideoTimestamps\(duration, message\)/);
assert.match(assistantMedia, /加密采样视频前段/);
assert.match(optimizer, /promptUserContent/);
assert.match(optimizer, /image_url/);
assert.match(assistantTypes, /sourceActions.*slice\(0, 8\)/);
assert.doesNotMatch(service, /apiKey|Authorization|child_process|exec\(/);
assert.match(workspace, /CanvasAssistantPanel/);
assert.match(workspace, /flowRef\.current\.setCenter/);
const assistantPanel = read("src/components/canvas/canvas-assistant-panel.tsx");
const assistantUi = `${assistantPanel}\n${commercePanel}`;
assert.match(assistantPanel, /submitMessage/);
assert.match(assistantPanel, /提示词生成/);
assert.match(assistantPanel, /参考图替换/);
assert.match(assistantPanel, /分析提示词/);
assert.match(assistantPanel, /分析结果/);
assert.match(assistantPanel, /创建提示词和视频节点/);
assert.match(assistantPanel, /phase === "preview"/);
assert.match(assistantPanel, /分析中/);
assert.match(assistantPanel, /可编辑预览/);
assert.match(assistantPanel, /待分析/);
assert.match(assistantUi, /selectedNodeIds: selectedIds/);
assert.match(assistantUi, /referenceBindings/);
assert.match(assistantPanel, /mentionSelection/);
assert.match(assistantPanel, /onMentionModeChange\(Boolean\(mentionQuery\)\)/);
assert.match(assistantPanel, /contextNodes\.find\(\(candidate\) => candidate\.id === mentionSelection\.nodeId\)/);
assert.match(assistantPanel, /mentionSelection\.revision <= handledMentionRevisionRef\.current/);
assert.match(commercePanel, /分析产品/);
assert.match(commerceContract, /真人上脚/);
assert.match(service, /Bahasa Melayu/);
assert.match(commercePanel, /commerce-product-analysis/);
assert.match(commercePanel, /commerce-plan-generation/);
assert.doesNotMatch(commercePanel, /canvas-assistant__creative-picker/);
assert.doesNotMatch(commercePanel, /selectedCreativeOptionId/);
assert.doesNotMatch(commercePanel, /creativeOption: selectedCreativeOption/);
assert.match(commercePanel, /usedHookPatterns/);
assert.match(commercePanel, /canvas-assistant__plan-hook/);
assert.match(commercePanel, /4 镜头分镜脚本/);
assert.match(commercePanel, /马来语发布包/);
assert.match(commercePanel, /全部方案共用模型/);
assert.match(commercePanel, /创建选中方案节点/);
assert.match(commercePanel, /重新分析/);
assert.match(commercePanel, /复用为新节点/);
assert.match(commercePanel, /uncreatedDirections/);
assert.match(commercePanel, /不会自动提交视频生成/);
assert.match(commercePanel, /options\.durations\?\.includes\(15\)/);
assert.match(commercePanel, /options\.ratios\?\.includes\("9:16"\)/);
assert.match(commercePanel, /resolutionNumber\(resolution\) >= 720/);
assert.match(commercePanel, /humanReferencePolicy === "allowed"/);
assert.match(service, /scope: normalized\.scope/);
assert.match(assistantPanel, /createVideoGenerator: true/);
assert.match(service, /0-2 秒/);
assert.match(service, /4-8 条简体中文卖点/);
assert.match(service, /禁止推断舒适、防滑、耐磨、真皮/);
assert.match(commerceContract, /recommendedDirections/);
assert.match(workspace, /applyAssistantActions/);
assert.match(workspace, /assistantNodeContexts/);
assert.match(workspace, /referenceLabels/);
assert.match(workspace, /libraryItemId/);
assert.match(workspace, /action\.targetGeneratorId/);
assert.match(workspace, /action\.createVideoGenerator/);
assert.match(workspace, /sourceEdges/);
assert.match(workspace, /action\.type === "add_generator"/);
assert.match(workspace, /action\.type === "select_nodes"/);
assert.match(workspace, /action\.type === "connect_nodes"/);
assert.match(workspace, /action\.type === "group_nodes"/);
assert.match(workspace, /action\.type === "ungroup"/);
assert.match(workspace, /assistantMentionMode/);
assert.match(workspace, /onClickCapture=\{\(event\) => \{/);
assert.match(workspace, /setAssistantMentionSelection/);
assert.match(workspace, /node\.data\.kind === "group"/);
assert.match(canvasCss, /is-assistant-mentioning \.canvas-node:hover/);
assert.match(canvasCss, /grid-template-columns: minmax\(0, 96px\) minmax\(0, 1fr\)/);
assert.match(canvasCss, /\.canvas-assistant__quick\s*\{[^}]*flex-wrap: wrap/s);
assert.match(canvasCss, /\.canvas-assistant__direction-grid/);
assert.match(workspace, /createCommercePlanNodes/);
assert.match(workspace, /assistantProductId/);
assert.match(workspace, /assistantPlanId/);
assert.match(commerceContract, /ratio: "9:16"/);
assert.match(commerceContract, /duration: 15/);
assert.match(commerceContract, /notes: commercePlanNotes/);
assert.match(hookLibrarySource, /没有价格和促销字段时禁止任何价格、折扣、库存或退货话术/);

const allHookPatterns = [...malaysiaCommerceVisualHookPatterns, ...malaysiaCommerceCopyHookPatterns];
assert.equal(new Set(malaysiaCommerceVisualHookPatterns.map((pattern) => pattern.id)).size, malaysiaCommerceVisualHookPatterns.length);
assert.equal(new Set(malaysiaCommerceCopyHookPatterns.map((pattern) => pattern.id)).size, malaysiaCommerceCopyHookPatterns.length);
assert.equal(allHookPatterns.every((pattern) => pattern.directions.length && pattern.firstFrame && pattern.spokenRule && pattern.textRule && pattern.audio && pattern.evidence && pattern.safety && pattern.prohibited), true);
assert.equal(malaysiaCommerceVisualHookPatterns.every((pattern) => !/(?:跳下|崴脚|投掷液体|倒地|受伤动物)/u.test(pattern.mechanism)), true);
assert.equal(isMalaysiaCommerceHookPairCompatible("product-asmr-detail", "expectation-gap", "product-asmr"), true);
assert.equal(isMalaysiaCommerceHookPairCompatible("barrier-pov", "numbered-specificity", "sport-motion"), false);
assert.equal(new Set(malaysiaCommerceScenePatterns.map((pattern) => pattern.id)).size, malaysiaCommerceScenePatterns.length);
assert.equal(new Set(malaysiaCommerceShotPatterns.map((pattern) => pattern.id)).size, malaysiaCommerceShotPatterns.length);
assert.equal(new Set(malaysiaCommercePerformancePatterns.map((pattern) => pattern.id)).size, malaysiaCommercePerformancePatterns.length);
assert.equal(isMalaysiaCommerceProductionRecipeCompatible("condo-entry-mirror", "problem-reveal-proof-result", "candid-curiosity", "daily-style"), true);
assert.equal(isMalaysiaCommerceProductionRecipeCompatible("studio-tactile-table", "macro-pullback-rotate-hero", "quiet-tactile-focus", "sport-motion"), false);
for (const direction of ["human-wear", "sport-motion", "daily-style", "product-asmr", "handheld", "malay-review"]) {
  const compatibleCounts = [malaysiaCommerceVisualHookPatterns, malaysiaCommerceCopyHookPatterns, malaysiaCommerceScenePatterns, malaysiaCommerceShotPatterns, malaysiaCommercePerformancePatterns]
    .map((patterns) => patterns.filter((pattern) => pattern.directions.includes(direction)).length);
  assert.equal(compatibleCounts.reduce((total, count) => total * count, 1) >= 1_000, true, `${direction} should have at least 1000 five-axis recipes`);
}

const commerceCreativeOptions = [
  { id: "hook-1", style: "pain-point", title: "穿搭不够醒目", hookLine: "Outfit nampak terlalu biasa?", scene: "马来西亚公寓玄关", visualBeat: "人物看向镜中普通穿搭后立即抬起鞋子" },
  { id: "hook-2", style: "contrast", title: "粉色细节点亮穿搭", hookLine: "Tengok beza bila tukar kasut.", scene: "吉隆坡商场走廊", visualBeat: "踩点前后穿搭切换" },
  { id: "hook-3", style: "motion", title: "公园快走前后", hookLine: "Kasut mana ngam untuk jalan hari ni?", scene: "马来西亚公园遮雨步道", visualBeat: "人物看着鞋架犹豫，准备出门却还没穿目标鞋" },
];

assert.deepEqual(normalizeCommerceProductAnalysis({
  kind: "commerce-product-analysis",
  sameProduct: true,
  suggestedName: "复古厚底系带鞋",
  sellingPoints: ["厚底视觉", "复古配色", "鞋面拼接层次", "系带结构"],
  visibleFacts: ["米白色鞋面", "深色鞋底"],
  recommendedDirections: ["daily-style", "product-asmr"],
  creativeOptions: commerceCreativeOptions,
}), {
  kind: "commerce-product-analysis",
  sameProduct: true,
  conflictMessage: undefined,
  suggestedName: "复古厚底系带鞋",
  sellingPoints: ["厚底视觉", "复古配色", "鞋面拼接层次", "系带结构"],
  visibleFacts: ["米白色鞋面", "深色鞋底"],
  recommendedDirections: ["daily-style", "product-asmr"],
  creativeOptions: commerceCreativeOptions,
});

assert.deepEqual(normalizeCommerceProductAnalysis({
  kind: "commerce-product-analysis",
  sameProduct: true,
  sellingPoints: ["厚底视觉", "复古配色", "鞋面拼接层次", "系带结构"],
  visibleFacts: ["米白色鞋面"],
  recommendedDirections: ["daily-style"],
}), {
  kind: "commerce-product-analysis",
  sameProduct: true,
  conflictMessage: undefined,
  suggestedName: "",
  sellingPoints: ["厚底视觉", "复古配色", "鞋面拼接层次", "系带结构"],
  visibleFacts: ["米白色鞋面"],
  recommendedDirections: ["daily-style"],
});

const commerceHook = {
  visualPatternId: "product-asmr-detail",
  copyPatternId: "expectation-gap",
  title: "拼接细节预期落差",
  reason: "微距动作可以直接兑现可见拼接层次。",
  hookLine: "Tak sangka detail ni menyerlah",
  onScreenText: "Detail ni memang menyerlah",
  scene: "室内产品桌面",
  visualBeat: "第一帧手指已经轻触鞋面拼接。",
};
const commercePublishingCopy = {
  title: "Detail dia terus tarik mata",
  caption: "Lapisan pada bahagian atas nampak jelas dari dekat. Korang suka detail macam ni?",
  hashtags: ["#kasut", "#shoes", "#sneakers", "#fyp"],
  angle: "detail",
  category: "casual",
};
const commerceProduction = {
  scenePatternId: "studio-tactile-table",
  shotPatternId: "macro-pullback-rotate-hero",
  performancePatternId: "quiet-tactile-focus",
  energy: "balanced",
  emotionArc: "细节吸引到结构确认，再到完整鞋型的视觉满足",
  realismNotes: "真实手部轻触，保留自然停顿和材质摩擦声，不做破坏测试",
};
const commerceShots = [
  { timeRange: "0-2秒", shotSize: "极近景", camera: "固定微距", action: "手指轻触鞋面拼接后停住", performance: "手部力度轻，发现细节后停顿半拍", productState: "鞋子静置，拼接处清楚可见", dialogue: "无口播", onScreenText: commerceHook.onScreenText, sound: "第 0 秒开始轻触和布面摩擦声", transition: "在摩擦声强拍处开始后拉" },
  { timeRange: "2-7秒", shotSize: "近景", camera: "快速后拉", action: "手扶鞋跟让完整鞋型进入画面", performance: "手部自然重新调整握持位置", productState: "完整侧面轮廓出现且配色不变", dialogue: "无口播", onScreenText: "", sound: "后拉时音乐节拍进入", transition: "手部转动动作连续进入下一镜头" },
  { timeRange: "7-12秒", shotSize: "特写", camera: "短推进", action: "手部转动鞋子展示第二处拼接", performance: "动作放慢，在结构清楚时停住", productState: "鞋面和鞋带结构保持一致", dialogue: "无口播", onScreenText: "", sound: "鞋带轻响和一次提示音", transition: "提示音强拍切到稳定正侧面" },
  { timeRange: "12-15秒", shotSize: "中近景", camera: "固定机位", action: "双手把鞋子放回桌面并退出画面", performance: "动作平稳收势，不做广告式指点", productState: "鞋子完整正侧面稳定展示", dialogue: "无口播", onScreenText: "Korang suka detail macam ni?", sound: "音乐轻收束和桌面落放声", transition: "稳定停留到结束" },
];
const commercePrompt = "素材职责：@Image1 提供产品外观。产品可见事实：鞋面拼接层次。0-2 秒：手指轻触拼接，同时说‘Tak sangka detail ni menyerlah’，屏幕短字‘Detail ni memang menyerlah’；2-7 秒：后拉展示完整鞋型；7-12 秒：切换另一处拼接近景；12-15 秒：完整产品收束。声音/口播：从第 0 秒开始轻触声。禁止项：不虚构价格、折扣或性能。";

const normalizedCommercePlan = normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{
    id: "plan-1",
    direction: "product-asmr",
    title: "细节方案",
    sellingPoint: "鞋面拼接层次",
    hook: commerceHook,
    production: commerceProduction,
    shots: commerceShots,
    prompt: commercePrompt,
    referenceBindings: [{ label: "@Image1", role: "product", transfer: "产品外观", ignore: "背景" }],
    publishingCopy: commercePublishingCopy,
  }],
}, ["product-asmr"]);
assert.equal(normalizedCommercePlan.plans.length, 1);
assert.match(normalizedCommercePlan.plans[0].prompt, /镜头 1｜0-2秒｜极近景/);
assert.match(normalizedCommercePlan.plans[0].prompt, /人物与情绪/);
assert.match(normalizedCommercePlan.plans[0].prompt, /固定微距/);

assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "product-asmr", prompt: commercePrompt, hook: { ...commerceHook, visualPatternId: "unknown" }, production: commerceProduction, shots: commerceShots, publishingCopy: commercePublishingCopy }],
}, ["product-asmr"]), /合法的钩子/);
assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "sport-motion", prompt: commercePrompt, hook: commerceHook, production: commerceProduction, shots: commerceShots, publishingCopy: commercePublishingCopy }],
}, ["sport-motion"]), /合法的钩子/);
assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "product-asmr", hook: commerceHook, production: commerceProduction, shots: commerceShots.map((shot, index) => index ? shot : { ...shot, onScreenText: "别的短字" }), publishingCopy: commercePublishingCopy }],
}, ["product-asmr"]), /四镜头脚本/);
assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "product-asmr", hook: commerceHook, production: commerceProduction, shots: commerceShots.map((shot, index) => index ? shot : { ...shot, camera: "高级电影感" }), publishingCopy: commercePublishingCopy }],
}, ["product-asmr"]), /四镜头脚本/);
assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{
    direction: "product-asmr",
    hook: { ...commerceHook, copyPatternId: "numbered-specificity", hookLine: "Dua detail terus menyerlah", onScreenText: "Dua detail terus menyerlah" },
    production: commerceProduction,
    shots: commerceShots.map((shot, index) => index ? shot : { ...shot, onScreenText: "Dua detail terus menyerlah" }),
    publishingCopy: commercePublishingCopy,
  }],
}, ["product-asmr"]), /兑现相同数量/);
assert.throws(() => normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "product-asmr", hook: commerceHook, production: commerceProduction, shots: commerceShots, publishingCopy: commercePublishingCopy }],
}, ["product-asmr"], {
  usedHookPatterns: [{
    direction: "product-asmr",
    visualPatternId: commerceHook.visualPatternId,
    copyPatternId: commerceHook.copyPatternId,
    scenePatternId: commerceProduction.scenePatternId,
    shotPatternId: commerceProduction.shotPatternId,
    performancePatternId: commerceProduction.performancePatternId,
  }],
}), /历史完整制作配方/);

const normalizedPublishing = normalizeCommercePlanGeneration({
  kind: "commerce-plan-generation",
  plans: [{ direction: "product-asmr", prompt: commercePrompt, hook: commerceHook, production: commerceProduction, shots: commerceShots, publishingCopy: commercePublishingCopy }],
}, ["product-asmr"]).plans[0].publishingCopy;
assert.equal(normalizedPublishing.hashtags.includes("#fyp"), false);
assert.equal(normalizedPublishing.hashtags.length >= 4 && normalizedPublishing.hashtags.length <= 6, true);

const commerceDraft = {
  id: "product-1",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  images: [
    { nodeId: "source-image-1", title: "主图" },
    { nodeId: "source-image-2", title: "侧面" },
    { nodeId: "source-image-3", title: "鞋底" },
  ],
  productName: "复古系带鞋",
  sellingPoints: ["复古配色", "鞋面拼接", "厚底轮廓", "系带结构"],
  visibleFacts: ["米白色鞋面"],
  recommendedDirections: ["daily-style", "product-asmr"],
  selectedDirections: ["daily-style", "product-asmr"],
  directionSellingPoints: { "daily-style": "复古配色", "product-asmr": "鞋面拼接" },
  creativeOptions: commerceCreativeOptions,
  selectedCreativeOptionId: "hook-1",
  plans: [
    {
      id: "plan-daily",
      direction: "daily-style",
      title: "日常穿搭",
      sellingPoint: "复古配色",
      prompt: "素材职责；0-2 秒钩子；2-7 秒展示；7-12 秒证据；12-15 秒 CTA。",
      hook: commerceHook,
      production: commerceProduction,
      shots: commerceShots,
      publishingCopy: commercePublishingCopy,
      referenceBindings: [
        { label: "@Image1", role: "product" },
        { label: "@Image2", role: "product" },
        { label: "@Image3", role: "product" },
      ],
      selected: true,
      providerId: "seedance-old",
    },
    {
      id: "plan-detail",
      direction: "product-asmr",
      title: "细节 ASMR",
      sellingPoint: "鞋面拼接",
      prompt: "素材职责；0-2 秒钩子；2-7 秒展示；7-12 秒证据；12-15 秒收束。",
      referenceBindings: [{ label: "@Image1", role: "product" }],
      selected: true,
      providerId: "seedance-new",
    },
  ],
  sharedProviderId: "seedance-old",
  extraRequirements: "",
  phase: "plans-ready",
};
const creationProviders = [
  { id: "seedance-old", model: "seedance-2.0-720p", videoOptions: { maxReferenceImages: 2, resolutions: ["720p", "1080p"] } },
  { id: "seedance-new", model: "seedance-2.0-1080p", videoOptions: { maxReferenceImages: 3, resolution: "1080p" } },
];
const creationBranches = planCommerceCanvasCreation({
  draft: commerceDraft,
  planIds: ["plan-daily", "plan-detail"],
  providers: creationProviders,
  existingPlanIds: ["plan-daily"],
  imageCount: 3,
});
assert.equal(creationBranches.length, 1);
assert.equal(creationBranches[0].plan.id, "plan-detail");
assert.equal(creationBranches[0].imageLimit, 3);
assert.equal(creationBranches[0].omittedImageCount, 0);
assert.equal(creationBranches[0].resolution, "1080p");
assert.deepEqual(planCommerceCanvasCreation({
  draft: commerceDraft,
  planIds: ["plan-daily", "plan-detail"],
  providers: creationProviders,
  existingPlanIds: ["plan-daily", "plan-detail"],
  imageCount: 3,
}), []);

const limitedBranch = planCommerceCanvasCreation({
  draft: commerceDraft,
  planIds: ["plan-daily"],
  providers: creationProviders,
  imageCount: 3,
})[0];
assert.equal(limitedBranch.imageLimit, 2);
assert.equal(limitedBranch.omittedImageCount, 1);
assert.equal(limitedBranch.resolution, "720p");
const branchData = buildCommerceCanvasBranchData({
  branch: limitedBranch,
  productId: commerceDraft.id,
  promptNodeId: "prompt-node-1",
  generatorNodeId: "generator-node-1",
  imageNodeIds: ["image-node-1", "image-node-2", "image-node-3"],
  createdAt: "2026-07-26T00:01:00.000Z",
});
assert.equal(branchData.promptData.referenceBindings.length, 2);
assert.deepEqual(branchData.generatorData.sourceNodeIds, ["prompt-node-1", "image-node-1", "image-node-2"]);
assert.equal(branchData.generatorData.status, "idle");
assert.equal(branchData.generatorData.duration, 15);
assert.equal(branchData.generatorData.ratio, "9:16");
assert.equal(branchData.generatorData.resolution, "720p");
assert.match(branchData.promptData.notes, /拼接细节预期落差/);
assert.match(branchData.promptData.notes, /Detail dia terus tarik mata/);
assert.match(branchData.promptData.notes, /#kasut/);
assert.equal(Object.hasOwn(branchData.generatorData, "jobId"), false);
assert.equal(Object.hasOwn(branchData.generatorData, "generationRequestId"), false);
assert.deepEqual(branchData.edges.map((edge) => edge.source), ["image-node-1", "image-node-2", "prompt-node-1"]);
const reusedPlan = cloneCommercePlanForReuse({
  ...commerceDraft.plans[0],
  createdGroupId: "group-1",
  createdPromptNodeId: "prompt-1",
  createdGeneratorNodeId: "generator-1",
}, "plan-reused");
assert.equal(reusedPlan.id, "plan-reused");
assert.equal(reusedPlan.selected, true);
assert.equal(reusedPlan.providerId, "seedance-old");
assert.equal(Object.hasOwn(reusedPlan, "createdGroupId"), false);
assert.equal(Object.hasOwn(reusedPlan, "createdPromptNodeId"), false);
assert.equal(Object.hasOwn(reusedPlan, "createdGeneratorNodeId"), false);
const reusedBranch = planCommerceCanvasCreation({
  draft: { ...commerceDraft, plans: [...commerceDraft.plans, reusedPlan] },
  planIds: [reusedPlan.id],
  providers: creationProviders,
  existingPlanIds: commerceDraft.plans.map((plan) => plan.id),
  imageCount: 3,
})[0];
const reusedBranchData = buildCommerceCanvasBranchData({
  branch: reusedBranch,
  productId: commerceDraft.id,
  promptNodeId: "prompt-node-reused",
  generatorNodeId: "generator-node-reused",
  imageNodeIds: ["image-node-1", "image-node-2", "image-node-3"],
  createdAt: "2026-07-26T00:02:00.000Z",
});
assert.deepEqual(reusedBranchData.generatorData.sourceNodeIds, ["prompt-node-reused", "image-node-1", "image-node-2"]);
assert.equal(reusedBranchData.generatorData.status, "idle");

assert.deepEqual(normalizeCanvasAssistantResponse({
  reply: "ok",
  actions: [
    { type: "add_prompt", prompt: "测试提示词" },
    { type: "add_generator", generationKind: "video" },
    { type: "select_nodes", nodeIds: ["node-1", "node-1", "node-2"] },
    { type: "connect_nodes", sourceNodeIds: ["node-1"], targetNodeId: "node-3" },
    { type: "group_nodes", nodeIds: ["node-1", "node-2"] },
    { type: "ungroup", groupId: "group-1" },
    { type: "delete_project", id: "forbidden" },
    { type: "organize", layout: "flow" },
  ],
}), {
  reply: "ok",
  actions: [
    { type: "add_prompt", prompt: "测试提示词", title: undefined },
    { type: "add_generator", generationKind: "video" },
    { type: "select_nodes", nodeIds: ["node-1", "node-2"] },
    { type: "connect_nodes", sourceNodeIds: ["node-1"], targetNodeId: "node-3" },
    { type: "group_nodes", nodeIds: ["node-1", "node-2"] },
    { type: "ungroup", groupId: "group-1" },
    { type: "organize", layout: "flow" },
  ],
});

assert.deepEqual(normalizeCanvasAssistantResponse({
  reply: "ok",
  actions: [{ type: "add_prompt", prompt: "马来语提示词", sourceNodeIds: ["image-1", "image-1"], createVideoGenerator: true }],
}).actions[0], {
  type: "add_prompt",
  title: undefined,
  prompt: "马来语提示词",
  sourceNodeIds: ["image-1"],
  createVideoGenerator: true,
});

const normalizedBindings = normalizeCanvasAssistantResponse({
  reply: "ok",
  actions: [{
    type: "add_prompt",
    prompt: "使用 @Image1",
    referenceBindings: [
      { label: "@Image1", role: "product", transfer: "只转移产品外观", ignore: "不转移背景" },
      { label: "Image2", role: "product" },
    ],
  }],
});
assert.deepEqual(normalizedBindings.actions[0].referenceBindings, [{
  label: "@Image1",
  role: "product",
  transfer: "只转移产品外观",
  ignore: "不转移背景",
}]);
assert.equal(restrictCanvasAssistantResponse(normalizeCanvasAssistantResponse({
  reply: "ok",
  actions: [
    { type: "add_prompt", prompt: "第一条" },
    { type: "add_prompt", prompt: "第二条" },
    { type: "add_storyboard", shots: [{ shotId: "SH01", title: "开场", timeRange: "0-2s", prompt: "开场" }] },
  ],
}), "prompt-generation").actions.length, 1);

assert.deepEqual(normalizeCanvasAssistantResponse({
  reply: "连接提示词",
  actions: [{ type: "add_prompt", title: "换物提示词", prompt: "使用 @Video1 与 @Image1", targetGeneratorId: "generator-1" }],
}).actions[0], {
  type: "add_prompt",
  title: "换物提示词",
  prompt: "使用 @Video1 与 @Image1",
  targetGeneratorId: "generator-1",
});

assert.deepEqual(localCanvasAssistantFallback({
  message: "我的画布里面有什么",
  canvasTitle: "新品方案",
  nodes: [
    { kind: "prompt", title: "主提示词" },
    { kind: "media", title: "参考图" },
    { kind: "generator", title: "图片生成" },
  ],
}), {
  reply: "当前画布“新品方案”共有 3 个节点：1 个提示词、1 个素材、1 个生成节点、0 个分组。包括：主提示词、参考图、图片生成。",
  actions: [],
});

assert.deepEqual(localCanvasAssistantFallback({ message: "按网格整理画布" }), {
  reply: "可以按网格整理当前画布。",
  actions: [{ type: "organize", layout: "grid" }],
});

assert.deepEqual(localCanvasAssistantFallback({
  message: "根据当前画布主题，新增一个可直接用于生图的详细提示词。",
  canvasTitle: "新品方案",
  nodes: [{ kind: "prompt", title: "主体", prompt: "白色产品展示" }],
}), {
  reply: "上游助手暂时不可用，我已根据当前画布内容生成一条可继续编辑的提示词。",
  actions: [{
    type: "add_prompt",
    title: "画布助手提示词",
    prompt: "白色产品展示，主体清晰完整，构图有层次，画面重点突出，材质与颜色自然，光线统一，背景干净，不添加未要求的文字、Logo 或额外对象。",
  }],
});

assert.equal(localCanvasAssistantFallback({
  message: "优化选中的提示词",
  nodes: [{ kind: "prompt", title: "主体", prompt: "红色鞋子，白色背景", selected: true }],
}).actions[0].type, "replace_selected_prompt");

assert.equal(localCanvasAssistantFallback({ message: "帮我写一段产品提示词" }).actions[0].type, "add_prompt");

const localStoryboard = localCanvasAssistantFallback({ message: "把当前故事拆成分镜", canvasTitle: "雨夜短片" });
assert.equal(localStoryboard.actions[0].type, "add_storyboard");
assert.equal(localStoryboard.actions[0].shots.length, 3);
const localCommerceStoryboard = localCanvasAssistantFallback({ message: "根据商品图片生成 15 秒 TikTok Shop 带货提示词和分镜", canvasTitle: "新品" });
assert.equal(localCommerceStoryboard.actions[0].type, "add_prompt");
assert.equal(localCommerceStoryboard.actions[1].type, "add_storyboard");
assert.equal(localCommerceStoryboard.actions[1].shots.length, 4);
assert.match(localCommerceStoryboard.actions[0].prompt, /0-2 秒/);
assert.deepEqual(localCanvasAssistantFallback({ message: "继续上一段视频", nodes: [{ kind: "media", title: "未完成视频", mediaType: "video" }] }).actions, []);
assert.equal(localCanvasAssistantFallback({ message: "继续上一段视频", nodes: [{ kind: "media", title: "成功视频", mediaType: "video", sequenceState: { accepted: true } }] }).actions[0].type, "add_prompt");

const localVideoPrompt = localCanvasAssistantFallback({
  message: "根据 @Image1 和 @Video1 写一个 Seedance 视频提示词",
  nodes: [{ kind: "prompt", title: "动作", prompt: "@Image1 中的人物转身，动作参考 @Video1" }],
});
assert.equal(localVideoPrompt.actions[0].title, "Seedance 视频提示词");
assert.match(localVideoPrompt.actions[0].prompt, /一个主要动作/);
assert.match(localVideoPrompt.actions[0].prompt, /已有 @ImageN、@VideoN、@AudioN 标签必须原样保留/);

const localTikTokPrompt = localCanvasAssistantFallback({
  message: "根据当前商品素材写一个马来西亚 TikTok Shop 带货短视频提示词",
  nodes: [{ kind: "prompt", title: "商品", prompt: "红色运动鞋在脚上自然展示" }],
});
assert.equal(localTikTokPrompt.actions[0].title, "TikTok Shop 带货视频提示词");
assert.match(localTikTokPrompt.actions[0].prompt, /0-2 秒/);
assert.match(localTikTokPrompt.actions[0].prompt, /13-15 秒/);
assert.match(localTikTokPrompt.actions[0].prompt, /一个最强且可见的商品价值/);

assert.equal(isTikTokShopVideoRequest({ prompt: "普通电影感短片" }), false);
assert.equal(isTikTokShopVideoRequest({ prompt: "制作 TikTok Shop 鞋类带货视频" }), true);
assert.equal(tiktokShopVideoGuidance({ prompt: "普通电影感短片", duration: 15 }).length, 0);
assert.deepEqual(tiktokShopVideoTiming(5).map((line) => line.match(/^\d+-\d+/)?.[0]), ["0-1", "1-4", "4-5"]);
assert.deepEqual(tiktokShopVideoTiming(15).map((line) => line.match(/^\d+-\d+/)?.[0]), ["0-2", "2-9", "9-13", "13-15"]);
assert.deepEqual(tiktokShopVideoTiming(25).map((line) => line.match(/^\d+-\d+/)?.[0]), ["0-3", "3-13", "13-20", "20-25"]);

const localReplacementPrompt = localCanvasAssistantFallback({
  message: "把视频里的鞋替换成参考图中的鞋",
  nodes: [
    { kind: "media", title: "动作视频", mediaType: "video", referenceLabels: [{ generatorId: "generator-1", label: "@Video2" }] },
    { kind: "media", title: "目标鞋", mediaType: "image", referenceLabels: [{ generatorId: "generator-1", label: "@Image3" }] },
  ],
});
assert.equal(localReplacementPrompt.actions[0].type, "add_prompt");
assert.match(localReplacementPrompt.actions[0].prompt, /@Video2/);
assert.match(localReplacementPrompt.actions[0].prompt, /@Image3/);
assert.match(localReplacementPrompt.actions[0].prompt, /运动模糊/);
assert.match(localReplacementPrompt.actions[0].prompt, /禁止残留原对象/);
assert.match(localReplacementPrompt.actions[0].prompt, /光脚的一侧必须保持光脚/);
assert.match(localReplacementPrompt.actions[0].prompt, /原视频中该侧鞋首次出现时才同步出现替换鞋/);
assert.ok(localReplacementPrompt.actions[0].prompt.length <= 500);
assert.equal((localReplacementPrompt.actions[0].prompt.match(/动作/g) || []).length, 1);

const sampleTimestamps = canvasAssistantVideoTimestamps(15.734);
assert.equal(sampleTimestamps.length, 5);
assert.ok(sampleTimestamps.every((value, index) => value > 0 && value < 15.734 && (index === 0 || value > sampleTimestamps[index - 1])));
const earlyTimelineTimestamps = canvasAssistantVideoTimestamps(15.734, "分析开头前几秒一只脚光脚，鞋什么时候出现");
assert.equal(earlyTimelineTimestamps.length, 7);
assert.ok(earlyTimelineTimestamps.slice(0, 6).every((value) => value <= 15.734 * 0.321));
assert.ok(earlyTimelineTimestamps.some((value) => value >= 3 && value <= 3.7));
assert.ok(earlyTimelineTimestamps.at(-1) > 15.734 * 0.8);
assert.deepEqual(canvasAssistantVideoTimestamps(0), []);

const focusNodes = [
  { id: "generator-a", kind: "generator" },
  { id: "generator-b", kind: "generator" },
  { id: "prompt-a", kind: "prompt", connectedNodeIds: ["generator-a"] },
  { id: "video-a", kind: "media", mediaType: "video", connectedNodeIds: ["generator-a"], referenceLabels: [{ generatorId: "generator-a", label: "@Video1" }] },
  { id: "image-a", kind: "media", mediaType: "image", connectedNodeIds: ["generator-a"], referenceLabels: [{ generatorId: "generator-a", label: "@Image1" }] },
  { id: "video-b", kind: "media", mediaType: "video", connectedNodeIds: ["generator-b"], referenceLabels: [{ generatorId: "generator-b", label: "@Video1" }] },
  { id: "image-b", kind: "media", mediaType: "image", connectedNodeIds: ["generator-b"], referenceLabels: [{ generatorId: "generator-b", label: "@Image1" }] },
];
assert.deepEqual(resolveCanvasAssistantMediaFocus(focusNodes, "帮我写换物提示词"), {
  nodeIds: [], generatorId: "", ambiguous: true, reason: "存在多个生成链路且未选中或点名素材",
});
assert.deepEqual(resolveCanvasAssistantMediaFocus(focusNodes.map((node) => node.id === "generator-b" ? { ...node, selected: true } : node), "帮我写换物提示词").nodeIds, ["video-b", "image-b"]);
assert.deepEqual(resolveCanvasAssistantMediaFocus(focusNodes.map((node) => node.id === "prompt-a" ? { ...node, selected: true } : node), "优化选中提示词").nodeIds, ["video-a", "image-a"]);
assert.equal(resolveCanvasAssistantMediaFocus(focusNodes, "使用 @Video1 和 @Image1").ambiguous, true);
assert.deepEqual(resolveCanvasAssistantMediaFocus(focusNodes.map((node) => node.id === "image-a" ? { ...node, selected: true } : node), "分析选中素材").nodeIds, ["video-a", "image-a"]);
assert.deepEqual(resolveCanvasAssistantMediaFocus(focusNodes.filter((node) => !["generator-b", "video-b", "image-b"].includes(node.id)), "分析当前链路").nodeIds, ["video-a", "image-a"]);

assert.equal(inferSeedancePromptMode({ prompt: "参考 @Image1 的人物和 @Video1 的运镜" }), "reference-to-video");
assert.equal(inferSeedancePromptMode({ prompt: "参考上传素材的动作", hasImage: true, referenceMediaTypes: ["video"] }), "reference-to-video");
assert.equal(inferSeedancePromptMode({ prompt: "将 @Video1 延长为下一段" }), "extend");
assert.equal(inferSeedancePromptMode({ prompt: "把视频里面的鞋替换成参考图中的鞋" }), "edit");
assert.equal(inferSeedancePromptMode({ prompt: "把故事拆成五个分镜" }), "storyboard");
const referenceGuidance = seedancePromptGuidance({
  prompt: "参考 @Image1 的人物、@Video1 的动作和 @Audio1 的节奏",
  duration: 15,
}).join("\n");
assert.match(referenceGuidance, /不翻译、不重编号、不新增不存在的引用/);
assert.match(referenceGuidance, /音频引用只控制用户指定的音乐、音色、节奏或音效/);
assert.match(referenceGuidance, /动作或运镜参考不得覆盖图片引用锁定的人物、产品和场景/);
assert.match(referenceGuidance, /界面时长为 15 秒/);
const replacementGuidance = seedancePromptGuidance({
  prompt: "把视频里的鞋替换成 @Image1 的鞋，基础视频是 @Video1",
}).join("\n");
assert.match(replacementGuidance, /原对象不存在时保持不存在/);
assert.match(replacementGuidance, /只作为不可误改的保护项/);
assert.match(replacementGuidance, /同一约束只写一次/);
const actionFocusedReplacementGuidance = seedancePromptGuidance({
  prompt: "把视频里的鞋替换成 @Image1 的鞋，并参考 @Video1 的模特动作和镜头",
}).join("\n");
assert.match(actionFocusedReplacementGuidance, /用户已明确要求参考动作、环境、场景或镜头/);
assert.doesNotMatch(actionFocusedReplacementGuidance, /只作为不可误改的保护项/);
assert.deepEqual(seedanceReferenceIssues("@Image1 参考人物，@Video2 参考动作", ["Image1", "Video1"]), {
  missing: ["@Video2"],
  unused: ["@Video1"],
});

const normalizedStoryboard = normalizeCanvasAssistantResponse({
  reply: "创建分镜",
  actions: [{
    type: "add_storyboard",
    shots: [{ shotId: "SH01", title: "开场", timeRange: "0-3s", prompt: "主体从门口走入", referenceBindings: [{ label: "@Image1", role: "identity", transfer: "人物身份" }] }],
  }],
});
assert.equal(normalizedStoryboard.actions[0].type, "add_storyboard");
assert.equal(normalizedStoryboard.actions[0].shots[0].referenceBindings[0].role, "identity");

console.log("restricted canvas assistant contracts passed");
