#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  CanvasDocumentError,
  emptyCanvasDocument,
  normalizeCanvasDocument,
  normalizeCanvasTitle,
  removeLibraryItemsFromCanvasDocument,
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

const removedMedia = removeLibraryItemsFromCanvasDocument({
  nodes: [
    { id: "prompt-1", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "prompt" } },
    { id: "media-1", type: "canvas", position: { x: 200, y: 0 }, data: { kind: "media", title: "image", mediaType: "image", libraryItemId: "library-item-1", status: "done" } },
    { id: "generator-1", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "generator", title: "video", generationKind: "video", sourceNodeIds: ["media-1"], outputNodeId: "media-1" } },
  ],
  edges: [
    { id: "edge-1", source: "prompt-1", target: "media-1" },
    { id: "edge-2", source: "media-1", target: "generator-1" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}, ["library-item-1"]);
assert.deepEqual(removedMedia.removedNodeIds, ["media-1"]);
assert.equal(removedMedia.document.nodes.length, 2);
assert.deepEqual(removedMedia.document.edges, []);
assert.deepEqual(removedMedia.document.nodes.find((node) => node.id === "generator-1")?.data.sourceNodeIds, []);
assert.equal(removedMedia.document.nodes.find((node) => node.id === "generator-1")?.data.outputNodeId, undefined);

const audioReference = normalizeCanvasDocument({
  nodes: [{
    id: "node-audio-1",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: {
      kind: "media",
      title: "节奏参考",
      mediaType: "audio",
      mediaUrl: "/api/provider-reference/audio.mp3",
      status: "done",
      referenceBindings: [{ label: "@Audio1", role: "timing", transfer: "节拍", ignore: "原视频画面" }],
      sequenceState: { accepted: true, acceptedEndState: "音乐在强拍处收束" },
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(audioReference.nodes[0].data.mediaType, "audio");
assert.equal(audioReference.nodes[0].data.mediaUrl, "/api/provider-reference/audio.mp3");
assert.equal(audioReference.nodes[0].data.referenceBindings[0].role, "timing");
assert.equal(audioReference.nodes[0].data.sequenceState.accepted, true);

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
assert.equal(imageGenerator.nodes[0].data.count, 9);

const maxImageGenerator = normalizeCanvasDocument({
  nodes: [{
    id: "node-generator-max",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: { kind: "generator", title: "批量图片生成", generationKind: "image", count: 99 },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(maxImageGenerator.nodes[0].data.count, 15);

const grouped = normalizeCanvasDocument({
  nodes: [
    { id: "group-1", type: "group", position: { x: 0, y: 0 }, width: 280, height: 44, data: { kind: "group", title: "广告分组", collapsed: true, expandedWidth: 640, expandedHeight: 480, locked: true, zIndex: 7 } },
    { id: "node-prompt-1", type: "canvas", parentId: "group-1", extent: "parent", position: { x: 24, y: 56 }, data: { kind: "prompt", title: "提示词", prompt: "test", notes: "交付前检查品牌文字", hidden: true, zIndex: -2 } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(grouped.nodes[0].type, "group");
assert.equal(grouped.nodes[0].height, 44);
assert.equal(grouped.nodes[0].data.collapsed, true);
assert.equal(grouped.nodes[0].data.expandedWidth, 640);
assert.equal(grouped.nodes[0].data.expandedHeight, 480);
assert.equal(grouped.nodes[0].data.locked, true);
assert.equal(grouped.nodes[0].data.zIndex, 7);
assert.equal(grouped.nodes[1].parentId, "group-1");
assert.equal(grouped.nodes[1].extent, "parent");
assert.equal(grouped.nodes[1].data.hidden, true);
assert.equal(grouped.nodes[1].data.zIndex, -2);
assert.equal(grouped.nodes[1].data.notes, "交付前检查品牌文字");

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
  checks: 17,
  generationSubmitted: false,
  databaseWritten: false,
}));
