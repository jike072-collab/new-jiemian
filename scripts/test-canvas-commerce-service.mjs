#!/usr/bin/env node
import assert from "node:assert/strict";

const { createCanvasAssistantService } = await import("../src/lib/server/canvas-assistant.ts");

const calls = [];
const service = createCanvasAssistantService(async (input) => {
  calls.push(input);
  if (input.systemPrompt.includes("商品视觉分析师")) {
    return JSON.stringify({
      kind: "commerce-product-analysis",
      sameProduct: true,
      conflictMessage: "",
      suggestedName: "复古拼接系带鞋",
      sellingPoints: ["复古配色", "鞋面拼接层次", "厚底轮廓", "系带结构"],
      visibleFacts: ["米白色鞋面", "深色鞋底"],
      recommendedDirections: ["daily-style", "product-asmr"],
    });
  }
  return JSON.stringify({
    kind: "commerce-plan-generation",
    plans: [{
      id: "model-plan-1",
      direction: "daily-style",
      title: "马来西亚日常穿搭",
      sellingPoint: "模型擅自替换的卖点",
      hook: {
        visualPatternId: "middle-of-action",
        copyPatternId: "direct-problem-question",
        title: "出门穿搭选择",
        reason: "动作开场适合日常穿搭，短问句与镜前犹豫一致。",
        hookLine: "Outfit hari ni rasa biasa?",
        onScreenText: "Outfit hari ni rasa biasa?",
        scene: "马来西亚公寓玄关",
        visualBeat: "人物拿错鞋后发现镜中配色不协调，在目标鞋前明显犹豫。",
      },
      production: {
        scenePatternId: "condo-entry-mirror",
        shotPatternId: "problem-reveal-proof-result",
        performancePatternId: "candid-curiosity",
        energy: "balanced",
        emotionArc: "轻微疑惑到发现搭配变化，再到自然满意",
        realismNotes: "人物像真实出门准备，保留镜前观察、眨眼和换鞋后的短暂停顿",
      },
      shots: [
        { timeRange: "0-2秒", shotSize: "中景", camera: "固定中景", action: "人物拿错鞋后发现配色不协调，在镜前拿起目标鞋犹豫", performance: "视线先看镜中穿搭再落到鞋子，眉头轻微收紧", productState: "目标鞋由人物拿在腰侧，完整侧面可见", dialogue: "Outfit hari ni rasa biasa?", onScreenText: "Outfit hari ni rasa biasa?", sound: "第 0 秒开始室内环境声和短问句", transition: "人物把鞋移向镜头形成自然遮挡" },
        { timeRange: "2-7秒", shotSize: "近景", camera: "匹配剪辑后短推进", action: "遮挡结束时人物完成穿鞋并踩稳", performance: "低头确认后肩膀自然放松", productState: "双脚已穿目标鞋，鞋型和配色与参考图一致", dialogue: "Nampak terus lebih kemas.", onScreenText: "Nampak terus lebih kemas.", sound: "脚步落点配合音乐强拍", transition: "脚步落点匹配切到侧向动作" },
        { timeRange: "7-12秒", shotSize: "全身", camera: "低机位侧向跟拍", action: "人物沿玄关走两步再自然转身", performance: "步态轻松，转身时看一眼镜中整体", productState: "鞋子在移动中保持清楚且左右脚一致", dialogue: "无口播", onScreenText: "", sound: "两次自然脚步声和轻音乐", transition: "人物经过镜框前景后切到结果镜头" },
        { timeRange: "12-15秒", shotSize: "半身与全身镜像", camera: "固定机位", action: "人物整理衣角并拿起随身包准备离开", performance: "自然半笑，视线从镜中转向出门方向", productState: "镜中完整穿搭和目标鞋同时可见", dialogue: "Korang match dengan outfit apa?", onScreenText: "Korang match dengan outfit apa?", sound: "音乐轻收束，保留钥匙轻响", transition: "人物迈出画面后自然结束" },
      ],
      prompt: "素材职责：@Image1 与 @Image2 只提供产品外观。产品可见事实：米白色鞋面、深色鞋底。0-2 秒：人物拿起鞋并说‘Outfit hari ni rasa biasa?’，同步屏幕短字‘Outfit hari ni biasa?’；2-7 秒踩点换鞋；7-12 秒近景证据；12-15 秒马来语 CTA。声音/口播：‘Nampak kemas, senang match dengan outfit harian.’ 禁止项：不虚构价格、折扣和性能。",
      referenceBindings: [
        { label: "@Image1", role: "product", transfer: "鞋子外观", ignore: "背景" },
        { label: "@Image2", role: "product", transfer: "侧面结构", ignore: "背景" },
      ],
      publishingCopy: {
        title: "Terus nampak lebih kemas",
        caption: "Detail warna ni bagi outfit harian nampak lebih tersusun. Korang match dengan outfit apa?",
        hashtags: ["#kasutharian", "#gayakasual", "#sneakers", "#fyp"],
        angle: "daily",
        category: "casual",
      },
    }],
  });
});

const nodes = [
  { id: "image-node-1", kind: "media", title: "鞋子主图", selected: true, mediaType: "image", libraryItemId: "library-image-1" },
  { id: "image-node-2", kind: "media", title: "鞋子侧面", selected: true, mediaType: "image", libraryItemId: "library-image-2" },
];
const visualEvidence = {
  images: [
    { label: "@Image1", description: "鞋子主图", dataUrl: "data:image/png;base64,AA==" },
    { label: "@Image2", description: "鞋子侧面", dataUrl: "data:image/png;base64,AA==" },
  ],
  summary: "@Image1 鞋子主图；@Image2 鞋子侧面。",
};

const analysis = await service.answer({
  workflow: "commerce-product-analysis",
  message: "分析产品",
  canvasTitle: "马来西亚鞋类测试",
  scope: "shared",
  productDraftId: "product-1",
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-analysis", visualEvidence);
assert.equal(analysis.kind, "commerce-product-analysis");
assert.equal(analysis.sameProduct, true);
assert.equal(analysis.sellingPoints.length, 4);
assert.equal(calls[0].timeoutMs, 60_000);
assert.equal(calls[0].images.length, 2);
assert.equal(Object.hasOwn(analysis, "creativeOptions"), false);
assert.equal(Object.hasOwn(analysis, "actions"), false);

const generated = await service.answer({
  workflow: "commerce-plan-generation",
  message: "生成15秒方案",
  canvasTitle: "马来西亚鞋类测试",
  scope: "shared",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["daily-style"],
  directionSellingPoints: { "daily-style": "复古配色" },
  usedHookPatterns: [{
    direction: "daily-style",
    visualPatternId: "visible-problem-contrast",
    copyPatternId: "expectation-gap",
    scenePatternId: "mall-mirror-corridor",
    shotPatternId: "before-after-match-proof",
    performancePatternId: "style-self-check",
  }],
  extraRequirements: "人物动作自然，不出现虚假促销信息",
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-plans", visualEvidence);
assert.equal(generated.kind, "commerce-plan-generation");
assert.equal(generated.plans.length, 1);
assert.equal(calls[1].timeoutMs, 120_000);
assert.equal(calls[1].maxTokens, 6_000);
assert.match(calls[1].systemPrompt, /每个方向必须恰好有三个候选/);
assert.equal(generated.plans[0].sellingPoint, "复古配色");
assert.match(generated.plans[0].prompt, /0-2秒/);
assert.match(generated.plans[0].prompt, /12-15秒/);
assert.match(generated.plans[0].prompt, /Hampir nak return, tapi detail warna kasut ni terus ubah fikiran/);
assert.match(generated.plans[0].prompt, /双脚从第0秒已穿目标鞋/);
assert.match(generated.plans[0].prompt, /镜头 1｜0-2秒｜中近景/);
assert.match(generated.plans[0].prompt, /人物与情绪/);
assert.equal(generated.plans[0].shots.length, 4);
assert.equal(generated.plans[0].hook.visualPatternId, "local-reaction-reveal");
assert.equal(generated.plans[0].hook.copyPatternId, "return-intent-reversal");
assert.equal(generated.plans[0].publishingCopy.hashtags.includes("#fyp"), false);
assert.equal(generated.plans[0].publishingCopy.hashtags.length, 4);
assert.equal(Object.hasOwn(generated, "actions"), false);

assert.equal(calls.length, 2);
assert.equal(calls[0].images.length, 2);
assert.equal(calls[1].images, undefined);
assert.match(calls[1].systemPrompt, /马来西亚本地成年人物/);
assert.match(calls[1].systemPrompt, /痛点问句/);
assert.match(calls[1].systemPrompt, /不使用刻板化形象/);
assert.match(calls[1].systemPrompt, /4 个清楚不同的分镜节拍/);
assert.match(calls[1].systemPrompt, /整段只拍脚踝/);
assert.match(calls[1].systemPrompt, /Klik Klik/);
assert.match(calls[1].systemPrompt, /禁止前半段安静、后半段突然口播/);
assert.match(calls[1].systemPrompt, /普通时尚运动鞋不写专业跑步、山地徒步或露营性能/);
assert.match(calls[1].systemPrompt, /全片最多 3 句马来语短句/);
assert.match(calls[1].systemPrompt, /双层钩子知识库/);
assert.match(calls[1].systemPrompt, /默认不得使用 #fyp/);
assert.match(calls[1].systemPrompt, /shotSize、camera、action、performance/);
assert.match(calls[1].systemPrompt, /眨眼、呼吸、停顿和动作惯性/);
assert.match(calls[1].systemPrompt, /每个有口播镜头/);
assert.match(calls[1].systemPrompt, /上一镜头结束时的人物、服装、鞋子穿着状态/);
assert.match(calls[1].systemPrompt, /单纯系鞋带、站起、走路/);
assert.match(calls[1].systemPrompt, /轻微手持微抖和曝光调整/);
assert.match(calls[1].systemPrompt, /不是完美广告模特/);
assert.match(calls[1].systemPrompt, /当前产品资料、用户优化要求或画布里明确给出的 RM\/MYR 金额/);
const planRequest = JSON.parse(calls[1].userPrompt);
assert.equal(planRequest.scope, "shared");
assert.equal(planRequest.productDraftId, "product-1");
assert.deepEqual(planRequest.selectedDirections, ["daily-style"]);
assert.equal(planRequest.directionSellingPoints["daily-style"], "复古配色");
assert.deepEqual(planRequest.visibleFacts, ["米白色鞋面", "深色鞋底"]);
assert.deepEqual(planRequest.usedHookPatterns, [{
  direction: "daily-style",
  visualPatternId: "visible-problem-contrast",
  copyPatternId: "expectation-gap",
  scenePatternId: "mall-mirror-corridor",
  shotPatternId: "before-after-match-proof",
  performancePatternId: "style-self-check",
}]);
assert.equal(calls.some((call) => /generate\/video|生成接口|提交任务/.test(call.userPrompt)), false);

const refined = await service.answer({
  workflow: "commerce-plan-generation",
  message: "按要求优化当前15秒方案",
  canvasTitle: "马来西亚鞋类测试",
  scope: "shared",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["daily-style"],
  directionSellingPoints: { "daily-style": "复古配色" },
  basePlanId: generated.plans[0].id,
  basePrompt: generated.plans[0].prompt,
  refinementRequest: "只加强前两秒冲突，其他镜头保持",
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-refine", visualEvidence);
assert.equal(refined.plans.length, 1);
const refinementRequest = JSON.parse(calls[2].userPrompt);
assert.equal(refinementRequest.basePlanId, generated.plans[0].id);
assert.match(refinementRequest.basePrompt, /镜头 1/);
assert.equal(refinementRequest.refinementRequest, "只加强前两秒冲突，其他镜头保持");
assert.match(calls[2].systemPrompt, /只按 refinementRequest 修改相关部分/);

let malformedCalls = 0;
const parseRecoveryService = createCanvasAssistantService(async () => {
  malformedCalls += 1;
  return malformedCalls === 1
    ? "这里是方案，但没有按要求输出 JSON"
    : `已按要求修正：\n\`\`\`json\n${JSON.stringify({ kind: "commerce-plan-generation", plans: generated.plans })}\n\`\`\`\n以上是完整方案。`;
});
const recovered = await parseRecoveryService.answer({
  workflow: "commerce-plan-generation",
  message: "重新分析15秒方案",
  canvasTitle: "马来西亚鞋类测试",
  scope: "shared",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["daily-style"],
  directionSellingPoints: { "daily-style": "复古配色" },
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-parse-recovery", visualEvidence);
assert.equal(recovered.kind, "commerce-plan-generation");
assert.equal(malformedCalls, 2);

let invalidHookCalls = 0;
const invalidHookPlan = {
  ...generated.plans[0],
  direction: "sport-motion",
  hook: {
    visualPatternId: "invented-motion-hook",
    copyPatternId: "invented-copy-hook",
    hookLine: "Biasa sahaja",
  },
  production: {
    scenePatternId: "invented-scene-pattern",
    shotPatternId: "invented-shot-pattern",
    performancePatternId: "invented-performance-pattern",
    energy: "balanced",
  },
  shots: generated.plans[0].shots.map((shot, index) => index === 0
    ? { ...shot, transition: "直接切到下一镜头" }
    : shot),
};
const hookRepairService = createCanvasAssistantService(async () => {
  invalidHookCalls += 1;
  return JSON.stringify({ kind: "commerce-plan-generation", plans: [invalidHookPlan] });
});
const hookRepaired = await hookRepairService.answer({
  workflow: "commerce-plan-generation",
  message: "重新分析15秒方案",
  canvasTitle: "马来西亚鞋类测试",
  scope: "shared",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["sport-motion"],
  directionSellingPoints: { "sport-motion": "复古配色" },
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-hook-repair", visualEvidence);
assert.equal(invalidHookCalls, 1);
assert.equal(hookRepaired.kind, "commerce-plan-generation");
assert.notEqual(hookRepaired.plans[0].hook.visualPatternId, "invented-motion-hook");
assert.notEqual(hookRepaired.plans[0].hook.copyPatternId, "invented-copy-hook");
assert.notEqual(hookRepaired.plans[0].production.scenePatternId, "invented-scene-pattern");
assert.equal(hookRepaired.plans[0].production.energy, "dynamic");
assert.deepEqual(hookRepaired.plans[0].shots.map((shot) => shot.timeRange), ["0-2秒", "2-7秒", "7-12秒", "12-15秒"]);
assert.doesNotMatch(hookRepaired.plans[0].shots[0].transition, /切到下一镜头/);
assert.equal(hookRepaired.plans[0].shots[0].dialogue, hookRepaired.plans[0].hook.hookLine);
assert.equal(hookRepaired.plans[0].shots[0].onScreenText, hookRepaired.plans[0].hook.hookLine);

const candidateBase = structuredClone(generated.plans[0]);
const candidateB = structuredClone(candidateBase);
candidateB.hook.visualPatternId = "local-reaction-reveal";
candidateB.hook.copyPatternId = "return-intent-reversal";
candidateB.hook.hookLine = "Hampir nak return, tapi detail warna kasut ni terus ubah fikiran.";
candidateB.hook.onScreenText = candidateB.hook.hookLine;
candidateB.hook.visualBeat = "人物在镜前准备把目标鞋脱下放回鞋盒时停住，抬起鞋跟露出鞋面和鞋底的撞色层次";
candidateB.shots[0] = {
  ...candidateB.shots[0],
  action: "人物在镜前准备把目标鞋脱下放回鞋盒时停住，抬起鞋跟露出鞋面和鞋底的撞色层次",
  productState: "双脚从第0秒已穿目标鞋，鞋型、配色和左右脚清楚可见",
  dialogue: candidateB.hook.hookLine,
  onScreenText: candidateB.hook.hookLine,
};
candidateB.shots[1] = {
  ...candidateB.shots[1],
  action: "人物把鞋盒推开并转动脚侧，让鞋面和鞋底的撞色层次在近景中清楚出现",
  productState: "目标鞋保持已穿，鞋面和鞋底的可见撞色细节与首帧连续",
  dialogue: "Sekali pusing, detail warna terus nampak.",
  onScreenText: "Sekali pusing, detail warna terus nampak.",
};
const candidateC = structuredClone(candidateBase);
candidateC.hook.hookLine = "Rupanya warna ni menyerlah.";
candidateC.hook.copyPatternId = "expectation-gap";
candidateC.hook.onScreenText = candidateC.hook.hookLine;
candidateC.shots[0].dialogue = candidateC.hook.hookLine;
candidateC.shots[0].onScreenText = candidateC.hook.hookLine;
let candidateCalls = 0;
const candidateService = createCanvasAssistantService(async () => {
  candidateCalls += 1;
  if (candidateCalls === 1) {
    return JSON.stringify({
      kind: "commerce-plan-candidates",
      candidates: [
        { id: "candidate-a", plan: candidateBase },
        { id: "candidate-b", plan: candidateB },
        { id: "candidate-c", plan: candidateC },
      ],
    });
  }
  return JSON.stringify({ winners: [{ direction: "daily-style", candidateId: "candidate-b" }] });
});
const criticallySelected = await candidateService.answer({
  workflow: "commerce-plan-generation",
  message: "生成一段15秒提示词",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["daily-style"],
  directionSellingPoints: { "daily-style": "复古配色" },
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-candidates", visualEvidence);
assert.equal(candidateCalls, 2);
assert.equal(criticallySelected.plans[0].hook.hookLine, "Hampir nak return, tapi detail warna kasut ni terus ubah fikiran.");
assert.match(criticallySelected.plans[0].prompt, /1.5-2 秒/);
assert.ok(criticallySelected.plans[0].prompt.length <= 2_400);
assert.match(calls[1].systemPrompt, /当前产品资料或用户优化要求/);
assert.match(calls[1].systemPrompt, /return-intent-reversal/);

const weakPlan = structuredClone(candidateBase);
weakPlan.hook.visualPatternId = "visible-problem-contrast";
weakPlan.hook.copyPatternId = "stop-scroll-specific-reveal";
weakPlan.hook.hookLine = "Kejap, tengok kasut ni berubah.";
weakPlan.hook.onScreenText = weakPlan.hook.hookLine;
weakPlan.hook.visualBeat = "人物站着看鞋";
weakPlan.shots[0] = {
  ...weakPlan.shots[0],
  action: "人物站着看鞋",
  productState: "目标鞋未穿，放在长椅上",
  dialogue: weakPlan.hook.hookLine,
  onScreenText: weakPlan.hook.hookLine,
  sound: "第0秒口播“Kasus gelap tenggelam sangat?”和环境声",
};
weakPlan.shots[2] = { ...weakPlan.shots[2], action: "人物沿步道慢跑", camera: "低机位跟拍" };
const weakService = createCanvasAssistantService(async () => JSON.stringify({ kind: "commerce-plan-generation", plans: [weakPlan] }));
const weakRecovered = await weakService.answer({
  workflow: "commerce-plan-generation",
  message: "生成一段15秒提示词",
  productDraftId: "product-1",
  productName: analysis.suggestedName,
  sellingPoints: analysis.sellingPoints,
  visibleFacts: analysis.visibleFacts,
  selectedDirections: ["daily-style"],
  directionSellingPoints: { "daily-style": "复古配色" },
  selectedNodeIds: nodes.map((node) => node.id),
  nodes,
}, "request-weak-hook", visualEvidence);
assert.doesNotMatch(weakRecovered.plans[0].prompt, /kasut ni berubah/);
assert.match(weakRecovered.plans[0].prompt, /双脚从第0秒已穿目标鞋/);
assert.doesNotMatch(weakRecovered.plans[0].prompt, /慢跑/);

console.log(JSON.stringify({
  ok: true,
  stages: [analysis.kind, generated.kind],
  modelCalls: calls.length,
  generationSubmitted: false,
  databaseWritten: false,
}));
