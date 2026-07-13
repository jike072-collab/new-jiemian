import type { LibraryItem } from "@/lib/server/types";

const mediaCachePrefix = "aohuang-library-media-v1";
const fullMediaWarmupDelayMs = 8000;
const warmupGapMs = 600;
const maxBackgroundMediaBytes = 256 * 1024 * 1024;
const scheduledKeys = new Set<string>();
const warmupQueue: MediaCacheEntry[] = [];
let workerScheduled = false;
let workerRunning = false;
let persistRequested = false;

type MediaCacheEntry = {
  ownerLocalUserId: string;
  url: string;
  size?: number;
  notBefore: number;
  priority: number;
};

type SchedulingNavigator = Navigator & {
  scheduling?: { isInputPending?: () => boolean };
};

function cacheName(ownerLocalUserId: string) {
  return `${mediaCachePrefix}:${ownerLocalUserId}`;
}

function mediaRequest(url: string) {
  return new Request(url, { credentials: "same-origin" });
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function waitForInputIdle() {
  const scheduling = (navigator as SchedulingNavigator).scheduling;
  while (document.visibilityState === "visible" && scheduling?.isInputPending?.()) {
    await wait(250);
  }
}

async function hasStorageRoom(size?: number) {
  if (!size || !navigator.storage?.estimate) return true;
  const estimate = await navigator.storage.estimate().catch(() => null);
  if (!estimate?.quota) return true;
  const available = estimate.quota - (estimate.usage || 0);
  return available > Math.max(size * 1.25, 32 * 1024 * 1024);
}

async function cacheUrl(ownerLocalUserId: string, url: string, size?: number) {
  if (!url.startsWith("/api/files/") || !("caches" in window)) return;
  if (size && size > maxBackgroundMediaBytes) return;
  if (!(await hasStorageRoom(size))) return;

  const request = mediaRequest(url);
  const cache = await caches.open(cacheName(ownerLocalUserId));
  if (await cache.match(request, { ignoreVary: true })) return;

  await waitForInputIdle();
  const response = await fetch(request, {
    cache: "force-cache",
    priority: "low",
  } as RequestInit & { priority: "low" }).catch(() => null);
  if (!response?.ok || response.status !== 200) return;
  await cache.put(request, response);
}

function scheduleIdle(callback: () => void, timeout: number) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(callback, { timeout });
    return;
  }
  window.setTimeout(callback, Math.min(timeout, 1000));
}

function scheduleWorker() {
  if (workerScheduled || workerRunning || !warmupQueue.length) return;
  workerScheduled = true;
  scheduleIdle(() => {
    workerScheduled = false;
    void runWorker();
  }, 1500);
}

async function runWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    if (!persistRequested) {
      persistRequested = true;
      void navigator.storage?.persist?.().catch(() => false);
    }
    while (warmupQueue.length) {
      await waitForInputIdle();
      const now = Date.now();
      const readyEntries = warmupQueue
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.notBefore <= now)
        .sort((left, right) => left.entry.priority - right.entry.priority);
      const next = readyEntries[0];
      if (!next) {
        const nextStart = Math.min(...warmupQueue.map((entry) => entry.notBefore));
        await wait(Math.min(1000, Math.max(50, nextStart - now)));
        continue;
      }
      const [entry] = warmupQueue.splice(next.index, 1);
      await cacheUrl(entry.ownerLocalUserId, entry.url, entry.size).catch(() => undefined);
      await wait(warmupGapMs);
    }
  } finally {
    workerRunning = false;
    scheduleWorker();
  }
}

function enqueueMediaCache(
  ownerLocalUserId: string,
  entries: Array<{ url: string; size?: number }>,
  delayMs: number,
  priority: number,
) {
  const notBefore = Date.now() + delayMs;
  for (const entry of entries) {
    const key = `${ownerLocalUserId}:${entry.url}`;
    if (scheduledKeys.has(key)) continue;
    scheduledKeys.add(key);
    warmupQueue.push({ ownerLocalUserId, ...entry, notBefore, priority });
  }
  scheduleWorker();
}

export function scheduleLibraryMediaCache(ownerLocalUserId: string, items: LibraryItem[]) {
  if (typeof window === "undefined" || !ownerLocalUserId || !("caches" in window)) return;

  const thumbnails: Array<{ url: string; size?: number }> = [];
  const fullMedia: Array<{ url: string; size?: number }> = [];
  for (const item of items) {
    const output = item.output;
    if (item.status !== "done" || item.expired || !output?.url?.startsWith("/api/files/")) continue;
    if (item.type === "image") {
      thumbnails.push({
        url: `${output.url}${output.url.includes("?") ? "&" : "?"}view=thumb`,
        size: output.size,
      });
    }
    fullMedia.push({ url: output.url, size: output.size });
  }

  enqueueMediaCache(ownerLocalUserId, thumbnails, 0, 0);
  enqueueMediaCache(ownerLocalUserId, fullMedia, fullMediaWarmupDelayMs, 1);
}

export async function cachedMediaObjectUrl(ownerLocalUserId: string | null | undefined, url: string) {
  if (!ownerLocalUserId || !url.startsWith("/api/files/") || !("caches" in window)) return null;
  const cache = await caches.open(cacheName(ownerLocalUserId));
  const response = await cache.match(mediaRequest(url), { ignoreVary: true });
  if (!response) return null;
  return URL.createObjectURL(await response.blob());
}

export async function removeLibraryMediaCache(ownerLocalUserId: string, urls: string[]) {
  if (!ownerLocalUserId || !("caches" in window)) return;
  const cache = await caches.open(cacheName(ownerLocalUserId));
  await Promise.all(urls.flatMap((url) => {
    if (!url.startsWith("/api/files/")) return [];
    const thumbnailUrl = `${url}${url.includes("?") ? "&" : "?"}view=thumb`;
    scheduledKeys.delete(`${ownerLocalUserId}:${url}`);
    scheduledKeys.delete(`${ownerLocalUserId}:${thumbnailUrl}`);
    return [
      cache.delete(mediaRequest(url), { ignoreVary: true }),
      cache.delete(mediaRequest(thumbnailUrl), { ignoreVary: true }),
    ];
  }));
}
