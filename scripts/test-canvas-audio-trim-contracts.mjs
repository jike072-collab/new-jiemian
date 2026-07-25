import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/canvas/audio-trim/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const canvasNode = read("src/components/canvas/canvas-node.tsx");
const trimService = read("src/lib/server/video-trim.ts");

assert.match(route, /requireCsrf/);
assert.match(route, /requireAuthSession/);
assert.match(route, /isInternalCanvasHostname/);
assert.match(route, /resolveProviderReference/);
assert.match(route, /MAX_VIDEO_TRIM_SECONDS/);
assert.match(route, /trimAudioToM4a/);
assert.match(route, /mimeType: "audio\/mp4"/);
assert.match(route, /audioReferenceParts/);
assert.match(trimService, /export async function trimAudioToM4a/);
assert.match(trimService, /"-map", "0:a:0"/);
assert.match(trimService, /"-c:a", "aac"/);
assert.match(workspace, /"\/api\/canvas\/audio-trim"/);
assert.match(workspace, /trimAudio: \(id: string\)/);
assert.match(workspace, /裁剪为开头 14\.9 秒/);
assert.match(workspace, /id: canvasId\("audio-trim"\)/);
assert.match(workspace, /已保留原音频，并在右侧添加 14\.9 秒裁剪副本/);
assert.match(workspace, /\.\.\.current\.map\(\(currentNode\)/);
assert.match(canvasNode, /trimAudio: \(id: string\)/);
assert.match(canvasNode, /actions\.trimAudio\(id\)/);

console.log(JSON.stringify({ ok: true, generationSubmitted: false, databaseWritten: false }));
