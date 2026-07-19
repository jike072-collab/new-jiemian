#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  CanvasDocumentError,
  emptyCanvasDocument,
  normalizeCanvasDocument,
  normalizeCanvasTitle,
} = await import(new URL("../src/lib/canvas/document.ts", import.meta.url));

assert.deepEqual(normalizeCanvasDocument(emptyCanvasDocument()), emptyCanvasDocument());
assert.equal(normalizeCanvasTitle("  公司广告画布  "), "公司广告画布");

const normalized = normalizeCanvasDocument({
  nodes: [{
    id: "node-media-1",
    type: "canvas",
    position: { x: 10, y: 20 },
    data: {
      kind: "media",
      title: "结果图",
      mediaType: "image",
      libraryItemId: "library-item-1",
      mediaUrl: "data:image/png;base64,should-not-persist",
      status: "done",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(normalized.nodes[0].data.libraryItemId, "library-item-1");
assert.equal(normalized.nodes[0].data.mediaUrl, undefined);

const imageGenerator = normalizeCanvasDocument({
  nodes: [{
    id: "node-generator-1",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: {
      kind: "generator",
      title: "图片生成",
      generationKind: "image",
      imageMode: "image-to-image",
      count: 9,
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(imageGenerator.nodes[0].data.imageMode, "image-to-image");
assert.equal(imageGenerator.nodes[0].data.count, 8);

const grouped = normalizeCanvasDocument({
  nodes: [
    { id: "group-1", type: "group", position: { x: 0, y: 0 }, width: 640, height: 480, data: { kind: "group", title: "广告分组" } },
    { id: "node-prompt-1", type: "canvas", parentId: "group-1", extent: "parent", position: { x: 24, y: 56 }, data: { kind: "prompt", title: "提示词", prompt: "test" } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(grouped.nodes[0].type, "group");
assert.equal(grouped.nodes[1].parentId, "group-1");
assert.equal(grouped.nodes[1].extent, "parent");

assert.throws(
  () => normalizeCanvasDocument({
    nodes: [{ id: "node-1", type: "canvas", parentId: "missing-group", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "提示词" } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
  CanvasDocumentError,
);

assert.throws(
  () => normalizeCanvasDocument({
    nodes: [{ id: "bad", position: { x: 0, y: 0 }, data: { kind: "unknown", title: "bad" } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
  CanvasDocumentError,
);

assert.throws(
  () => normalizeCanvasDocument({
    nodes: [{ id: "node-1", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "提示词", prompt: "test" } }],
    edges: [{ id: "edge-1", source: "node-1", target: "missing" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
  CanvasDocumentError,
);

assert.throws(
  () => normalizeCanvasDocument({
    nodes: Array.from({ length: 501 }, (_, index) => ({
      id: `node-${index}`,
      position: { x: index, y: index },
      data: { kind: "prompt", title: "提示词", prompt: "" },
    })),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
  CanvasDocumentError,
);

console.log(JSON.stringify({
  ok: true,
  checks: 13,
  generationSubmitted: false,
  databaseWritten: false,
}));
