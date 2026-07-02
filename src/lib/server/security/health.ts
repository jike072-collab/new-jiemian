import "server-only";

import { randomUUID } from "node:crypto";

import { publicPaymentChannels } from "../billing/config";
import { checkApplicationDatabaseHealth } from "../database";
import { getNewApiConfig } from "../integrations/new-api/config";
import { NewApiHttpClient } from "../integrations/new-api/client";
import { newApiHealthContext } from "../integrations/new-api/auth";
import { safeNewApiError } from "../integrations/new-api/errors";
import { type NewApiHealth } from "../integrations/new-api/types";
import { getStorageCapacityStatus, storageStatusForPublicHealth } from "../storage-capacity";

export type BackendHealthMode = "liveness" | "readiness";

export type BackendHealthReport = {
  ok: boolean;
  mode: BackendHealthMode;
  requestId: string;
  service: "backend";
  generatedAt: string;
  checks: {
    process: {
      ok: true;
    };
    newApi: {
      ok?: boolean;
      enabled: boolean;
      environment: string;
      errorCode?: string;
    };
    productionPayment: {
      enabled: boolean;
    };
    providerHealth: {
      available: true;
      externalCalls: false;
      liveGenerationEnabled: false;
    };
    storage?: ReturnType<typeof storageStatusForPublicHealth>;
    database?: {
      ok: boolean;
      errorCode?: string;
      errorCategory?: string;
    };
  };
};

export function backendLivenessReport(requestId: string = randomUUID(), now = new Date()): BackendHealthReport {
  const newApi = getNewApiConfig(requestId);
  const productionPayment = publicPaymentChannels().find((channel) => channel.channel === "production_generic");
  return {
    ok: true,
    mode: "liveness",
    requestId,
    service: "backend",
    generatedAt: now.toISOString(),
    checks: {
      process: {
        ok: true,
      },
      newApi: {
        enabled: newApi.enabled,
        environment: newApi.environment,
      },
      productionPayment: {
        enabled: Boolean(productionPayment?.enabled),
      },
      providerHealth: {
        available: true,
        externalCalls: false,
        liveGenerationEnabled: false,
      },
    },
  };
}

export async function backendReadinessReport(
  requestId: string = randomUUID(),
  now = new Date(),
  options: { timeoutMs?: number } = {},
): Promise<BackendHealthReport> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const liveness = backendLivenessReport(requestId, now);
  const database = await checkDatabaseReadiness(requestId, timeoutMs);
  const newApi = await checkNewApiReadiness(requestId, timeoutMs);
  const storage = await checkStorageReadiness(timeoutMs);
  const ok = database.ok && newApi.ok && storage.ok;
  return {
    ...liveness,
    ok,
    mode: "readiness",
    checks: {
      ...liveness.checks,
      database,
      newApi: {
        ...liveness.checks.newApi,
        ok: newApi.ok,
        errorCode: newApi.errorCode,
      },
      storage,
    },
  };
}

export function backendHealthReport(requestId: string = randomUUID(), now = new Date()): BackendHealthReport {
  return backendLivenessReport(requestId, now);
}

export async function backendHealthHttpReport(
  mode: BackendHealthMode,
  requestId: string | undefined,
  now = new Date(),
) {
  if (mode === "readiness") {
    const report = await backendReadinessReport(requestId, now);
    return { report, status: report.ok ? 200 : 503 };
  }
  const report = backendLivenessReport(requestId, now);
  return {
    report: {
      ...report,
      checks: {
        ...report.checks,
        storage: await checkStorageReadiness(2000),
      },
    },
    status: 200,
  };
}

async function readinessTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("readiness_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function checkNewApiReadiness(requestId: string, timeoutMs: number) {
  try {
    const config = getNewApiConfig(requestId);
    if (!config.enabled) return { ok: false, errorCode: "NEW_API_DISABLED" };
    const client = new NewApiHttpClient({ ...config, timeoutMs: Math.min(config.timeoutMs, timeoutMs) });
    await readinessTimeout(client.request<NewApiHealth>({
      path: "/api/status",
      context: newApiHealthContext(),
      retry: false,
      timeoutMs,
      requestId,
    }), timeoutMs);
    return { ok: true };
  } catch (error) {
    const safe = safeNewApiError(error, requestId);
    return { ok: false, errorCode: safe.code };
  }
}

async function checkDatabaseReadiness(requestId: string, timeoutMs: number) {
  try {
    const health = await readinessTimeout(checkApplicationDatabaseHealth(requestId), timeoutMs);
    if (health.ok) return { ok: true };
    return {
      ok: false,
      errorCode: health.error.code,
      errorCategory: String(health.error.safeDetails.category || "unknown"),
    };
  } catch {
    return {
      ok: false,
      errorCode: "APP_DATABASE_TIMEOUT",
      errorCategory: "timeout",
    };
  }
}

async function checkStorageReadiness(timeoutMs: number) {
  try {
    const status = await readinessTimeout(getStorageCapacityStatus(), timeoutMs);
    return storageStatusForPublicHealth(status);
  } catch {
    return {
      ok: false,
      level: "unavailable" as const,
      needsCleanup: true,
      checkedAt: new Date().toISOString(),
      cache: "fresh" as const,
      thresholds: {
        warning: 70,
        critical: 80,
        blockVideo: 85,
        blockMedia: 90,
        emergency: 95,
      },
      thresholdConfigValid: false,
      roots: [
        {
          label: "DATA_DIR" as const,
          ok: false,
          level: "unavailable" as const,
          totalBytes: null,
          usedBytes: null,
          availableBytes: null,
          usedPercent: null,
          errorCode: "storage_timeout",
        },
        {
          label: "UPLOADS_DIR" as const,
          ok: false,
          level: "unavailable" as const,
          totalBytes: null,
          usedBytes: null,
          availableBytes: null,
          usedPercent: null,
          errorCode: "storage_timeout",
        },
      ],
    };
  }
}
