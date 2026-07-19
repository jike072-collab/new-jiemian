export const CANVAS_PRESENCE_TTL_MS = 35_000;

export type CanvasPresenceActivity = "viewing" | "selected" | "editing" | "generating";

export type CanvasPresenceMember = {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  selectedNodeIds: string[];
  editingNodeId?: string;
  generatingNodeIds: string[];
  activity: CanvasPresenceActivity;
  updatedAt: string;
};

export function canvasPresenceActivity(input: {
  selectedNodeIds?: string[];
  editingNodeId?: string;
  generatingNodeIds?: string[];
}): CanvasPresenceActivity {
  if (input.generatingNodeIds?.length) return "generating";
  if (input.editingNodeId) return "editing";
  if (input.selectedNodeIds?.length) return "selected";
  return "viewing";
}

export function canvasPresenceMembersForNode(
  members: CanvasPresenceMember[],
  nodeId: string,
  ownClientId?: string,
) {
  return members.filter((member) => member.clientId !== ownClientId && (
    member.editingNodeId === nodeId
    || member.generatingNodeIds.includes(nodeId)
    || member.selectedNodeIds.includes(nodeId)
  ));
}

export function canvasPresenceNodeActivity(member: CanvasPresenceMember, nodeId: string): CanvasPresenceActivity {
  if (member.generatingNodeIds.includes(nodeId)) return "generating";
  if (member.editingNodeId === nodeId) return "editing";
  if (member.selectedNodeIds.includes(nodeId)) return "selected";
  return "viewing";
}

export function isCanvasPresenceExpired(updatedAt: string, now = new Date(), ttlMs = CANVAS_PRESENCE_TTL_MS) {
  const updatedAtMs = new Date(updatedAt).getTime();
  return !Number.isFinite(updatedAtMs) || updatedAtMs < now.getTime() - ttlMs;
}
