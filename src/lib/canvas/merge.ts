import type { CanvasProjectDocument, CanvasStoredNode } from "./types";

type CanvasWorkspaceState = {
  title: string;
  document: CanvasProjectDocument;
};

type CanvasMergeResult = CanvasWorkspaceState & {
  conflictCount: number;
};

const missing = Symbol("canvas-merge-missing");
type MergeValue = unknown | typeof missing;

export function mergeCanvasWorkspace(
  base: CanvasWorkspaceState,
  incoming: CanvasWorkspaceState,
  current: CanvasWorkspaceState,
): CanvasMergeResult {
  const title = mergeValue(base.title, incoming.title, current.title);
  const nodes = mergeCollection(base.document.nodes, incoming.document.nodes, current.document.nodes);
  const cleanedNodes = cleanParentRelationships(nodes.value);
  const nodeIds = new Set(cleanedNodes.map((node) => node.id));
  const edges = mergeCollection(base.document.edges, incoming.document.edges, current.document.edges);
  const viewport = mergeValue(base.document.viewport, incoming.document.viewport, current.document.viewport);

  return {
    title: String(title.value),
    document: {
      nodes: cleanedNodes,
      edges: edges.value.filter((edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target)),
      viewport: viewport.value as CanvasProjectDocument["viewport"],
    },
    conflictCount: title.conflicts + nodes.conflicts + edges.conflicts + viewport.conflicts,
  };
}

function mergeCollection<T extends { id: string }>(base: T[], incoming: T[], current: T[]) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const orderedIds = unique([...current.map((item) => item.id), ...incoming.map((item) => item.id), ...base.map((item) => item.id)]);
  const value: T[] = [];
  let conflicts = 0;

  for (const id of orderedIds) {
    const merged = mergeValue(
      baseById.has(id) ? baseById.get(id) : missing,
      incomingById.has(id) ? incomingById.get(id) : missing,
      currentById.has(id) ? currentById.get(id) : missing,
    );
    conflicts += merged.conflicts;
    if (merged.value !== missing) value.push(merged.value as T);
  }
  return { value, conflicts };
}

function mergeValue(base: MergeValue, incoming: MergeValue, current: MergeValue): { value: MergeValue; conflicts: number } {
  if (deepEqual(incoming, current)) return { value: incoming, conflicts: 0 };
  if (deepEqual(incoming, base)) return { value: current, conflicts: 0 };
  if (deepEqual(current, base)) return { value: incoming, conflicts: 0 };

  if (isRecord(base) && isRecord(incoming) && isRecord(current)) {
    const value: Record<string, unknown> = {};
    let conflicts = 0;
    const keys = unique([...Object.keys(current), ...Object.keys(incoming), ...Object.keys(base)]);
    for (const key of keys) {
      const merged = mergeValue(
        Object.hasOwn(base, key) ? base[key] : missing,
        Object.hasOwn(incoming, key) ? incoming[key] : missing,
        Object.hasOwn(current, key) ? current[key] : missing,
      );
      conflicts += merged.conflicts;
      if (merged.value !== missing) value[key] = merged.value;
    }
    return { value, conflicts };
  }

  return { value: incoming, conflicts: 1 };
}

function cleanParentRelationships(nodes: CanvasStoredNode[]) {
  const groups = new Set(nodes.filter((node) => node.data.kind === "group").map((node) => node.id));
  return nodes.map((node) => {
    if (!node.parentId || (node.data.kind !== "group" && groups.has(node.parentId))) return node;
    const detached = { ...node };
    delete detached.parentId;
    delete detached.extent;
    return detached;
  });
}

function deepEqual(left: MergeValue, right: MergeValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function isRecord(value: MergeValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export type { CanvasMergeResult, CanvasWorkspaceState };
