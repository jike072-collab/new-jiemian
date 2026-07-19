#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const { filterCanvasCommands } = await import(new URL("../src/lib/canvas/commands.ts", import.meta.url));

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
