import type {
  CanvasGenerationKind,
  CanvasGeneratorStatus,
  CanvasMediaType,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasProjectDocument,
  CanvasStoredEdge,
  CanvasStoredNode,
} from "./types";

const maxDocumentBytes = 1_500_000;
const maxNodes = 500;
const maxEdges = 1_000;

const nodeKinds = new Set<CanvasNodeKind>(["prompt", "media", "generator", "group"]);
const mediaTypes = new Set<CanvasMediaType>(["image", "video"]);
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
  const createdAt = optionalString(value.data.createdAt, 64);
  const model = optionalString(value.data.model, 240);
  if (createdAt) data.createdAt = createdAt;
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
    data.libraryItemId = identifier(value.data.libraryItemId, "作品 ID", 160);
    data.status = normalizeStatus(value.data.status, "done");
  }

  if (kind === "generator") {
    const generationKind = boundedString(value.data.generationKind, 16) as CanvasGenerationKind;
    if (!generationKinds.has(generationKind)) throw new CanvasDocumentError("生成节点类型无效。");
    data.generationKind = generationKind;
    data.providerId = optionalString(value.data.providerId, 240) || "";
    if (generationKind === "image") {
      const imageMode = optionalString(value.data.imageMode, 32);
      data.imageMode = imageMode === "image-to-image" ? "image-to-image" : "text-to-image";
      data.count = boundedNumber(value.data.count, 1, 8, 1);
    }
    data.ratio = optionalString(value.data.ratio, 32) || (generationKind === "image" ? "1:1" : "16:9");
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
