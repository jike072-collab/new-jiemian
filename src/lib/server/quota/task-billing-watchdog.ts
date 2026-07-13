import "server-only";

import { getTaskBillingService } from "./task-billing-service";

const minimumIntervalMs = 60_000;
let lastStartedAt = 0;
let running: Promise<void> | null = null;

export function reconcileStaleTaskBillingInBackground(now = Date.now()) {
  if (running || now - lastStartedAt < minimumIntervalMs) return;
  lastStartedAt = now;
  running = Promise.resolve()
    .then(async () => {
      await getTaskBillingService().reconcileStaleProviderDispatches();
    })
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
}
