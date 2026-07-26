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
const { canvasMediaNodeSize, nearestCanvasAspectRatio, normalizeMediaDimensions } = await import(new URL("../src/lib/canvas/media-sizing.ts", import.meta.url));
const { absoluteCanvasNodePosition } = await import(new URL("../src/lib/canvas/node-position.ts", import.meta.url));
const { matchPendingGeneratedMedia } = await import(new URL("../src/lib/canvas/pending-results.ts", import.meta.url));

const rootPositionNode = { id: "root-position", position: { x: 120, y: 80 } };
const groupPositionNode = { id: "group-position", position: { x: 600, y: 400 } };
const childPositionNode = { id: "child-position", parentId: groupPositionNode.id, position: { x: 40, y: 30 } };
const nestedPositionNode = { id: "nested-position", parentId: childPositionNode.id, position: { x: 5, y: 7 } };
assert.deepEqual(absoluteCanvasNodePosition(rootPositionNode, [rootPositionNode]), { x: 120, y: 80 });
assert.deepEqual(absoluteCanvasNodePosition(childPositionNode, [groupPositionNode, childPositionNode]), { x: 640, y: 430 });
assert.deepEqual(absoluteCanvasNodePosition(nestedPositionNode, [groupPositionNode, childPositionNode, nestedPositionNode]), { x: 645, y: 437 });
assert.deepEqual(absoluteCanvasNodePosition({ id: "missing-child", parentId: "missing", position: { x: 8, y: 9 } }, []), { x: 8, y: 9 });
const cyclicPositionNodes = [
  { id: "cycle-a", parentId: "cycle-b", position: { x: 10, y: 20 } },
  { id: "cycle-b", parentId: "cycle-a", position: { x: 30, y: 40 } },
];
assert.deepEqual(absoluteCanvasNodePosition(cyclicPositionNodes[0], cyclicPositionNodes), { x: 40, y: 60 });

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
      assistantProductId: "product-1",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  assistantState: {
    commerce: {
      products: {
        "product-1": {
          id: "product-1",
          createdAt: "2026-07-26T00:00:00.000Z",
          updatedAt: "2026-07-26T00:01:00.000Z",
          images: [{ nodeId: "node-media-1", libraryItemId: "library-item-1", title: "结果图" }],
          productName: "复古系带鞋",
          sellingPoints: ["厚底视觉", "复古配色", "鞋面拼接", "系带结构"],
          visibleFacts: ["米白色鞋面"],
          recommendedDirections: ["daily-style", "product-asmr"],
          selectedDirections: ["product-asmr"],
          directionSellingPoints: { "product-asmr": "鞋面拼接" },
          creativeOptions: [
            { id: "hook-1", style: "pain-point", title: "穿搭不够醒目", hookLine: "Outfit nampak terlalu biasa?", scene: "马来西亚公寓玄关", visualBeat: "人物抬起鞋子" },
            { id: "hook-2", style: "contrast", title: "换鞋反差", hookLine: "Tengok beza bila tukar kasut.", scene: "商场走廊", visualBeat: "踩点换鞋" },
            { id: "hook-3", style: "motion", title: "公园快走前后", hookLine: "Kasut mana ngam untuk jalan hari ni?", scene: "公园遮雨步道", visualBeat: "人物看着鞋架犹豫" },
          ],
          selectedCreativeOptionId: "hook-2",
          activePlanId: "missing-plan",
          plans: [{
            id: "plan-1",
            direction: "product-asmr",
            title: "细节方案",
            sellingPoint: "鞋面拼接",
            hook: {
              visualPatternId: "product-asmr-detail",
              copyPatternId: "expectation-gap",
              title: "拼接细节预期落差",
              reason: "微距直接证明可见结构。",
              hookLine: "Tak sangka detail ni menyerlah",
              onScreenText: "Detail ni memang menyerlah",
              scene: "室内产品桌面",
              visualBeat: "第一帧手指已轻触鞋面拼接。",
            },
            production: {
              scenePatternId: "studio-tactile-table",
              shotPatternId: "macro-pullback-rotate-hero",
              performancePatternId: "quiet-tactile-focus",
              energy: "balanced",
              emotionArc: "细节吸引到视觉满足",
              realismNotes: "真实手部轻触并保留自然停顿",
            },
            shots: [
              { timeRange: "0-2秒", shotSize: "极近景", camera: "固定微距", action: "轻触拼接", performance: "动作轻缓", productState: "鞋子静置", dialogue: "无口播", onScreenText: "Detail ni memang menyerlah", sound: "轻触声", transition: "强拍后拉" },
              { timeRange: "2-7秒", shotSize: "近景", camera: "快速后拉", action: "展示鞋型", performance: "手部自然调整", productState: "侧面完整", dialogue: "无口播", onScreenText: "", sound: "音乐进入", transition: "手部转动" },
              { timeRange: "7-12秒", shotSize: "特写", camera: "短推进", action: "展示鞋带", performance: "停顿确认", productState: "结构一致", dialogue: "无口播", onScreenText: "", sound: "鞋带声", transition: "提示音切换" },
              { timeRange: "12-15秒", shotSize: "中近景", camera: "固定机位", action: "产品稳定收束", performance: "双手退出", productState: "完整展示", dialogue: "无口播", onScreenText: "", sound: "音乐收束", transition: "停留结束" },
            ],
            prompt: "0-2 秒钩子",
            referenceBindings: [{ label: "@Image1", role: "product" }],
            publishingCopy: {
              title: "Detail dia terus tarik mata",
              caption: "Lapisan atas nampak jelas dari dekat.",
              hashtags: ["#kasut", "#shoes", "#sneakers", "#kasutharian", "#fyp"],
              angle: "detail",
              category: "casual",
            },
            selected: true,
          }],
          extraRequirements: "不要包装",
          phase: "plans-ready",
        },
      },
    },
  },
});
assert.equal(normalized.nodes[0].data.libraryItemId, "library-item-1");
assert.equal(normalized.nodes[0].data.mediaUrl, undefined);
assert.equal(normalized.nodes[0].data.intrinsicWidth, 1080);
assert.equal(normalized.nodes[0].data.intrinsicHeight, 1920);
assert.equal(normalized.nodes[0].data.assistantProductId, "product-1");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].plans[0].direction, "product-asmr");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].activePlanId, "plan-1");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].directionSellingPoints["product-asmr"], "鞋面拼接");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].creativeOptions?.length, 3);
assert.equal(normalized.assistantState?.commerce?.products["product-1"].selectedCreativeOptionId, "hook-2");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].plans[0].hook?.visualPatternId, "product-asmr-detail");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].plans[0].production?.shotPatternId, "macro-pullback-rotate-hero");
assert.equal(normalized.assistantState?.commerce?.products["product-1"].plans[0].shots?.length, 4);
assert.equal(normalized.assistantState?.commerce?.products["product-1"].plans[0].publishingCopy?.hashtags.includes("#fyp"), false);

const createdOnlyProduct = normalized.assistantState?.commerce?.products["product-1"];
const createdOnlyDocument = normalizeCanvasDocument({
  ...normalized,
  assistantState: {
    commerce: {
      products: createdOnlyProduct ? {
        "product-1": {
          ...createdOnlyProduct,
          activePlanId: undefined,
          phase: "setup",
          plans: createdOnlyProduct.plans.map((plan) => ({ ...plan, createdGeneratorNodeId: "generator-old" })),
        },
      } : {},
    },
  },
});
assert.equal(createdOnlyDocument.assistantState?.commerce?.products["product-1"].activePlanId, undefined);

assert.deepEqual(canvasMediaNodeSize(1920, 1080), { width: 420, height: 310, frameWidth: 418, frameHeight: 235 });
assert.deepEqual(canvasMediaNodeSize(1080, 1920), { width: 260, height: 534, frameWidth: 258, frameHeight: 459 });
assert.deepEqual(canvasMediaNodeSize(1024, 1024), { width: 360, height: 433, frameWidth: 358, frameHeight: 358 });
assert.equal(normalizeMediaDimensions(0, 1080), null);
assert.equal(normalizeMediaDimensions(Number.NaN, 1080), null);
assert.equal(nearestCanvasAspectRatio(1080, 1920, ["16:9", "9:16"]), "9:16");
assert.equal(nearestCanvasAspectRatio(1920, 1080, ["16:9", "9:16"]), "16:9");
assert.equal(nearestCanvasAspectRatio(1080, 1350, ["1:1", "16:9", "9:16", "4:3", "3:4"]), "3:4");
assert.equal(nearestCanvasAspectRatio(0, 1080, ["16:9", "9:16"]), null);

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
      progress: 42,
      jobId: "job-pending-image-1",
      generationRequestId: "request-pending-image-1",
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(pendingResult.nodes[0].data.libraryItemId, undefined);
assert.equal(pendingResult.nodes[0].data.status, "generating");
assert.equal(pendingResult.nodes[0].data.progress, 42);
assert.equal(pendingResult.nodes[0].data.jobId, "job-pending-image-1");
assert.equal(pendingResult.nodes[0].data.generationRequestId, "request-pending-image-1");

const recoveredPending = matchPendingGeneratedMedia([
  { id: "generator-recovery", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", providerId: "video-provider" } },
  { id: "pending-recovery", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "视频生成中", mediaType: "video", mediaOrigin: "generated", sourceNodeIds: ["generator-recovery"], status: "queued", generationStartedAt: "2026-07-23T10:27:53.596Z" } },
], [{
  id: "library-recovery",
  type: "video",
  mode: "image-to-video",
  title: "Recovered",
  prompt: "prompt",
  providerId: "video-provider",
  model: "video-model",
  status: "failed",
  createdAt: "2026-07-23T10:28:07.338Z",
  updatedAt: "2026-07-23T10:35:15.171Z",
  params: { canvasRequestedAt: "2026-07-23T10:28:00.188Z" },
}]);
assert.equal(recoveredPending.get("pending-recovery"), "library-recovery");

const exactPending = matchPendingGeneratedMedia([
  { id: "generator-exact", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", providerId: "video-provider" } },
  { id: "pending-exact", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "视频生成中", mediaType: "video", mediaOrigin: "generated", sourceNodeIds: ["generator-exact"], status: "queued", generationRequestId: "canvas-video-request" } },
], [{
  id: "library-exact",
  type: "video",
  mode: "image-to-video",
  title: "Exact",
  prompt: "prompt",
  providerId: "video-provider",
  model: "video-model",
  status: "done",
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:05:00.000Z",
  params: { billingTaskId: "canvas-video-request" },
}]);
assert.equal(exactPending.get("pending-exact"), "library-exact");

const recoveredFailed = matchPendingGeneratedMedia([
  { id: "generator-failed", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", providerId: "video-provider" } },
  { id: "pending-failed", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "视频生成中", mediaType: "video", mediaOrigin: "generated", sourceNodeIds: ["generator-failed"], status: "failed", generationRequestId: "canvas-video-request", generationStartedAt: "2026-07-23T10:27:53.596Z" } },
], [{
  id: "library-failed",
  type: "video",
  mode: "image-to-video",
  title: "Failed",
  prompt: "prompt",
  providerId: "video-provider",
  model: "video-model",
  status: "failed",
  createdAt: "2026-07-23T10:28:07.338Z",
  updatedAt: "2026-07-23T10:35:15.171Z",
  params: { canvasRequestedAt: "2026-07-23T10:28:00.188Z" },
}]);
assert.equal(recoveredFailed.get("pending-failed"), "library-failed");

const recoveredDone = matchPendingGeneratedMedia([
  { id: "generator-done", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", providerId: "video-provider" } },
  { id: "pending-done", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "视频生成完成", mediaType: "video", mediaOrigin: "generated", sourceNodeIds: ["generator-done"], status: "done", generationRequestId: "canvas-video-request", generationStartedAt: "2026-07-23T10:27:53.596Z" } },
], [{
  id: "library-done",
  type: "video",
  mode: "image-to-video",
  title: "Done",
  prompt: "prompt",
  providerId: "video-provider",
  model: "video-model",
  status: "done",
  createdAt: "2026-07-23T10:28:07.338Z",
  updatedAt: "2026-07-23T10:35:15.171Z",
  params: { canvasRequestedAt: "2026-07-23T10:28:00.188Z" },
}]);
assert.equal(recoveredDone.get("pending-done"), "library-done");

const ambiguousPending = matchPendingGeneratedMedia([
  { id: "generator-ambiguous", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", providerId: "video-provider" } },
  { id: "pending-ambiguous", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "视频生成中", mediaType: "video", mediaOrigin: "generated", sourceNodeIds: ["generator-ambiguous"], status: "queued", generationStartedAt: "2026-07-23T10:27:53.596Z" } },
], [
  { id: "candidate-a", type: "video", mode: "image-to-video", title: "A", prompt: "a", providerId: "video-provider", model: "video-model", status: "done", createdAt: "2026-07-23T10:28:01.000Z", updatedAt: "2026-07-23T10:28:01.000Z", params: { canvasRequestedAt: "2026-07-23T10:28:00.000Z" } },
  { id: "candidate-b", type: "video", mode: "image-to-video", title: "B", prompt: "b", providerId: "video-provider", model: "video-model", status: "done", createdAt: "2026-07-23T10:28:02.000Z", updatedAt: "2026-07-23T10:28:02.000Z", params: { canvasRequestedAt: "2026-07-23T10:28:01.000Z" } },
]);
assert.equal(ambiguousPending.has("pending-ambiguous"), false);

const migratedVideoJob = normalizeCanvasDocument({
  nodes: [
    { id: "generator-video-legacy", type: "canvas", position: { x: 0, y: 0 }, data: { kind: "generator", title: "Video", generationKind: "video", status: "queued", progress: 18, jobId: "job-video-legacy", outputNodeId: "result-video-legacy" } },
    { id: "result-video-legacy", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "media", title: "Result", mediaType: "video", libraryItemId: "library-video-legacy", sourceNodeIds: ["generator-video-legacy"], status: "queued" } },
  ],
  edges: [{ id: "edge-video-legacy", source: "generator-video-legacy", target: "result-video-legacy" }],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(migratedVideoJob.nodes[0].data.status, "idle");
assert.equal(migratedVideoJob.nodes[0].data.jobId, undefined);
assert.equal(migratedVideoJob.nodes[1].data.status, "queued");
assert.equal(migratedVideoJob.nodes[1].data.progress, 18);
assert.equal(migratedVideoJob.nodes[1].data.jobId, "job-video-legacy");
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
  ratioAutoAdjusted: true,
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
assert.equal(duplicatedGenerator.ratioAutoAdjusted, undefined);
assert.deepEqual(duplicatedGenerator.sourceNodeIds, ["prompt-copy"]);
assert.equal(duplicatedGenerator.providerId, "video-provider");
assert.equal(duplicatedGenerator.duration, 14);

const duplicatedWithExternalInput = duplicateCanvasNodeData({
  kind: "generator",
  title: "Video generator",
  generationKind: "video",
  sourceNodeIds: ["source-original"],
  status: "idle",
}, new Map());
assert.deepEqual(duplicatedWithExternalInput.sourceNodeIds, ["source-original"]);

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
    { id: "media-failed", type: "canvas", position: { x: 200, y: 400 }, data: { kind: "media", title: "failed", mediaType: "video", libraryItemId: "library-failed", status: "failed", error: "视频生成任务失败。" } },
    { id: "generator-after-expired", type: "canvas", position: { x: 400, y: 0 }, data: { kind: "generator", title: "next", generationKind: "video", sourceNodeIds: ["media-expired"], outputNodeId: "media-expired" } },
  ],
  edges: [
    { id: "edge-expired", source: "media-expired", target: "generator-after-expired" },
    { id: "edge-keep", source: "media-keep", target: "generator-after-expired" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}, ["library-keep"]);
assert.deepEqual(reconciledMedia.removedNodeIds, ["media-expired"]);
assert.deepEqual(reconciledMedia.document.nodes.map((node) => node.id), ["media-keep", "media-pending", "media-failed", "generator-after-expired"]);
assert.equal(reconciledMedia.document.nodes.find((node) => node.id === "media-failed")?.data.error, "视频生成任务失败。");
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
      ratioAutoAdjusted: true,
    },
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
assert.equal(imageGenerator.nodes[0].data.imageMode, "image-to-image");
assert.equal(imageGenerator.nodes[0].data.count, 9);
assert.equal(imageGenerator.nodes[0].data.ratioAutoAdjusted, true);

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
