#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/canvas/projects/[id]/presence/route.ts");
const events = read("src/app/api/canvas/projects/[id]/events/route.ts");
const collaboration = read("src/lib/server/canvas-collaboration.ts");
const service = read("src/lib/server/canvas-presence.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const shell = read("src/components/canvas/canvas-vozeb-shell.tsx");
const node = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const shellCss = read("src/app/canvas-v2/canvas-v2.css");

const {
  CANVAS_PRESENCE_TTL_MS,
  canvasPresenceActivity,
  canvasPresenceMembersForNode,
  canvasPresenceNodeActivity,
  isCanvasPresenceExpired,
} = await import(new URL("../src/lib/canvas/presence.ts", import.meta.url));

const member = {
  clientId: "client-2",
  userId: "user-2",
  displayName: "设计师二",
  color: "#2563eb",
  selectedNodeIds: ["node-a"],
  editingNodeId: "node-b",
  generatingNodeIds: ["node-c"],
  activity: "generating",
  updatedAt: "2026-07-19T12:00:00.000Z",
};

assert.equal(CANVAS_PRESENCE_TTL_MS, 35_000);
assert.equal(canvasPresenceActivity({ generatingNodeIds: ["node-c"], editingNodeId: "node-b", selectedNodeIds: ["node-a"] }), "generating");
assert.equal(canvasPresenceActivity({ editingNodeId: "node-b", selectedNodeIds: ["node-a"] }), "editing");
assert.equal(canvasPresenceActivity({ selectedNodeIds: ["node-a"] }), "selected");
assert.equal(canvasPresenceActivity({}), "viewing");
assert.equal(canvasPresenceNodeActivity(member, "node-c"), "generating");
assert.equal(canvasPresenceNodeActivity(member, "node-b"), "editing");
assert.equal(canvasPresenceNodeActivity(member, "node-a"), "selected");
assert.equal(canvasPresenceMembersForNode([member], "node-a", "client-2").length, 0);
assert.equal(canvasPresenceMembersForNode([member], "node-a", "client-1").length, 1);
assert.equal(isCanvasPresenceExpired(member.updatedAt, new Date("2026-07-19T12:00:34.999Z")), false);
assert.equal(isCanvasPresenceExpired(member.updatedAt, new Date("2026-07-19T12:00:35.001Z")), true);

assert.match(route, /requireCsrf/);
assert.match(route, /requireAuthSession/);
assert.match(route, /isInternalCanvasHostname/);
assert.match(route, /resolveCanvasWorkspaceOwner/);
assert.match(route, /scope.*personal/);
assert.match(route, /validNodeIds/);
assert.match(route, /broadcastCanvasProjectEvent/);
assert.match(service, /__aohuangCanvasPresence/);
assert.match(service, /isCanvasPresenceExpired/);
assert.match(service, /presenceKey\(input\.userId, input\.clientId\)/);
assert.match(route, /removeCanvasPresence\(access\.project\.id, access\.localUserId, clientId\)/);
assert.match(collaboration, /type: "project" \| "deleted" \| "presence"/);
assert.match(events, /send\("presence"/);
assert.match(workspace, /canvasProjectPresenceUrl/);
assert.match(workspace, /10_000/);
assert.match(workspace, /method: "DELETE"/);
assert.match(workspace, /onFocusCapture/);
assert.match(workspace, /setPresenceGeneratingNodeIds/);
assert.match(workspace, /presenceMembers=\{canvasScope\(\) === "shared"/);
assert.match(shell, /团队在线/);
assert.match(shell, /正在生成/);
assert.match(node, /CanvasPresenceBadges/);
assert.match(canvasCss, /canvas-node-presence/);
assert.match(shellCss, /canvas-v2-presence__popover/);

console.log("canvas presence contracts passed without generation");
