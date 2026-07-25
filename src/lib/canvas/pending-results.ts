import type { LibraryItem } from "@/lib/server/types";
import type { CanvasNodeData } from "./types";

const legacyMatchWindowMs = 90_000;
type PendingMatchNode = { id: string; data: CanvasNodeData };

export function matchPendingGeneratedMedia(
  nodes: readonly PendingMatchNode[],
  items: readonly LibraryItem[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const claimedItemIds = new Set(nodes.flatMap((node) => node.data.libraryItemId ? [node.data.libraryItemId] : []));
  const matches = new Map<string, string>();

  for (const node of nodes) {
    if (
      node.data.kind !== "media"
      || node.data.libraryItemId
      || node.data.mediaOrigin !== "generated"
      || !node.data.mediaType
      || !["queued", "generating", "done", "failed"].includes(node.data.status || "")
    ) continue;

    const generator = node.data.sourceNodeIds
      ?.map((id) => nodesById.get(id))
      .find((candidate) => candidate?.data.kind === "generator");
    const eligible = items.filter((item) => (
      !claimedItemIds.has(item.id)
      && item.type === node.data.mediaType
      && (!generator?.data.providerId || item.providerId === generator.data.providerId)
      && item.mode !== "canvas-upload"
    ));
    const exact = node.data.generationRequestId
      ? eligible.filter((item) => item.params.billingTaskId === node.data.generationRequestId)
      : [];
    let match = exact.length === 1 ? exact[0] : undefined;

    if (!match && node.data.generationStartedAt) {
      const startedAt = Date.parse(node.data.generationStartedAt);
      const nearby = Number.isFinite(startedAt) ? eligible.filter((item) => {
        const requestedAt = typeof item.params.canvasRequestedAt === "string"
          ? Date.parse(item.params.canvasRequestedAt)
          : Number.NaN;
        return Number.isFinite(requestedAt) && Math.abs(requestedAt - startedAt) <= legacyMatchWindowMs;
      }) : [];
      if (nearby.length === 1) match = nearby[0];
    }

    if (!match) continue;
    matches.set(node.id, match.id);
    claimedItemIds.add(match.id);
  }

  return matches;
}
