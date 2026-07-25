import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const folderDrop = read("src/lib/canvas/folder-drop.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");

assert.ok(folderDrop.includes("const audioExtension = /\\.(?:mp3|m4a|wav)$/i;"));
assert.ok(folderDrop.includes("const audioMime = /^audio\\/(?:mpeg|mp4|x-m4a|wav|x-wav)$/i;"));
assert.match(folderDrop, /export function canvasDropMediaType/);
assert.match(workspace, /canvasDropMediaType, collectCanvasFolderDropFiles/);
assert.match(workspace, /placeholder\.data\.mediaType === "audio"/);
assert.match(workspace, /await uploadCanvasAudioReference\(files\[index\]\)/);
assert.match(workspace, /height: mediaType === "audio" \? 180/);
assert.match(workspace, /filter\(isSupportedCanvasDropFile\)/);
assert.match(workspace, /audio\/mpeg,audio\/mp4,audio\/x-m4a,audio\/wav,audio\/x-wav/);

console.log(JSON.stringify({ ok: true, generationSubmitted: false, databaseWritten: false }));
