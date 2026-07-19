#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const collectionRoute = read("src/app/api/canvas/projects/route.ts");
const projectRoute = read("src/app/api/canvas/projects/[id]/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const canvasNode = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
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

console.log(JSON.stringify({
  ok: true,
  authenticatedRoutes: 2,
  reusedGenerationEndpoints: 6,
  generationSubmitted: false,
  databaseWritten: false,
}));
