export type CanvasLayoutNode = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: {
    kind: string;
    sourceNodeIds?: string[];
  };
};

export type CanvasLayoutEdge = {
  source: string;
  target: string;
};

const defaultNodeWidth = 360;
const defaultNodeHeight = 300;
const horizontalGap = 96;
const verticalGap = 48;
const componentGap = 96;

export function layoutCanvasFlowNodes<T extends CanvasLayoutNode>(nodes: T[], edges: CanvasLayoutEdge[]): T[] {
  const roots = nodes.filter((node) => !node.parentId);
  if (!roots.length) return nodes;

  const rootMap = new Map(roots.map((node) => [node.id, node]));
  const relations: CanvasLayoutEdge[] = [];
  const edgeKeys = new Set<string>();
  const addRelation = (source: string, target: string) => {
    if (source === target || !rootMap.has(source) || !rootMap.has(target)) return;
    const key = `${source}\u0000${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    relations.push({ source, target });
  };
  edges.forEach((edge) => addRelation(edge.source, edge.target));
  roots.forEach((node) => node.data.sourceNodeIds?.forEach((sourceId) => addRelation(sourceId, node.id)));

  const neighbors = new Map(roots.map((node) => [node.id, [] as string[]]));
  relations.forEach(({ source, target }) => {
    neighbors.get(source)?.push(target);
    neighbors.get(target)?.push(source);
  });
  const originalOrder = new Map([...roots]
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id))
    .map((node, index) => [node.id, index]));
  const unvisited = new Set(roots.map((node) => node.id));
  const components: T[][] = [];
  while (unvisited.size) {
    const firstId = unvisited.values().next().value as string;
    const queue = [firstId];
    const component: T[] = [];
    unvisited.delete(firstId);
    while (queue.length) {
      const nodeId = queue.shift();
      if (!nodeId) continue;
      const node = rootMap.get(nodeId) as T | undefined;
      if (node) component.push(node);
      for (const neighborId of neighbors.get(nodeId) || []) {
        if (!unvisited.delete(neighborId)) continue;
        queue.push(neighborId);
      }
    }
    component.sort((left, right) => (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0));
    components.push(component);
  }

  const componentLayouts = components.map((component) => {
    const ids = new Set(component.map((node) => node.id));
    const laidOut = layoutFlowComponent(component, relations.filter((edge) => ids.has(edge.source) && ids.has(edge.target)));
    const minX = Math.min(...laidOut.map((node) => node.position.x));
    const minY = Math.min(...laidOut.map((node) => node.position.y));
    const width = Math.max(...laidOut.map((node) => node.position.x + nodeWidth(node))) - minX;
    const height = Math.max(...laidOut.map((node) => node.position.y + nodeHeight(node))) - minY;
    return { nodes: laidOut, minX, minY, width, height };
  });
  const totalArea = componentLayouts.reduce((sum, component) => (
    sum + (component.width + componentGap) * (component.height + componentGap)
  ), 0);
  const targetRowWidth = Math.max(
    1_200,
    ...componentLayouts.map((component) => component.width),
    Math.sqrt(totalArea * (16 / 9)),
  );
  const positions = new Map<string, { x: number; y: number }>();
  let nextX = 0;
  let nextY = 0;
  let rowHeight = 0;
  componentLayouts.forEach((component) => {
    if (nextX > 0 && nextX + component.width > targetRowWidth) {
      nextX = 0;
      nextY += rowHeight + componentGap;
      rowHeight = 0;
    }
    component.nodes.forEach((node) => {
      positions.set(node.id, {
        x: nextX + node.position.x - component.minX,
        y: nextY + node.position.y - component.minY,
      });
    });
    nextX += component.width + componentGap;
    rowHeight = Math.max(rowHeight, component.height);
  });

  return nodes.map((node) => node.parentId ? node : ({ ...node, position: positions.get(node.id) || node.position }));
}

function layoutFlowComponent<T extends CanvasLayoutNode>(roots: T[], relations: CanvasLayoutEdge[]): T[] {
  const rootMap = new Map(roots.map((node) => [node.id, node]));
  const incoming = new Map(roots.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(roots.map((node) => [node.id, [] as string[]]));
  relations.forEach(({ source, target }) => {
    outgoing.get(source)?.push(target);
    incoming.get(target)?.push(source);
  });

  const originalOrder = new Map([...roots]
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id))
    .map((node, index) => [node.id, index]));
  const indegree = new Map(roots.map((node) => [node.id, incoming.get(node.id)?.length || 0]));
  const depth = new Map(roots.map((node) => [node.id, semanticFallbackDepth(node)]));
  const queue = roots
    .filter((node) => indegree.get(node.id) === 0)
    .sort((left, right) => (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0));
  const processed = new Set<string>();

  while (queue.length) {
    const node = queue.shift();
    if (!node) break;
    processed.add(node.id);
    for (const targetId of outgoing.get(node.id) || []) {
      depth.set(targetId, Math.max(depth.get(targetId) || 0, (depth.get(node.id) || 0) + 1));
      const nextIndegree = (indegree.get(targetId) || 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = rootMap.get(targetId);
        if (target) insertByOriginalOrder(queue, target, originalOrder);
      }
    }
  }

  // Invalid imported cycles retain a stable semantic layer instead of making layout fail.
  roots.filter((node) => !processed.has(node.id)).forEach((node) => {
    const knownParents = (incoming.get(node.id) || []).filter((id) => processed.has(id));
    if (knownParents.length) {
      depth.set(node.id, Math.max(...knownParents.map((id) => depth.get(id) || 0)) + 1);
    }
  });

  // Pull side branches toward their first downstream node so direct links do not span empty columns.
  [...roots]
    .filter((node) => processed.has(node.id))
    .sort((left, right) => (depth.get(right.id) || 0) - (depth.get(left.id) || 0))
    .forEach((node) => {
      const targetIds = outgoing.get(node.id) || [];
      if (!targetIds.length || targetIds.some((id) => !processed.has(id))) return;
      const currentDepth = depth.get(node.id) || 0;
      const compactedDepth = Math.min(...targetIds.map((id) => depth.get(id) || 0)) - 1;
      if (compactedDepth > currentDepth) depth.set(node.id, compactedDepth);
    });

  const maxDepth = Math.max(0, ...depth.values());
  const layers = Array.from({ length: maxDepth + 1 }, () => [] as T[]);
  roots.forEach((node) => layers[depth.get(node.id) || 0].push(node as T));
  layers.forEach((layer) => layer.sort((left, right) => (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0)));

  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let layer = 1; layer < layers.length; layer += 1) {
      layers[layer] = sortByNeighborBarycenter(layers[layer], incoming, layers);
    }
    for (let layer = layers.length - 2; layer >= 0; layer -= 1) {
      layers[layer] = sortByNeighborBarycenter(layers[layer], outgoing, layers);
    }
  }

  const layerHeights = layers.map((layer) => layer.reduce((sum, node) => sum + nodeHeight(node), 0) + Math.max(0, layer.length - 1) * verticalGap);
  const layoutHeight = Math.max(0, ...layerHeights);
  const xByLayer: number[] = [];
  let nextX = 0;
  layers.forEach((layer, index) => {
    xByLayer[index] = nextX;
    nextX += Math.max(defaultNodeWidth, ...layer.map(nodeWidth)) + horizontalGap;
  });

  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, index) => {
    let nextY = (layoutHeight - layerHeights[index]) / 2;
    layer.forEach((node) => {
      positions.set(node.id, { x: xByLayer[index], y: nextY });
      nextY += nodeHeight(node) + verticalGap;
    });
  });

  return roots.map((node) => ({ ...node, position: positions.get(node.id) || node.position }));
}

function semanticFallbackDepth(node: CanvasLayoutNode) {
  if (node.data.kind === "generator") return 1;
  if (node.data.kind === "media" && node.data.sourceNodeIds?.length) return 2;
  return 0;
}

function insertByOriginalOrder<T extends CanvasLayoutNode>(queue: T[], node: T, originalOrder: Map<string, number>) {
  const nodeOrder = originalOrder.get(node.id) || 0;
  const index = queue.findIndex((item) => (originalOrder.get(item.id) || 0) > nodeOrder);
  if (index < 0) queue.push(node);
  else queue.splice(index, 0, node);
}

function sortByNeighborBarycenter<T extends CanvasLayoutNode>(
  layer: T[],
  neighbors: Map<string, string[]>,
  layers: T[][],
) {
  const order = new Map(layers.flatMap((items) => items.map((node, index) => [node.id, index] as const)));
  const previousOrder = new Map(layer.map((node, index) => [node.id, index]));
  const score = (node: T) => {
    const linked = (neighbors.get(node.id) || []).map((id) => order.get(id)).filter((value): value is number => value !== undefined);
    return linked.length ? linked.reduce((sum, value) => sum + value, 0) / linked.length : previousOrder.get(node.id) || 0;
  };
  return [...layer].sort((left, right) => score(left) - score(right) || (previousOrder.get(left.id) || 0) - (previousOrder.get(right.id) || 0));
}

function nodeWidth(node: CanvasLayoutNode) {
  return Math.max(260, Number(node.width) || defaultNodeWidth);
}

function nodeHeight(node: CanvasLayoutNode) {
  return Math.max(180, Number(node.height) || defaultNodeHeight);
}
