import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/canvas/video-trim/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");

assert.match(route, /BATCH_TRIM_SECONDS = 14\.9/);
assert.match(route, /MAX_BATCH_VIDEO_TRIMS = 12/);
assert.match(route, /libraryItemIds/);
assert.match(route, /for \(const id of libraryItemIds\)/);
assert.match(route, /probeVideoDuration/);
assert.match(route, /startSeconds: 0/);
assert.match(route, /endSeconds: BATCH_TRIM_SECONDS/);
assert.match(route, /item\.params\.sourceLibraryItemId === source\.id/);
assert.match(workspace, /batchTrimSelectedVideos/);
assert.match(workspace, /libraryItemIds, scope: canvasScope\(\)/);
assert.match(workspace, /trimCount=\{isInternalCanvas \? selectedVideoTrimCount : 0\}/);
assert.match(workspace, /批量裁剪视频/);

console.log(JSON.stringify({ ok: true, generationSubmitted: false, databaseWritten: false }));
