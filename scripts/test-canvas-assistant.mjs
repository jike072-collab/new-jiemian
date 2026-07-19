#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/canvas/assistant/route.ts");
const service = read("src/lib/server/canvas-assistant.ts");
const assistantTypes = read("src/lib/canvas/assistant.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const { localCanvasAssistantFallback, normalizeCanvasAssistantResponse } = await import(new URL("../src/lib/canvas/assistant.ts", import.meta.url));
const { inferSeedancePromptMode, seedancePromptGuidance, seedanceReferenceIssues } = await import(new URL("../src/lib/seedance/prompt-guidance.ts", import.meta.url));

assert.match(route, /isInternalCanvasHostname/);
assert.match(route, /getInternalCanvasAccess/);
assert.match(route, /requireCsrf/);
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
assert.match(service, /localCanvasAssistantFallback/);
assert.match(service, /seedanceCanvasAssistantRules/);
assert.match(service, /seedanceTaskGuidance/);
assert.match(service, /@Video\\d\+/);
assert.match(assistantTypes, /sourceActions.*slice\(0, 8\)/);
assert.doesNotMatch(service, /apiKey|Authorization|child_process|exec\(/);
assert.match(workspace, /CanvasAssistantPanel/);
assert.match(workspace, /applyAssistantActions/);
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

assert.equal(inferSeedancePromptMode({ prompt: "参考 @Image1 的人物和 @Video1 的运镜" }), "reference-to-video");
assert.equal(inferSeedancePromptMode({ prompt: "参考上传素材的动作", hasImage: true, referenceMediaTypes: ["video"] }), "reference-to-video");
assert.equal(inferSeedancePromptMode({ prompt: "将 @Video1 延长为下一段" }), "extend");
assert.equal(inferSeedancePromptMode({ prompt: "把故事拆成五个分镜" }), "storyboard");
const referenceGuidance = seedancePromptGuidance({
  prompt: "参考 @Image1 的人物、@Video1 的动作和 @Audio1 的节奏",
  duration: 15,
}).join("\n");
assert.match(referenceGuidance, /不翻译、不重编号、不新增不存在的引用/);
assert.match(referenceGuidance, /音频引用只控制用户指定的音乐、音色、节奏或音效/);
assert.match(referenceGuidance, /动作或运镜参考不得覆盖图片引用锁定的人物、产品和场景/);
assert.match(referenceGuidance, /界面时长为 15 秒/);
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
