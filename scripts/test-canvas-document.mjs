#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  CanvasDocumentError,
  emptyCanvasDocument,
  normalizeCanvasDocument,
  normalizeCanvasTitle,
  removeLibraryItemsFromCanvasDocument,
  removeUnavailableLibraryItemsFromCanvasDocument,
} = await import(new URL("../src/lib/canvas/document.ts", import.meta.url));
const { duplicateCanvasNodeData } = await import(new URL("../src/lib/canvas/duplicate.ts", import.meta.url));
const { canvasMediaNodeSize, normalizeMediaDimensions } = await import(new URL("../src/lib/canvas/media-sizing.ts", import.meta.url));

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
      intrinsicWidth: 1080,
      intrinsicHeight: 1920,
      status: "done",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(normalized.nodes[0].data.libraryItemId, "library-item-1");
assert.equal(normalized.nodes[0].data.mediaUrl, undefined);
assert.equal(normalized.nodes[0].data.intrinsicWidth, 1080);
assert.equal(normalized.nodes[0].data.intrinsicHeight, 1920);

assert.deepEqual(canvasMediaNodeSize(1920, 1080), { width: 420, height: 306, frameWidth: 420, frameHeight: 236 });
assert.deepEqual(canvasMediaNodeSize(1080, 1920), { width: 260, height: 532, frameWidth: 260, frameHeight: 462 });
assert.deepEqual(canvasMediaNodeSize(1024, 1024), { width: 360, height: 430, frameWidth: 360, frameHeight: 360 });
assert.equal(normalizeMediaDimensions(0, 1080), null);
assert.equal(normalizeMediaDimensions(Number.NaN, 1080), null);

const pendingResult = normalizeCanvasDocument({
  nodes: [{
    id: "pending-image-1",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: {
      kind: "media",
      title: "Pending image",
      mediaType: "image",
      sourceNodeIds: ["generator-1"],
      status: "generating",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(pendingResult.nodes[0].data.libraryItemId, undefined);
assert.equal(pendingResult.nodes[0].data.status, "generating");
assert.throws(
  () => normalizeCanvasDocument({
    nodes: [{ id: "invalid-image", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "media", title: "Invalid image", mediaType: "image", status: "done" } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
  CanvasDocumentError,
);

const duplicatedGenerator = duplicateCanvasNodeData({
  kind: "generator",
  title: "Video generator",
  generationKind: "video",
  providerId: "video-provider",
  ratio: "16:9",
  duration: 14,
  status: "generating",
  progress: 38,
  jobId: "old-job",
  outputNodeId: "old-output",
  error: "old-error",
  sourceNodeIds: ["prompt-old"],
}, new Map([["prompt-old", "prompt-copy"]]), "2026-07-20T00:00:00.000Z");
assert.equal(duplicatedGenerator.title, "Video generator 副本");
assert.equal(duplicatedGenerator.status, "idle");
assert.equal(duplicatedGenerator.progress, 0);
assert.equal(duplicatedGenerator.jobId, undefined);
assert.equal(duplicatedGenerator.outputNodeId, undefined);
assert.equal(duplicatedGenerator.error, undefined);
assert.deepEqual(duplicatedGenerator.sourceNodeIds, ["prompt-copy"]);
assert.equal(duplicatedGenerator.providerId, "video-provider");
assert.equal(duplicatedGenerator.duration, 14);

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

const reconciledMedia = removeUnavailableLibraryItemsFromCanvasDocument({
  nodes: [
    { id: "media-keep", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "media", title: "keep", mediaType: "image", libraryItemId: "library-keep", status: "done" } },
    { id: "media-expired", type: "canvas", position: { x: 200, y: 0 }, data: { kind: "media", title: "expired", mediaType: "video", libraryItemId: "library-expired", status: "done" } },
    { id: "media-pending", type: "canvas", position: { x: 200, y: 200 }, data: { kind: "media", title: "pending", mediaType: "video", libraryItemId: "library-pending", status: "generating" } },
    { id: "generator-after-expired", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "generator", title: "next", generationKind: "video", sourceNodeIds: ["media-expired"], outputNodeId: "media-expired" } },
  ],
  edges: [
    { id: "edge-expired", source: "media-expired", target: "generator-after-expired" },
    { id: "edge-keep", source: "media-keep", target: "generator-after-expired" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}, ["library-keep"]);
assert.deepEqual(reconciledMedia.removedNodeIds, ["media-expired"]);
assert.deepEqual(reconciledMedia.document.nodes.map((node) => node.id), ["media-keep", "media-pending", "generator-after-expired"]);
assert.deepEqual(reconciledMedia.document.edges.map((edge) => edge.id), ["edge-keep"]);
assert.deepEqual(reconciledMedia.document.nodes.find((node) => node.id === "generator-after-expired")?.data.sourceNodeIds, []);
assert.equal(reconciledMedia.document.nodes.find((node) => node.id === "generator-after-expired")?.data.outputNodeId, undefined);

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
  checks: 29,
  generationSubmitted: false,
  databaseWritten: false,
}));
