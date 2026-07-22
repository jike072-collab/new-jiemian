import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [route, primaryRoute, workspace, shell, assistant, assistantPanel, promptGuidance, notices, agpl, canvasNode, promptHttp] = await Promise.all([
  read("src/app/canvas-v2/page.tsx"),
  read("src/app/canvas/page.tsx"),
  read("src/components/canvas/canvas-workspace.tsx"),
  read("src/components/canvas/canvas-vozeb-shell.tsx"),
  read("src/lib/server/canvas-assistant.ts"),
  read("src/components/canvas/canvas-assistant-panel.tsx"),
  read("src/lib/seedance/prompt-guidance.ts"),
  read("THIRD_PARTY_NOTICES.md"),
  read("LICENSES/VOZEB-AGPL-3.0.txt"),
  read("src/components/canvas/canvas-node.tsx"),
  read("src/lib/server/prompts/http.ts"),
]);

assert.match(route, /getAuthService\(\)\.currentUser\(sessionToken\)/, "v2 must reuse the existing session service");
assert.match(route, /getInternalCanvasAccess\(session\.user\.local_user_id\)/, "v2 must enforce the CN allowlist");
assert.match(route, /presentation="vozeb"/, "v2 must opt into the VOZEB presentation without replacing the classic canvas");
assert.doesNotMatch(route, /register|pointsBalance|WebDAV/i, "v2 must not introduce a second account, points, or WebDAV system");
assert.match(primaryRoute, /presentation=\{isInternal \? "vozeb" : "classic"\}/, "the CN canvas must use VOZEB while public hosts keep the classic presentation");
assert.match(primaryRoute, /\.\.\/canvas-v2\/canvas-v2\.css/, "the primary canvas route must load the internal VOZEB styles");

assert.match(workspace, /canvasProjectsUrl\(/, "v2 must keep server-backed canvas projects");
assert.match(workspace, /new EventSource\(canvasProjectEventsUrl/, "v2 must keep realtime shared-canvas updates");
assert.match(workspace, /CanvasAssistantPanel/, "v2 must keep the restricted Aohuang assistant panel");
assert.match(workspace, /\s+panOnDrag\s+/, "desktop v2 must pan with a plain left-button drag");
assert.match(workspace, /selectionOnDrag=\{false\}/, "desktop v2 must not box-select on a plain left-button drag");
assert.match(workspace, /selectionKeyCode=\{presentation === "vozeb" \? "Control" : "Shift"\}/, "desktop v2 box selection must require Control");

assert.match(assistant, /seedanceCanvasAssistantRules/, "assistant must retain Seedance-specific planning rules");
assert.match(assistant, /seedancePromptGuidance/, "assistant must retain Seedance prompt guidance");
assert.match(promptGuidance, /reference|Image|Video|Audio/i, "Seedance reference validation must remain available");

assert.match(shell, /对应源码/, "the network UI must expose the corresponding-source entry");
assert.match(shell, /canvas-v2-title[\s\S]*canvas-v2-scope-switch/, "personal/team scope must be visible beside the canvas title");
assert.doesNotMatch(shell, /canvas-v2-segments/, "personal/team scope must not remain inside the menu");
assert.match(shell, /aria-label=\{libraryOpen \? "关闭素材库" : "打开素材库"\}/, "the topbar must open the library in one click");
assert.match(shell, /aria-label="一键整理画布"/, "the topbar must expose one-click canvas organization");
assert.match(workspace, /onOrganize=\{\(\) => organizeCanvas\("flow"\)\}/, "one-click organization must use the existing flow layout");
assert.match(workspace, /optimizePromptNode/, "prompt nodes must reuse the existing prompt optimizer");
assert.match(workspace, /\/api\/prompts\/optimize/, "prompt nodes must call the established prompt optimizer endpoint");
assert.match(assistantPanel, /role="listbox" aria-label="引用画布节点"/, "assistant must expose @ mention candidates");
assert.match(assistantPanel, /selected: mentioned\.size \? mentioned\.has\(node\.id\) : node\.selected/, "assistant mentions must focus the referenced node");
assert.match(assistantPanel, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/, "assistant mention menu must support keyboard navigation");
assert.doesNotMatch(workspace, /编辑文字/, "the selected prompt toolbar must not duplicate direct text editing");
assert.match(canvasNode, /aria-label="优化提示词"/, "prompt nodes must expose prompt optimization directly");
assert.equal((canvasNode.match(/<StatusLine/g) || []).length, 1, "generation status must render only on result media nodes");
assert.match(workspace, /kind: "media"[\s\S]*jobId: job\?\.id/, "video jobs must be tracked by their result nodes");
assert.match(workspace, /addResultNode\(generatorId, response\.item, response\.job\);[\s\S]*status: "idle"/, "video generators must become reusable after task acceptance");
assert.match(promptHttp, /isInternalCanvasHostname.*\? "internal_free"/, "CN prompt optimization must remain free");
assert.match(notices, /csyqlz\/vozeb/, "third-party notice must identify the VOZEB source");
assert.match(notices, /a2c52c7aacf68d825563b7455efa9c34f3db0123/, "third-party notice must pin the imported source commit");
assert.match(agpl, /GNU AFFERO GENERAL PUBLIC LICENSE/, "the complete AGPL license must be included");

console.log("canvas VOZEB shell contracts passed");
