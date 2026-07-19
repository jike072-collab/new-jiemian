#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const collectionRoute = read("src/app/api/canvas/projects/route.ts");
const projectRoute = read("src/app/api/canvas/projects/[id]/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const canvasEdge = read("src/components/canvas/canvas-edge.tsx");
const canvasNode = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const assistantPanel = read("src/components/canvas/canvas-assistant-panel.tsx");
const imageEditor = read("src/components/canvas/canvas-image-editor.tsx");
const libraryRoute = read("src/app/api/library/route.ts");
const workspaceAccess = read("src/lib/server/canvas-workspace-access.ts");
const repository = read("src/lib/server/canvas-projects.ts");
const migration = read("db/migrations/017_canvas_projects.sql");

for (const source of [collectionRoute, projectRoute]) {
  assert.match(source, /requireAuthSession/);
}
assert.match(collectionRoute, /requireCsrf/);
assert.match(projectRoute, /requireCsrf/);
assert.match(repository, /CANVAS_PROJECT_CONFLICT/);

for (const endpoint of [
  "/api/providers/enabled",
  "/api/library",
  "/api/quota/precheck",
  "/api/generate/image",
  "/api/generate/video",
  "/api/jobs/",
]) {
  assert.ok(workspace.includes(endpoint), `canvas workspace missing existing API reuse: ${endpoint}`);
}

assert.doesNotMatch(workspace, /apiKey|api_key|authorization\s*:/i);
assert.match(repository, /where id = \$1 and user_id = \$2 and version = \$6/);
assert.match(migration, /user_id uuid not null references app_users\(local_user_id\) on delete cascade/);
assert.match(migration, /document jsonb not null/);
assert.match(migration, /canvas_projects_user_updated_idx/);

const imageSubmission = workspace.slice(
  workspace.indexOf("async function submitImageGeneration"),
  workspace.indexOf("async function submitVideoGeneration"),
);
const videoSubmission = workspace.slice(workspace.indexOf("async function submitVideoGeneration"));
for (const source of [imageSubmission, videoSubmission]) {
  assert.ok(
    source.indexOf("libraryItemFile") < source.indexOf('fetchJsonWithCsrf("/api/quota/precheck"'),
    "canvas must resolve reusable media before reserving quota",
  );
}
assert.match(workspace, /const savePromiseRef = useRef<Promise<boolean> \| null>\(null\)/);
assert.match(workspace, /const pendingSave = savePromiseRef\.current;[\s\S]+await pendingSave[\s\S]+saveNowRef\.current\(force\)/);
assert.match(workspace, /const flowRef = useRef\(flow\)/);
assert.match(workspace, /flowRef\.current\.setViewport/);
assert.match(workspace, /defaultViewport=\{viewport\}/);
assert.doesNotMatch(workspace, /\sfitView\s/);
assert.match(imageSubmission, /form\.set\("count", String\(count\)\)/);
assert.match(imageSubmission, /estimateImageGenerationTotalQuota\(\{ quality, count,/);
assert.match(imageSubmission, /items\.forEach\(\(item, index\) => addResultNode\(generatorId, item, null, index, items\.length\)\)/);
assert.match(workspace, /imageMode === "image-to-image"/);
assert.match(workspace, /historyPastRef/);
assert.match(workspace, /undoCanvas/);
assert.match(workspace, /redoCanvas/);
assert.match(workspace, /importCanvasFromText/);
assert.match(workspace, /exportCanvas/);
assert.match(workspace, /CanvasNodeInfoPanel/);
assert.match(canvasNode, /inputPreviews/);
assert.match(canvasNode, /canvas-node__preview-strip/);
assert.match(canvasCss, /canvas-node-info/);
assert.match(canvasCss, /canvas-node__preview-strip/);
assert.match(workspace, /selectedNodes/);
assert.match(workspace, /panOnDrag/);
assert.match(workspace, /selectionOnDrag=\{false\}/);
assert.match(workspace, /selectionKeyCode="Shift"/);
assert.match(workspace, /selectionMode=\{SelectionMode\.Partial\}/);
assert.match(workspace, /multiSelectionKeyCode=\{\["Control", "Meta", "Shift"\]\}/);
assert.doesNotMatch(workspace, /panMode|aria-label="框选节点"|aria-label="移动画布"/);
assert.match(workspace, /duplicateSelectedNodes/);
assert.match(workspace, /copySelectedNodes/);
assert.match(workspace, /pasteCopiedNodes/);
assert.match(workspace, /onPaneContextMenu/);
assert.match(workspace, /onNodeContextMenu/);
assert.match(workspace, /onEdgeContextMenu/);
assert.match(workspace, /onReconnect=\{onReconnect\}/);
assert.match(workspace, /reconnectEdge\(oldEdge, connection, current\)/);
assert.match(workspace, /onConnectEnd=\{onConnectEnd\}/);
assert.match(workspace, /document\.elementFromPoint\(event\.clientX, event\.clientY\)/);
assert.match(workspace, /dropTarget\.closest\("\.react-flow__node, \.react-flow__edge, \.react-flow__panel, \.canvas-bottom-dock"\)/);
assert.match(workspace, /edgeTypes=\{edgeTypes\}/);
assert.match(workspace, /connectionLineComponent=\{CanvasConnectionLine\}/);
assert.match(workspace, /decorateCanvasEdge/);
assert.match(canvasEdge, /EdgeToolbar/);
assert.match(canvasEdge, /BaseEdge/);
assert.match(canvasEdge, /connectionStatus === "invalid"/);
assert.match(canvasEdge, /props\.data\?\.label/);
assert.match(workspace, /groupSelectedNodes/);
assert.match(workspace, /toggleGroupCollapsed/);
assert.match(workspace, /applyCanvasNodePresentation/);
assert.match(workspace, /hidden: hiddenNodes\.has\(edge\.source\)/);
assert.match(workspace, /function CanvasLayersPanel/);
assert.match(workspace, /updateNodeLayerState/);
assert.match(workspace, /moveNodeLayer/);
assert.match(workspace, /draggable: !node\.data\.locked/);
assert.match(canvasCss, /canvas-layers__actions/);
assert.match(canvasNode, /展开分组/);
assert.match(canvasNode, /折叠分组/);
assert.match(canvasCss, /canvas-node-group\.is-collapsed/);
assert.match(workspace, /dragHandle: canvasNodeDragHandle\(data\.kind\)/);
assert.match(workspace, /dragHandle: "\.canvas-node-group__header"/);
assert.match(canvasCss, /\.canvas-node__header[\s\S]+cursor: grab/);
assert.match(workspace, /ungroupSelectedNodes/);
assert.match(workspace, /parentId: groupId/);
assert.match(workspace, /type: node\.data\.kind === "group" \? "group" : "canvas"/);
assert.match(canvasNode, /CanvasGroupNode/);
assert.match(canvasCss, /canvas-node-group/);
assert.match(canvasCss, /canvas-context-menu/);
assert.match(workspace, /connectSelectedNodes/);
assert.match(workspace, /cleanCanvas/);
assert.match(workspace, /exportCanvasImage/);
assert.match(workspace, /window\.addEventListener\("keydown"/);
assert.match(workspace, /selectAllVisibleNodes/);
assert.match(workspace, /nudgeSelectedNodes/);
assert.match(workspace, /arrangeSelectedNodes/);
assert.match(workspace, /distribute-horizontal/);
assert.match(workspace, /请选择同一分组层级中的节点进行排列/);
assert.match(canvasCss, /canvas-batch-menu__popover/);
assert.match(workspace, /event\.key === "ArrowLeft"/);
assert.match(workspace, /<span>全选节点<\/span>/);
assert.match(workspace, /BroadcastChannel\("aohuang-internal-canvas"\)/);
assert.match(workspace, /scope=\$\{canvasScope\(\)\}/);
assert.match(workspaceAccess, /scope.*personal/);
assert.match(assistantPanel, /\/api\/canvas\/assistant/);
assert.match(imageEditor, /destination-out/);
assert.match(imageEditor, /cropToAspect/);
assert.match(libraryRoute, /export async function PATCH/);
assert.match(libraryRoute, /requireCsrf/);
assert.match(canvasCss, /\.canvas-node__body--generator[^}]+overflow: visible/s);
assert.match(canvasCss, /\.react-flow__node-canvas:has\(\.canvas-node--generator\)/);
assert.match(canvasCss, /canvas-image-editor/);
assert.match(canvasCss, /react-flow__selection/);
assert.match(canvasCss, /data-canvas-theme="light"/);

console.log(JSON.stringify({
  ok: true,
  authenticatedRoutes: 2,
  reusedGenerationEndpoints: 6,
  generationSubmitted: false,
  databaseWritten: false,
}));
