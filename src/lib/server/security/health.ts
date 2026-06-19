import "server-only";

import { randomUUID } from "node:crypto";

import { publicPaymentChannels } from "../billing/config";
import { getNewApiConfig } from "../integrations/new-api/config";

export type BackendHealthReport = {
  ok: true;
  requestId: string;
  service: "backend";
  generatedAt: string;
  checks: {
    newApi: {
      enabled: boolean;
      environment: string;
    };
    productionPayment: {
      enabled: boolean;
    };
  };
};

export function backendHealthReport(requestId: string = randomUUID(), now = new Date()): BackendHealthReport {
  const newApi = getNewApiConfig(requestId);
  const productionPayment = publicPaymentChannels().find((channel) => channel.channel === "production_generic");
  return {
    ok: true,
    requestId,
    service: "backend",
    generatedAt: now.toISOString(),
    checks: {
      newApi: {
        enabled: newApi.enabled,
        environment: newApi.environment,
      },
      productionPayment: {
        enabled: Boolean(productionPayment?.enabled),
      },
    },
  };
}
