import "server-only";

import type { Notification, PoolClient } from "pg";

import { getApplicationDatabasePool } from "@/lib/server/database";

type CanvasNotification = {
  type: "project" | "deleted";
  projectId: string;
  version?: number;
  sourceId?: string;
};

type Subscriber = {
  onEvent: (message: CanvasNotification) => void;
  onError: () => void;
};

type CollaborationState = {
  client: PoolClient | null;
  connecting: Promise<void> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Map<string, Set<Subscriber>>;
};

const globalState = globalThis as typeof globalThis & {
  __aohuangCanvasCollaboration?: CollaborationState;
};
const state: CollaborationState = globalState.__aohuangCanvasCollaboration || {
  client: null,
  connecting: null,
  closeTimer: null,
  subscribers: new Map<string, Set<Subscriber>>(),
};
globalState.__aohuangCanvasCollaboration = state;

export async function subscribeCanvasProjectEvents(
  projectId: string,
  onEvent: Subscriber["onEvent"],
  onError: Subscriber["onError"],
) {
  if (state.closeTimer) {
    clearTimeout(state.closeTimer);
    state.closeTimer = null;
  }
  const subscriber = { onEvent, onError };
  const subscribers = state.subscribers.get(projectId) || new Set<Subscriber>();
  subscribers.add(subscriber);
  state.subscribers.set(projectId, subscribers);
  try {
    await ensureListener();
  } catch (error) {
    removeSubscriber(projectId, subscriber);
    throw error;
  }
  return () => removeSubscriber(projectId, subscriber);
}

async function ensureListener() {
  if (state.client) return;
  if (state.connecting) return state.connecting;
  state.connecting = (async () => {
    const client = await getApplicationDatabasePool().connect();
    client.on("notification", onNotification);
    client.once("error", onListenerError);
    try {
      await client.query("listen canvas_project_events");
      state.client = client;
    } catch (error) {
      client.removeListener("notification", onNotification);
      client.removeListener("error", onListenerError);
      client.release();
      throw error;
    }
  })().finally(() => {
    state.connecting = null;
  });
  return state.connecting;
}

function onNotification(notification: Notification) {
  const message = parseNotification(notification.payload);
  if (!message) return;
  state.subscribers.get(message.projectId)?.forEach((subscriber) => subscriber.onEvent(message));
}

function onListenerError() {
  const client = state.client;
  state.client = null;
  if (client) {
    client.removeListener("notification", onNotification);
    client.removeListener("error", onListenerError);
    client.release(true);
  }
  for (const subscribers of state.subscribers.values()) {
    subscribers.forEach((subscriber) => subscriber.onError());
  }
}

function removeSubscriber(projectId: string, subscriber: Subscriber) {
  const subscribers = state.subscribers.get(projectId);
  subscribers?.delete(subscriber);
  if (subscribers && subscribers.size === 0) state.subscribers.delete(projectId);
  if (state.subscribers.size > 0 || state.closeTimer) return;
  state.closeTimer = setTimeout(() => {
    state.closeTimer = null;
    const client = state.client;
    state.client = null;
    if (!client) return;
    client.removeListener("notification", onNotification);
    client.removeListener("error", onListenerError);
    void client.query("unlisten canvas_project_events").catch(() => undefined).finally(() => client.release());
  }, 5_000);
}

function parseNotification(payload: string | undefined): CanvasNotification | null {
  try {
    const value = JSON.parse(payload || "") as Partial<CanvasNotification>;
    if ((value.type !== "project" && value.type !== "deleted") || typeof value.projectId !== "string") return null;
    return value as CanvasNotification;
  } catch {
    return null;
  }
}

export type { CanvasNotification };
