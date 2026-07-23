import type {
  CanvasGenerationKind,
  CanvasGeneratorStatus,
  CanvasMediaType,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasProjectDocument,
  CanvasReferenceBinding,
  CanvasReferenceRole,
  CanvasSequenceState,
  CanvasStoredEdge,
  CanvasStoredNode,
} from "./types";

const maxDocumentBytes = 1_500_000;
const maxNodes = 500;
const maxEdges = 1_000;

const nodeKinds = new Set<CanvasNodeKind>(["prompt", "media", "generator", "group"]);
const mediaTypes = new Set<CanvasMediaType>(["image", "video", "audio"]);
const referenceRoles = new Set<CanvasReferenceRole>(["identity", "first-frame", "last-frame", "product", "environment", "motion", "camera", "timing", "audio", "style"]);
const generationKinds = new Set<CanvasGenerationKind>(["image", "video"]);
const generatorStatuses = new Set<CanvasGeneratorStatus>(["idle", "queued", "generating", "done", "failed"]);

export class CanvasDocumentError extends Error {
  readonly code = "CANVAS_DOCUMENT_INVALID";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "CanvasDocumentError";
  }
}

export function emptyCanvasDocument(): CanvasProjectDocument {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function normalizeCanvasTitle(value: unknown) {
  const title = boundedString(value, 120).trim();
  if (!title) throw new CanvasDocumentError("画布名称不能为空。");
  return title;
}

export function normalizeCanvasDocument(value: unknown): CanvasProjectDocument {
  if (!isRecord(value)) throw new CanvasDocumentError("画布数据格式无效。");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxDocumentBytes) {
    throw new CanvasDocumentError("画布内容过大，请删除部分节点后重试。");
  }
  if (!Array.isArray(value.nodes) || value.nodes.length > maxNodes) {
    throw new CanvasDocumentError(`画布节点不能超过 ${maxNodes} 个。`);
  }
  if (!Array.isArray(value.edges) || value.edges.length > maxEdges) {
    throw new CanvasDocumentError(`画布连线不能超过 ${maxEdges} 条。`);
  }

  const nodes = value.nodes.map(normalizeNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new CanvasDocumentError("画布节点 ID 重复。");
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.data.kind !== "generator" || !node.data.jobId || !node.data.outputNodeId) continue;
    if (node.data.status !== "queued" && node.data.status !== "generating") continue;
    const resultNode = nodesById.get(node.data.outputNodeId);
    if (resultNode?.data.kind !== "media") continue;
    resultNode.data.jobId ||= node.data.jobId;
    resultNode.data.status = node.data.status;
    resultNode.data.progress = node.data.progress;
    if (node.data.error) resultNode.data.error = node.data.error;
    node.data.status = "idle";
    node.data.progress = 0;
    delete node.data.jobId;
    delete node.data.error;
  }
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent || parent.data.kind !== "group" || node.data.kind === "group") {
      throw new CanvasDocumentError("画布分组关系无效。");
    }
  }
  const edges = value.edges.map((edge) => normalizeEdge(edge, nodeIds));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  if (edgeIds.size !== edges.length) throw new CanvasDocumentError("画布连线 ID 重复。");

  return {
    nodes,
    edges,
    viewport: normalizeViewport(value.viewport),
  };
}

export function removeLibraryItemsFromCanvasDocument(value: unknown, libraryItemIds: Iterable<string>) {
  const document = normalizeCanvasDocument(value);
  const deletedLibraryItemIds = new Set(Array.from(libraryItemIds, (id) => String(id || "").trim()).filter(Boolean));
  const removedNodeIds = new Set(
    document.nodes
      .filter((node) => node.data.kind === "media" && node.data.libraryItemId && deletedLibraryItemIds.has(node.data.libraryItemId))
      .map((node) => node.id),
  );
  if (!removedNodeIds.size) return { document, removedNodeIds: [] as string[] };

  const nodes = document.nodes
    .filter((node) => !removedNodeIds.has(node.id))
    .map((node) => {
      const sourceNodeIds = node.data.sourceNodeIds?.filter((sourceNodeId) => !removedNodeIds.has(sourceNodeId));
      const nextData = { ...node.data };
      if (sourceNodeIds) nextData.sourceNodeIds = sourceNodeIds;
      if (nextData.outputNodeId && removedNodeIds.has(nextData.outputNodeId)) delete nextData.outputNodeId;
      return { ...node, data: nextData };
    });
  const remainingNodeIds = new Set(nodes.map((node) => node.id));
  const edges = document.edges.filter((edge) => remainingNodeIds.has(edge.source) && remainingNodeIds.has(edge.target));
  return {
    document: { ...document, nodes, edges },
    removedNodeIds: Array.from(removedNodeIds),
  };
}

export function removeUnavailableLibraryItemsFromCanvasDocument(value: unknown, availableLibraryItemIds: Iterable<string>) {
  const document = normalizeCanvasDocument(value);
  const availableIds = new Set(Array.from(availableLibraryItemIds, (id) => String(id || "").trim()).filter(Boolean));
  const unavailableIds = document.nodes.flatMap((node) => (
    node.data.kind === "media"
    && node.data.libraryItemId
    && node.data.status !== "queued"
    && node.data.status !== "generating"
    && node.data.status !== "failed"
    && !availableIds.has(node.data.libraryItemId)
      ? [node.data.libraryItemId]
      : []
  ));
  return removeLibraryItemsFromCanvasDocument(document, unavailableIds);
}

function normalizeNode(value: unknown): CanvasStoredNode {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.data)) {
    throw new CanvasDocumentError("画布节点格式无效。");
  }
  const id = identifier(value.id, "节点 ID");
  const kind = boundedString(value.data.kind, 20) as CanvasNodeKind;
  if (!nodeKinds.has(kind)) throw new CanvasDocumentError("画布节点类型无效。");

  const data: CanvasNodeData = {
    kind,
    title: boundedString(value.data.title, 120).trim() || defaultNodeTitle(kind, value.data.generationKind),
    hidden: Boolean(value.data.hidden),
    locked: Boolean(value.data.locked),
    zIndex: boundedNumber(value.data.zIndex, -10_000, 10_000, 0),
  };
  const prompt = optionalString(value.data.prompt, 30_000);
  if (prompt !== undefined) data.prompt = prompt;
  const notes = optionalString(value.data.notes, 2_000);
  if (notes !== undefined) data.notes = notes;
  const referenceBindings = normalizeReferenceBindings(value.data.referenceBindings);
  if (referenceBindings.length) data.referenceBindings = referenceBindings;
  const sequenceState = normalizeSequenceState(value.data.sequenceState);
  if (sequenceState) data.sequenceState = sequenceState;
  const createdAt = optionalString(value.data.createdAt, 64);
  const completedAt = optionalString(value.data.completedAt, 64);
  const generationStartedAt = optionalString(value.data.generationStartedAt, 64);
  const generationRequestId = optionalIdentifier(value.data.generationRequestId, 160);
  const model = optionalString(value.data.model, 240);
  if (createdAt) data.createdAt = createdAt;
  if (completedAt) data.completedAt = completedAt;
  if (generationStartedAt) data.generationStartedAt = generationStartedAt;
  if (generationRequestId) data.generationRequestId = generationRequestId;
  if (model) data.model = model;
  if (Array.isArray(value.data.sourceNodeIds)) {
    data.sourceNodeIds = value.data.sourceNodeIds
      .slice(0, 32)
      .map((source) => optionalIdentifier(source, 160))
      .filter((source): source is string => Boolean(source));
  }

  if (kind === "media") {
    const mediaType = boundedString(value.data.mediaType, 16) as CanvasMediaType;
    if (!mediaTypes.has(mediaType)) throw new CanvasDocumentError("媒体节点类型无效。");
    data.mediaType = mediaType;
    const status = normalizeStatus(value.data.status, "done");
    if (mediaType === "audio") {
      const mediaUrl = optionalString(value.data.mediaUrl, 2_000);
      if (mediaUrl && /^(https?:\/\/|\/)/i.test(mediaUrl)) data.mediaUrl = mediaUrl;
    }
    const libraryItemId = optionalIdentifier(value.data.libraryItemId, 160);
    const pendingGeneratorResult = Boolean(data.sourceNodeIds?.length)
      && (status === "queued" || status === "generating" || status === "failed");
    if (mediaType !== "audio" && !libraryItemId && !pendingGeneratorResult) throw new CanvasDocumentError("作品 ID无效。");
    if (libraryItemId) data.libraryItemId = libraryItemId;
    const intrinsicWidth = boundedNumber(value.data.intrinsicWidth, 1, 32_768, 0);
    const intrinsicHeight = boundedNumber(value.data.intrinsicHeight, 1, 32_768, 0);
    if (intrinsicWidth && intrinsicHeight) {
      data.intrinsicWidth = Math.round(intrinsicWidth);
      data.intrinsicHeight = Math.round(intrinsicHeight);
    }
    const fileSize = boundedNumber(value.data.fileSize, 1, Number.MAX_SAFE_INTEGER, 0);
    if (fileSize) data.fileSize = Math.round(fileSize);
    const mediaOrigin = optionalString(value.data.mediaOrigin, 16);
    if (mediaOrigin === "upload" || mediaOrigin === "generated") data.mediaOrigin = mediaOrigin;
    data.status = status;
    data.progress = boundedNumber(value.data.progress, 0, 100, 0);
    const jobId = optionalIdentifier(value.data.jobId, 160);
    const error = optionalString(value.data.error, 2_000);
    if (jobId) data.jobId = jobId;
    if (error) data.error = error;
  }

  if (kind === "generator") {
    const generationKind = boundedString(value.data.generationKind, 16) as CanvasGenerationKind;
    if (!generationKinds.has(generationKind)) throw new CanvasDocumentError("生成节点类型无效。");
    data.generationKind = generationKind;
    data.providerId = optionalString(value.data.providerId, 240) || "";
    if (generationKind === "image") {
      const imageMode = optionalString(value.data.imageMode, 32);
      data.imageMode = imageMode === "image-to-image" ? "image-to-image" : "text-to-image";
      data.count = boundedNumber(value.data.count, 1, 15, 1);
    }
    data.ratio = optionalString(value.data.ratio, 32) || (generationKind === "image" ? "1:1" : "16:9");
    if (value.data.ratioAutoAdjusted) data.ratioAutoAdjusted = true;
    data.quality = optionalString(value.data.quality, 32) || "1k";
    data.duration = boundedNumber(value.data.duration, 1, 60, 5);
    data.resolution = optionalString(value.data.resolution, 32) || "720p";
    data.status = normalizeStatus(value.data.status, "idle");
    data.progress = boundedNumber(value.data.progress, 0, 100, 0);
    const jobId = optionalIdentifier(value.data.jobId, 160);
    const outputNodeId = optionalIdentifier(value.data.outputNodeId, 160);
    const error = optionalString(value.data.error, 2_000);
    if (jobId) data.jobId = jobId;
    if (outputNodeId) data.outputNodeId = outputNodeId;
    if (error) data.error = error;
  }

  if (kind === "group") {
    data.collapsed = Boolean(value.data.collapsed);
    data.expandedWidth = boundedNumber(value.data.expandedWidth, 360, 2_400, 640);
    data.expandedHeight = boundedNumber(value.data.expandedHeight, 280, 1_800, 480);
  }

  const width = optionalDimension(value.width, kind === "group" ? 220 : 160, kind === "group" ? 2_400 : 1_200);
  const height = optionalDimension(value.height, kind === "group" ? 44 : 160, kind === "group" ? 1_800 : 1_200);
  const parentId = optionalIdentifier(value.parentId, 160);
  return {
    id,
    type: kind === "group" ? "group" : "canvas",
    position: {
      x: boundedNumber(value.position.x, -1_000_000, 1_000_000, 0),
      y: boundedNumber(value.position.y, -1_000_000, 1_000_000, 0),
    },
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data,
  };
}

function normalizeEdge(value: unknown, nodeIds: Set<string>): CanvasStoredEdge {
  if (!isRecord(value)) throw new CanvasDocumentError("画布连线格式无效。");
  const id = identifier(value.id, "连线 ID");
  const source = identifier(value.source, "连线起点");
  const target = identifier(value.target, "连线终点");
  if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
    throw new CanvasDocumentError("画布连线指向了无效节点。");
  }
  const sourceHandle = optionalIdentifier(value.sourceHandle, 80);
  const targetHandle = optionalIdentifier(value.targetHandle, 80);
  return {
    id,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
  };
}

function normalizeViewport(value: unknown) {
  if (!isRecord(value)) return emptyCanvasDocument().viewport;
  return {
    x: boundedNumber(value.x, -1_000_000, 1_000_000, 0),
    y: boundedNumber(value.y, -1_000_000, 1_000_000, 0),
    zoom: boundedNumber(value.zoom, 0.05, 4, 1),
  };
}

function normalizeStatus(value: unknown, fallback: CanvasGeneratorStatus) {
  const status = boundedString(value, 20) as CanvasGeneratorStatus;
  return generatorStatuses.has(status) ? status : fallback;
}

function normalizeReferenceBindings(value: unknown): CanvasReferenceBinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const label = boundedString(candidate.label, 24).trim();
    const role = boundedString(candidate.role, 24) as CanvasReferenceRole;
    if (!/^@(Image|Video|Audio)\d+$/i.test(label) || !referenceRoles.has(role)) return [];
    const transfer = optionalString(candidate.transfer, 240);
    const ignore = optionalString(candidate.ignore, 240);
    return [{ label, role, ...(transfer ? { transfer } : {}), ...(ignore ? { ignore } : {}) }];
  });
}

function normalizeSequenceState(value: unknown): CanvasSequenceState | undefined {
  if (!isRecord(value)) return undefined;
  const projectId = optionalIdentifier(value.projectId, 120);
  const shotId = optionalIdentifier(value.shotId, 80);
  const sourceMediaNodeId = optionalIdentifier(value.sourceMediaNodeId, 160);
  const acceptedEndState = optionalString(value.acceptedEndState, 1_000);
  const continuityLocks = normalizeShortList(value.continuityLocks, 8, 160);
  const completedBeats = normalizeShortList(value.completedBeats, 12, 160);
  if (!projectId && !shotId && !sourceMediaNodeId && !acceptedEndState && !continuityLocks.length && !completedBeats.length && value.accepted === undefined) {
    return undefined;
  }
  return {
    ...(projectId ? { projectId } : {}),
    ...(shotId ? { shotId } : {}),
    ...(sourceMediaNodeId ? { sourceMediaNodeId } : {}),
    ...(acceptedEndState ? { acceptedEndState } : {}),
    ...(continuityLocks.length ? { continuityLocks } : {}),
    ...(completedBeats.length ? { completedBeats } : {}),
    ...(typeof value.accepted === "boolean" ? { accepted: value.accepted } : {}),
  };
}

function normalizeShortList(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => boundedString(item, maxLength).trim()).filter(Boolean))];
}

function defaultNodeTitle(kind: CanvasNodeKind, generationKind: unknown) {
  if (kind === "group") return "节点分组";
  if (kind === "prompt") return "提示词";
  if (kind === "media") return "素材";
  return generationKind === "video" ? "视频生成" : "图片生成";
}

function optionalDimension(value: unknown, min = 160, max = 1_200) {
  if (value === undefined || value === null) return undefined;
  return boundedNumber(value, min, max, 320);
}

function identifier(value: unknown, label: string, maxLength = 160) {
  const result = boundedString(value, maxLength).trim();
  if (!result || !/^[a-zA-Z0-9_.:-]+$/.test(result)) {
    throw new CanvasDocumentError(`${label}无效。`);
  }
  return result;
}

function optionalIdentifier(value: unknown, maxLength = 160) {
  if (value === undefined || value === null || value === "") return undefined;
  return identifier(value, "标识符", maxLength);
}

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLength);
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, maxLength);
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
