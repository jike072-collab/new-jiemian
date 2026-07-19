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
assert.match(service, /canvas_assistant_failed/);
assert.match(service, /localCanvasAssistantFallback/);
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

assert.equal(localCanvasAssistantFallback({ message: "帮我写一段产品提示词" }), null);

console.log("restricted canvas assistant contracts passed");
