import { type BillingRepository } from "./repository";
import { createJsonBillingRepository } from "./repository";
import {
  getJsonBillingDualRepairRepository,
  redactedBillingDualRepairKey,
  sanitizeBillingDualRepairError,
} from "./dual-repair";

export type BillingPersistenceMode = "json" | "dual" | "postgres";

export class BillingPersistenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingPersistenceConfigError";
  }
}

const allowedModes = new Set<BillingPersistenceMode>(["json", "dual", "postgres"]);

function rawMode() {
  return process.env.APP_BILLING_PERSISTENCE_MODE?.trim().toLowerCase();
}

export function getBillingPersistenceMode(): BillingPersistenceMode {
  const raw = rawMode();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new BillingPersistenceConfigError("APP_BILLING_PERSISTENCE_MODE must be explicitly set in production.");
    }
    return "json";
  }
  if (!allowedModes.has(raw as BillingPersistenceMode)) {
    throw new BillingPersistenceConfigError("APP_BILLING_PERSISTENCE_MODE must be json, dual, or postgres.");
  }
  return raw as BillingPersistenceMode;
}

export function createBillingPersistenceRepository(
  mode: BillingPersistenceMode = getBillingPersistenceMode(),
): BillingRepository {
  if (mode === "json") return createJsonBillingRepository();
  if (mode === "postgres") return loadPostgresBillingRepository();
  return createDualBillingRepository(createJsonBillingRepository(), loadPostgresBillingRepository());
}

function serverRequire<T>(path: string): T {
  const requireFn = (0, eval)("require") as NodeRequire;
  return requireFn(path) as T;
}

function loadPostgresBillingRepository() {
  const postgresRepositoryModule = serverRequire<typeof import("./postgres-repository")>("./postgres-repository");
  return postgresRepositoryModule.createPostgresBillingRepository();
}

function stableComparable(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.last_error;
  delete copy.safe_details;
  return copy;
}

function warnDualMismatch(scope: string, key: string, jsonValue: unknown, postgresValue: unknown) {
  console.warn(JSON.stringify({
    event: "billing.persistence.dual_mismatch",
    scope,
    key: redactedBillingDualRepairKey(key),
    json: stableComparable(jsonValue),
    postgres: stableComparable(postgresValue),
  }));
}

async function recordShadowFailure(scope: string, operation: string, key: string | number | null | undefined, error: unknown) {
  try {
    const dualRepairRepository = getJsonBillingDualRepairRepository();
    const record = await dualRepairRepository.recordFailure({ scope, operation, key, error });
    console.warn(JSON.stringify({
      event: "billing.persistence.dual_shadow_failure",
      scope,
      operation,
      repair_record_id: record.id,
      key: record.redacted_key,
      error_code: record.last_error_code,
    }));
  } catch (recordError) {
    console.error(JSON.stringify({
      event: "billing.persistence.dual_repair_record_failed",
      severity: "critical",
      scope,
      operation,
      key: redactedBillingDualRepairKey(key),
      shadow_error: sanitizeBillingDualRepairError(error),
      repair_error: sanitizeBillingDualRepairError(recordError),
    }));
  }
}

async function compareShadow<T>(
  scope: string,
  operation: string,
  key: string,
  primaryValue: T,
  shadow: () => Promise<unknown>,
  differs: (primaryValue: T, shadowValue: unknown) => boolean,
) {
  try {
    const shadowValue = await shadow();
    if (differs(primaryValue, shadowValue)) warnDualMismatch(scope, key, primaryValue, shadowValue);
  } catch (error) {
    await recordShadowFailure(scope, operation, key, error);
  }
}

async function mirrorWrite<T>(
  primary: Promise<T>,
  input: {
    scope: string;
    operation: string;
    key: (result: T) => string | number | null | undefined;
    mirror: (result: T) => Promise<unknown>;
  },
) {
  const result = await primary;
  try {
    await input.mirror(result);
  } catch (error) {
    await recordShadowFailure(input.scope, input.operation, input.key(result), error);
  }
  return result;
}

export function createDualBillingRepository(json: BillingRepository, postgres: BillingRepository): BillingRepository {
  return {
    async getOrder(orderId) {
      const jsonOrder = await json.getOrder(orderId);
      await compareShadow(
        "billing_order",
        "getOrder",
        orderId,
        jsonOrder,
        () => postgres.getOrder(orderId),
        (primary, shadow) => primary?.order_id !== (shadow as Awaited<ReturnType<BillingRepository["getOrder"]>>)?.order_id,
      );
      return jsonOrder;
    },
    async getOrderByIdempotencyKey(localUserId, idempotencyKey) {
      const jsonOrder = await json.getOrderByIdempotencyKey(localUserId, idempotencyKey);
      await compareShadow(
        "billing_order_idempotency",
        "getOrderByIdempotencyKey",
        idempotencyKey,
        jsonOrder,
        () => postgres.getOrderByIdempotencyKey(localUserId, idempotencyKey),
        (primary, shadow) => primary?.order_id !== (shadow as Awaited<ReturnType<BillingRepository["getOrderByIdempotencyKey"]>>)?.order_id,
      );
      return jsonOrder;
    },
    async getOrderByProviderOrderId(providerOrderId) {
      const jsonOrder = await json.getOrderByProviderOrderId(providerOrderId);
      await compareShadow(
        "billing_order_provider",
        "getOrderByProviderOrderId",
        providerOrderId,
        jsonOrder,
        () => postgres.getOrderByProviderOrderId(providerOrderId),
        (primary, shadow) => primary?.order_id !== (shadow as Awaited<ReturnType<BillingRepository["getOrderByProviderOrderId"]>>)?.order_id,
      );
      return jsonOrder;
    },
    async createOrder(input) {
      return mirrorWrite(json.createOrder(input), {
        scope: "billing_order",
        operation: "createOrder",
        key: (order) => order.order_id,
        mirror: () => postgres.createOrder(input),
      });
    },
    async updateOrder(orderId, patch, expectedVersion) {
      return mirrorWrite(json.updateOrder(orderId, patch, expectedVersion), {
        scope: "billing_order",
        operation: "updateOrder",
        key: () => orderId,
        mirror: () => postgres.updateOrder(orderId, patch, expectedVersion),
      });
    },
    async listOrders(filter) {
      const jsonOrders = await json.listOrders(filter);
      await compareShadow(
        "billing_order_list",
        "listOrders",
        filter?.localUserId || "all",
        jsonOrders.length,
        () => postgres.listOrders(filter),
        (primary, shadow) => primary !== (Array.isArray(shadow) ? shadow.length : -1),
      );
      return jsonOrders;
    },
    async listOrdersPage(filter) {
      const fallbackOrders = json.listOrdersPage ? null : await json.listOrders(filter);
      const jsonPage = json.listOrdersPage
        ? await json.listOrdersPage(filter)
        : { orders: fallbackOrders!, total: fallbackOrders!.length };
      await compareShadow(
        "billing_order_list",
        "listOrdersPage",
        filter?.localUserId || "all",
        jsonPage.total,
        () => postgres.listOrdersPage ? postgres.listOrdersPage(filter) : postgres.listOrders(filter),
        (primary, shadow) => primary !== (Array.isArray(shadow) ? shadow.length : (shadow as { total?: number })?.total),
      );
      return jsonPage;
    },
    async appendWebhookEvent(orderId, eventId, input) {
      return mirrorWrite(json.appendWebhookEvent(orderId, eventId, input), {
        scope: "billing_webhook_event",
        operation: "appendWebhookEvent",
        key: () => eventId,
        mirror: () => postgres.appendWebhookEvent(orderId, eventId, input),
      });
    },
    async appendAudit(event) {
      await mirrorWrite(json.appendAudit(event), {
        scope: "billing_audit",
        operation: "appendAudit",
        key: () => event.id || event.order_id,
        mirror: () => postgres.appendAudit(event),
      });
    },
    async listAuditEvents() {
      return json.listAuditEvents();
    },
  };
}
