import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [route, primaryRoute, workspace, shell, assistant, promptGuidance, notices, agpl] = await Promise.all([
  read("src/app/canvas-v2/page.tsx"),
  read("src/app/canvas/page.tsx"),
  read("src/components/canvas/canvas-workspace.tsx"),
  read("src/components/canvas/canvas-vozeb-shell.tsx"),
  read("src/lib/server/canvas-assistant.ts"),
  read("src/lib/seedance/prompt-guidance.ts"),
  read("THIRD_PARTY_NOTICES.md"),
  read("LICENSES/VOZEB-AGPL-3.0.txt"),
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
assert.match(workspace, /presentation === "vozeb" && !compactViewport \? \[1\] : true/, "desktop v2 must reserve left-drag for box selection");
assert.match(workspace, /selectionOnDrag=\{presentation === "vozeb" && !compactViewport\}/, "desktop v2 must support direct box selection");
assert.match(workspace, /selectionKeyCode=\{presentation === "vozeb" \? null : "Shift"\}/, "desktop v2 box selection must not require a modifier");

assert.match(assistant, /seedanceCanvasAssistantRules/, "assistant must retain Seedance-specific planning rules");
assert.match(assistant, /seedancePromptGuidance/, "assistant must retain Seedance prompt guidance");
assert.match(promptGuidance, /reference|Image|Video|Audio/i, "Seedance reference validation must remain available");

assert.match(shell, /对应源码/, "the network UI must expose the corresponding-source entry");
assert.match(shell, /aria-label=\{libraryOpen \? "关闭素材库" : "打开素材库"\}/, "the topbar must open the library in one click");
assert.match(notices, /csyqlz\/vozeb/, "third-party notice must identify the VOZEB source");
assert.match(notices, /a2c52c7aacf68d825563b7455efa9c34f3db0123/, "third-party notice must pin the imported source commit");
assert.match(agpl, /GNU AFFERO GENERAL PUBLIC LICENSE/, "the complete AGPL license must be included");

console.log("canvas VOZEB shell contracts passed");
