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
const { canvasAssistantVideoTimestamps, localCanvasAssistantFallback, normalizeCanvasAssistantResponse } = await import(new URL("../src/lib/canvas/assistant.ts", import.meta.url));
const { resolveCanvasAssistantMediaFocus } = await import(new URL("../src/lib/canvas/assistant-focus.ts", import.meta.url));
const { inferSeedancePromptMode, seedancePromptGuidance, seedanceReferenceIssues } = await import(new URL("../src/lib/seedance/prompt-guidance.ts", import.meta.url));

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
assert.match(assistantPanel, /submitMessage/);
assert.match(assistantPanel, /已应用.*项操作/);
assert.match(workspace, /applyAssistantActions/);
assert.match(workspace, /assistantNodeContexts/);
assert.match(workspace, /referenceLabels/);
assert.match(workspace, /libraryItemId/);
assert.match(workspace, /action\.targetGeneratorId/);
assert.match(workspace, /action\.type === "add_generator"/);
assert.match(workspace, /action\.type === "select_nodes"/);
assert.match(workspace, /action\.type === "connect_nodes"/);
assert.match(workspace, /action\.type === "group_nodes"/);
assert.match(workspace, /action\.type === "ungroup"/);

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
assert.deepEqual(localCanvasAssistantFallback({ message: "继续上一段视频", nodes: [{ kind: "media", title: "未完成视频", mediaType: "video" }] }).actions, []);
assert.equal(localCanvasAssistantFallback({ message: "继续上一段视频", nodes: [{ kind: "media", title: "成功视频", mediaType: "video", sequenceState: { accepted: true } }] }).actions[0].type, "add_prompt");

const localVideoPrompt = localCanvasAssistantFallback({
  message: "根据 @Image1 和 @Video1 写一个 Seedance 视频提示词",
  nodes: [{ kind: "prompt", title: "动作", prompt: "@Image1 中的人物转身，动作参考 @Video1" }],
});
assert.equal(localVideoPrompt.actions[0].title, "Seedance 视频提示词");
assert.match(localVideoPrompt.actions[0].prompt, /一个主要动作/);
assert.match(localVideoPrompt.actions[0].prompt, /已有 @ImageN、@VideoN、@AudioN 标签必须原样保留/);

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
