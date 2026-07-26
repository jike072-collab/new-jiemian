export type CanvasPositionNode = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
};

export function absoluteCanvasNodePosition<T extends CanvasPositionNode>(node: T, nodes: readonly T[]) {
  const nodesById = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set([node.id]);
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}
