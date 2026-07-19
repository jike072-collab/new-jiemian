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
const { normalizeCanvasAssistantResponse } = await import(new URL("../src/lib/canvas/assistant.ts", import.meta.url));

assert.match(route, /isInternalCanvasHostname/);
assert.match(route, /getInternalCanvasAccess/);
assert.match(route, /requireCsrf/);
assert.match(service, /禁止自动提交任何生成任务/);
assert.match(service, /replace_selected_prompt/);
assert.match(assistantTypes, /sourceActions.*slice\(0, 8\)/);
assert.doesNotMatch(service, /apiKey|Authorization|child_process|exec\(/);
assert.match(workspace, /CanvasAssistantPanel/);
assert.match(workspace, /applyAssistantActions/);

assert.deepEqual(normalizeCanvasAssistantResponse({
  reply: "ok",
  actions: [
    { type: "add_prompt", prompt: "测试提示词" },
    { type: "delete_project", id: "forbidden" },
    { type: "organize", layout: "flow" },
  ],
}), {
  reply: "ok",
  actions: [
    { type: "add_prompt", prompt: "测试提示词", title: undefined },
    { type: "organize", layout: "flow" },
  ],
});

console.log("restricted canvas assistant contracts passed");
