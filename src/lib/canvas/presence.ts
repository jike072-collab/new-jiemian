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

const presenceActivityPriority: Record<CanvasPresenceActivity, number> = {
  viewing: 0,
  selected: 1,
  editing: 2,
  generating: 3,
};

export function dedupeCanvasPresenceMembers(members: CanvasPresenceMember[], ownClientId?: string) {
  const grouped = new Map<string, CanvasPresenceMember[]>();
  for (const member of members) {
    const key = member.userId || member.clientId;
    const group = grouped.get(key) || [];
    group.push(member);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((group) => [...group].sort((left, right) => {
      if (ownClientId && left.clientId === ownClientId) return -1;
      if (ownClientId && right.clientId === ownClientId) return 1;
      const activityDifference = presenceActivityPriority[right.activity] - presenceActivityPriority[left.activity];
      if (activityDifference) return activityDifference;
      return right.updatedAt.localeCompare(left.updatedAt);
    })[0])
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
}

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
