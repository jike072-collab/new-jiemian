import "server-only";

import {
  CANVAS_PRESENCE_TTL_MS,
  canvasPresenceActivity,
  isCanvasPresenceExpired,
  type CanvasPresenceMember,
} from "@/lib/canvas/presence";

type PresenceState = Map<string, Map<string, CanvasPresenceMember>>;

const globalState = globalThis as typeof globalThis & {
  __aohuangCanvasPresence?: PresenceState;
};
const state = globalState.__aohuangCanvasPresence || new Map<string, Map<string, CanvasPresenceMember>>();
globalState.__aohuangCanvasPresence = state;

const presenceColors = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#7c3aed", "#047857", "#c2410c", "#0369a1"];

export function upsertCanvasPresence(input: {
  projectId: string;
  clientId: string;
  userId: string;
  displayName: string;
  selectedNodeIds: string[];
  editingNodeId?: string;
  generatingNodeIds: string[];
  now?: Date;
}) {
  pruneCanvasPresence(input.projectId, input.now);
  const members = state.get(input.projectId) || new Map<string, CanvasPresenceMember>();
  const member: CanvasPresenceMember = {
    clientId: input.clientId,
    userId: input.userId,
    displayName: input.displayName.trim().slice(0, 80) || "团队成员",
    color: presenceColor(input.userId),
    selectedNodeIds: [...new Set(input.selectedNodeIds)].slice(0, 50),
    ...(input.editingNodeId ? { editingNodeId: input.editingNodeId } : {}),
    generatingNodeIds: [...new Set(input.generatingNodeIds)].slice(0, 20),
    activity: canvasPresenceActivity(input),
    updatedAt: (input.now || new Date()).toISOString(),
  };
  members.set(presenceKey(input.userId, input.clientId), member);
  state.set(input.projectId, members);
  return listCanvasPresence(input.projectId, input.now);
}

export function removeCanvasPresence(projectId: string, userId: string, clientId: string, now?: Date) {
  pruneCanvasPresence(projectId, now);
  const members = state.get(projectId);
  members?.delete(presenceKey(userId, clientId));
  if (members && members.size === 0) state.delete(projectId);
  return listCanvasPresence(projectId, now);
}

export function listCanvasPresence(projectId: string, now?: Date) {
  pruneCanvasPresence(projectId, now);
  return [...(state.get(projectId)?.values() || [])]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
}

export function resetCanvasPresenceForTests() {
  state.clear();
}

function pruneCanvasPresence(projectId: string, now = new Date()) {
  const members = state.get(projectId);
  if (!members) return;
  for (const [clientId, member] of members) {
    if (isCanvasPresenceExpired(member.updatedAt, now, CANVAS_PRESENCE_TTL_MS)) members.delete(clientId);
  }
  if (members.size === 0) state.delete(projectId);
}

function presenceColor(userId: string) {
  let hash = 0;
  for (const character of userId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return presenceColors[Math.abs(hash) % presenceColors.length];
}

function presenceKey(userId: string, clientId: string) {
  return `${userId}:${clientId}`;
}
