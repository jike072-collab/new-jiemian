#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const { filterCanvasCommands } = await import(new URL("../src/lib/canvas/commands.ts", import.meta.url));
const { layoutCanvasFlowNodes } = await import(new URL("../src/lib/canvas/layout.ts", import.meta.url));

const commands = [
  { id: "image", label: "添加图片生成", description: "创建生成节点", group: "创建", keywords: ["生图", "image"] },
  { id: "video", label: "添加视频生成", description: "创建生成节点", group: "创建", keywords: ["生视频", "video"] },
  { id: "node", label: "产品主视觉", description: "图片素材", group: "跳转到节点", keywords: ["banana-pro"] },
];
assert.deepEqual(filterCanvasCommands(commands, "生图").map((item) => item.id), ["image"]);
assert.deepEqual(filterCanvasCommands(commands, "产品 banana").map((item) => item.id), ["node"]);
assert.deepEqual(filterCanvasCommands(commands, "VIDEO").map((item) => item.id), ["video"]);
assert.equal(filterCanvasCommands(commands, "不存在").length, 0);
assert.equal(filterCanvasCommands(commands, "", 2).length, 2);

const node = (id, kind, y, sourceNodeIds) => ({ id, position: { x: 0, y }, width: 320, height: 240, data: { kind, sourceNodeIds } });
const chainNodes = [
  node("prompt", "prompt", 0),
  node("image-generator", "generator", 300),
  node("image-result", "media", 600, ["image-generator"]),
  node("video-generator", "generator", 900),
  node("video-result", "media", 1200, ["video-generator"]),
];
const chainEdges = [
  { source: "prompt", target: "image-generator" },
  { source: "image-generator", target: "image-result" },
  { source: "image-result", target: "video-generator" },
  { source: "video-generator", target: "video-result" },
];
const chainLayout = new Map(layoutCanvasFlowNodes(chainNodes, chainEdges).map((item) => [item.id, item.position]));
assert.ok(chainLayout.get("prompt").x < chainLayout.get("image-generator").x);
assert.ok(chainLayout.get("image-generator").x < chainLayout.get("image-result").x);
assert.ok(chainLayout.get("image-result").x < chainLayout.get("video-generator").x);
assert.ok(chainLayout.get("video-generator").x < chainLayout.get("video-result").x);
assert.ok(chainLayout.get("image-generator").x - chainLayout.get("prompt").x <= 460, "flow columns should stay compact");

const branchNodes = [
  node("main-prompt", "prompt", 0),
  node("image-generator", "generator", 300),
  node("image-result", "media", 600, ["image-generator"]),
  node("late-prompt", "prompt", 900),
  node("video-generator", "generator", 1200),
  node("video-result", "media", 1500, ["video-generator"]),
];
const branchLayout = new Map(layoutCanvasFlowNodes(branchNodes, [
  { source: "main-prompt", target: "image-generator" },
  { source: "image-generator", target: "image-result" },
  { source: "image-result", target: "video-generator" },
  { source: "late-prompt", target: "video-generator" },
  { source: "video-generator", target: "video-result" },
]).map((item) => [item.id, item.position]));
assert.ok(branchLayout.get("late-prompt").x > branchLayout.get("main-prompt").x, "a late side input should move beside its target");
assert.ok(branchLayout.get("video-generator").x - branchLayout.get("late-prompt").x <= 460, "a direct side link should span one compact column");

const crossingNodes = [node("source-a", "prompt", 0), node("source-b", "prompt", 400), node("target-a", "generator", 0), node("target-b", "generator", 400)];
const crossingLayout = new Map(layoutCanvasFlowNodes(crossingNodes, [
  { source: "source-a", target: "target-b" },
  { source: "source-b", target: "target-a" },
]).map((item) => [item.id, item.position]));
assert.ok(crossingLayout.get("target-b").y < crossingLayout.get("target-a").y, "dependency ordering should remove the avoidable crossing");

const [workspace, palette, shell, shortcuts, uploadRoute] = await Promise.all([
  read("src/components/canvas/canvas-workspace.tsx"),
  read("src/components/canvas/canvas-command-palette.tsx"),
  read("src/components/canvas/canvas-vozeb-shell.tsx"),
  read("src/components/canvas/canvas-shortcuts-panel.tsx"),
  read("src/app/api/canvas/media/route.ts"),
]);

assert.match(workspace, /CanvasCommandPalette/);
assert.match(workspace, /event\.key\.toLowerCase\(\) === "k"/);
assert.match(workspace, /event\.key\.toLowerCase\(\) === "g"/);
assert.match(workspace, /event\.key === "\."/);
assert.match(workspace, /fitView\(\{ nodes: selected/);
assert.match(workspace, /onDoubleClickCapture=/);
assert.match(workspace, /dataTransfer\.files/);
assert.match(workspace, /window\.addEventListener\("paste"/);
assert.match(workspace, /title: "粘贴文本"/);
assert.match(workspace, /\/api\/canvas\/media/);
assert.match(workspace, /canvas-file-drop/);
assert.match(palette, /role="dialog"/);
assert.match(palette, /ArrowDown/);
assert.match(palette, /ArrowUp/);
assert.match(shell, /canvas-v2-command-button/);
assert.match(shell, /搜索节点和操作/);
assert.match(shortcuts, /搜索节点与操作/);
assert.match(shortcuts, /空白处快速添加/);

assert.match(uploadRoute, /isInternalCanvasHostname/);
assert.match(uploadRoute, /requireCsrf/);
assert.match(uploadRoute, /requireAuthSession/);
assert.match(uploadRoute, /getInternalCanvasAccess/);
assert.match(uploadRoute, /ownerLocalUserId: session\.user\.local_user_id/);
assert.match(uploadRoute, /uploadedMediaFromForm/);
assert.match(uploadRoute, /addLibraryItem/);
assert.doesNotMatch(uploadRoute, /quota|billing|generate\/image|generate\/video/i);

console.log("canvas command, navigation, and local upload contracts passed without generation");
