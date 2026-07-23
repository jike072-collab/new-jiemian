import type { CanvasNodeData } from "@/lib/canvas/types";

export function duplicateCanvasNodeData(
  data: CanvasNodeData,
  nodeIdMap: ReadonlyMap<string, string>,
  createdAt = new Date().toISOString(),
) {
  const duplicate: CanvasNodeData = {
    ...data,
    title: `${data.title} 副本`,
    createdAt,
  };
  const sourceNodeIds = data.sourceNodeIds?.flatMap((id) => {
    const mapped = nodeIdMap.get(id);
    return mapped ? [mapped] : [];
  });
  if (sourceNodeIds?.length) duplicate.sourceNodeIds = sourceNodeIds;
  else delete duplicate.sourceNodeIds;
  delete duplicate.generationRequestId;

  if (data.kind === "generator") {
    duplicate.status = "idle";
    duplicate.progress = 0;
    delete duplicate.jobId;
    delete duplicate.outputNodeId;
    delete duplicate.error;
  }
  return duplicate;
}
