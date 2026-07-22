#!/usr/bin/env node
import assert from "node:assert/strict";

const { filterCanvasLibraryItems, isCanvasLibraryItemInScope } = await import(new URL("../src/lib/canvas/library-scope.ts", import.meta.url));
const { canvasMediaMetadata, formatCanvasMediaSize, formatCanvasMediaWait } = await import(new URL("../src/lib/canvas/media-metadata.ts", import.meta.url));
const { normalizeCanvasDocument } = await import(new URL("../src/lib/canvas/document.ts", import.meta.url));

const personal = { id: "personal", params: {} };
const explicitPersonal = { id: "personal-explicit", params: { canvasScope: "personal" } };
const shared = { id: "shared", params: { canvasScope: "shared" } };

assert.equal(isCanvasLibraryItemInScope(personal, "personal"), true);
assert.equal(isCanvasLibraryItemInScope(personal, "shared"), false);
assert.deepEqual(filterCanvasLibraryItems([personal, explicitPersonal, shared], "personal").map((item) => item.id), ["personal", "personal-explicit"]);
assert.deepEqual(filterCanvasLibraryItems([personal, explicitPersonal, shared], "shared").map((item) => item.id), ["shared"]);

assert.equal(formatCanvasMediaSize(512), "512 B");
assert.equal(formatCanvasMediaSize(1_048_576), "1 MB");
assert.equal(formatCanvasMediaWait("2026-07-22T08:00:00.000Z", "2026-07-22T08:01:05.000Z"), "1分5秒");
assert.deepEqual(canvasMediaMetadata({ mediaOrigin: "upload", fileSize: 1_048_576 }), {
  created: "",
  size: "1 MB",
  wait: "",
});
const generatedMetadata = canvasMediaMetadata({
  mediaOrigin: "generated",
  createdAt: "2026-07-22T08:00:00.000Z",
  generationStartedAt: "2026-07-22T08:00:00.000Z",
  completedAt: "2026-07-22T08:01:05.000Z",
  fileSize: 2_097_152,
});
assert.ok(generatedMetadata.created);
assert.equal(generatedMetadata.size, "2 MB");
assert.equal(generatedMetadata.wait, "1分5秒");

const normalized = normalizeCanvasDocument({
  nodes: [{
    id: "media-1",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: {
      kind: "media",
      title: "结果",
      mediaType: "image",
      libraryItemId: "library-1",
      status: "done",
      createdAt: "2026-07-22T08:00:00.000Z",
      generationStartedAt: "2026-07-22T07:59:30.000Z",
      completedAt: "2026-07-22T08:00:05.000Z",
      fileSize: 2048,
      mediaOrigin: "generated",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(normalized.nodes[0].data.fileSize, 2048);
assert.equal(normalized.nodes[0].data.mediaOrigin, "generated");
assert.equal(normalized.nodes[0].data.completedAt, "2026-07-22T08:00:05.000Z");

console.log(JSON.stringify({ ok: true, checks: 17, generationSubmitted: false, databaseWritten: false }));
