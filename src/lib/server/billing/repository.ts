import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import {
  type BillingAuditEvent,
  type BillingOrder,
  type BillingOrderStatus,
  type BillingStore,
  type BillingWebhookEventRecord,
  type BillingWebhookProcessingStatus,
  type BillingWebhookEventType,
} from "./types";

type BillingStorage = {
  read(): Promise<BillingStore>;
  write(store: BillingStore): Promise<void>;
};

export type CreateOrderRecordInput = Omit<BillingOrder, "version" | "webhook_event_ids"> & {
  version?: number;
  webhook_event_ids?: string[];
};

export type BillingOrderPatch = Partial<Omit<BillingOrder, "order_id" | "created_at" | "local_user_id" | "new_api_user_id" | "idempotency_key">>;

export type BillingOrderListFilter = {
  localUserId?: string;
  statuses?: BillingOrderStatus[];
  page?: number;
  pageSize?: number;
};

export type BillingOrderListPage = {
  orders: BillingOrder[];
  total: number;
};

export type BillingWebhookEventInput = {
  eventType?: BillingWebhookEventType;
  occurredAt?: string | null;
  status?: BillingWebhookProcessingStatus;
  safeError?: string | null;
};

export type BillingWebhookEventResult = {
  order: BillingOrder;
  event: BillingWebhookEventRecord;
  completed: boolean;
};

export type BillingRepository = {
  getOrder(orderId: string): Promise<BillingOrder | null>;
  getOrderByIdempotencyKey(localUserId: string, idempotencyKey: string): Promise<BillingOrder | null>;
  getOrderByProviderOrderId(providerOrderId: string): Promise<BillingOrder | null>;
  createOrder(input: CreateOrderRecordInput): Promise<BillingOrder>;
  updateOrder(orderId: string, patch: BillingOrderPatch, expectedVersion?: number): Promise<BillingOrder>;
  listOrders(filter?: BillingOrderListFilter): Promise<BillingOrder[]>;
  listOrdersPage?(filter?: BillingOrderListFilter): Promise<BillingOrderListPage>;
  appendWebhookEvent(
    orderId: string,
    eventId: string,
    input?: BillingWebhookEventInput,
  ): Promise<BillingWebhookEventResult>;
  updateWebhookEventStatus(
    eventId: string,
    status: BillingWebhookProcessingStatus,
    safeError?: string | null,
  ): Promise<BillingWebhookEventRecord | null>;
  appendAudit(event: Omit<BillingAuditEvent, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<void>;
  listAuditEvents(): Promise<BillingAuditEvent[]>;
};

export class BillingRepositoryError extends Error {
  constructor(readonly code: "BILLING_DUPLICATE" | "BILLING_NOT_FOUND" | "BILLING_VERSION_CONFLICT", message: string) {
    super(message);
    this.name = "BillingRepositoryError";
  }
}

const defaultBillingStorePath = join(dataRoot, "billing-store.json");

function cloneOrder(order: BillingOrder): BillingOrder {
  return { ...order, webhook_event_ids: order.webhook_event_ids.slice() };
}

function cloneWebhookEvent(event: BillingWebhookEventRecord): BillingWebhookEventRecord {
  return { ...event };
}

function normalizeStore(store: Partial<BillingStore> | null): BillingStore {
  return {
    orders: Array.isArray(store?.orders) ? store.orders.map((order) => ({
      ...order,
      webhook_event_ids: Array.isArray(order.webhook_event_ids) ? order.webhook_event_ids : [],
    })) : [],
    webhook_events: Array.isArray(store?.webhook_events) ? store.webhook_events.map((event) => ({
      ...event,
      status: normalizeWebhookEventStatus(event.status),
    })) : [],
    audit: Array.isArray(store?.audit) ? store.audit.map((event) => ({
      ...event,
      safe_details: { ...event.safe_details },
    })) : [],
  };
}

function cloneStore(store: BillingStore): BillingStore {
  return {
    orders: store.orders.map(cloneOrder),
    webhook_events: store.webhook_events.map(cloneWebhookEvent),
    audit: store.audit.map((event) => ({ ...event, safe_details: { ...event.safe_details } })),
  };
}

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function normalizeWebhookEventStatus(status: unknown): BillingWebhookProcessingStatus {
  if (status === "completed" || status === "duplicate") return "completed";
  if (status === "processing") return "processing";
  if (status === "failed" || status === "rejected" || status === "review") return "failed";
  return "received";
}

function hasProcessingWebhookEvent(store: BillingStore, orderId: string, excludeEventId?: string) {
  return store.webhook_events.some((event) => (
    event.order_id === orderId.trim()
    && event.status === "processing"
    && event.event_id !== excludeEventId
  ));
}

class StoreBillingRepository implements BillingRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: BillingStorage) {}

  private async withLock<T>(operation: () => Promise<T>) {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async mutate<T>(operation: (store: BillingStore) => Promise<T> | T) {
    return this.withLock(async () => {
      const store = cloneStore(await this.storage.read());
      const result = await operation(store);
      await this.storage.write(store);
      return result;
    });
  }

  async getOrder(orderId: string) {
    const store = await this.storage.read();
    const found = store.orders.find((order) => order.order_id === orderId.trim());
    return found ? cloneOrder(found) : null;
  }

  async getOrderByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    const store = await this.storage.read();
    const found = store.orders.find((order) => (
      order.local_user_id === localUserId.trim()
      && order.idempotency_key === idempotencyKey.trim()
    ));
    return found ? cloneOrder(found) : null;
  }

  async getOrderByProviderOrderId(providerOrderId: string) {
    const store = await this.storage.read();
    const found = store.orders.find((order) => order.provider_order_id === providerOrderId.trim());
    return found ? cloneOrder(found) : null;
  }

  async createOrder(input: CreateOrderRecordInput) {
    return this.mutate((store) => {
      const duplicate = store.orders.find((order) => (
        order.order_id === input.order_id
        || order.provider_order_id === input.provider_order_id
        || (order.local_user_id === input.local_user_id && order.idempotency_key === input.idempotency_key)
      ));
      if (duplicate) throw new BillingRepositoryError("BILLING_DUPLICATE", "Billing order already exists.");
      const order: BillingOrder = {
        ...input,
        version: input.version ?? 1,
        webhook_event_ids: input.webhook_event_ids?.slice() || [],
      };
      store.orders.push(order);
      return cloneOrder(order);
    });
  }

  async updateOrder(orderId: string, patch: BillingOrderPatch, expectedVersion?: number) {
    return this.mutate((store) => {
      const index = store.orders.findIndex((order) => order.order_id === orderId.trim());
      if (index < 0) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
      if (expectedVersion !== undefined && store.orders[index].version !== expectedVersion) {
        throw new BillingRepositoryError("BILLING_VERSION_CONFLICT", "Billing order changed before update.");
      }
      store.orders[index] = {
        ...store.orders[index],
        ...patch,
        version: store.orders[index].version + 1,
      };
      return cloneOrder(store.orders[index]);
    });
  }

  async listOrders(filter: BillingOrderListFilter = {}) {
    const statuses = filter.statuses ? new Set(filter.statuses) : null;
    const localUserId = filter.localUserId?.trim();
    const store = await this.storage.read();
    return store.orders
      .filter((order) => !localUserId || order.local_user_id === localUserId)
      .filter((order) => !statuses || statuses.has(order.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(cloneOrder);
  }

  async listOrdersPage(filter: BillingOrderListFilter = {}) {
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const orders = await this.listOrders(filter);
    const start = (page - 1) * pageSize;
    return {
      orders: orders.slice(start, start + pageSize),
      total: orders.length,
    };
  }

  async appendWebhookEvent(orderId: string, eventId: string, input: BillingWebhookEventInput = {}) {
    return this.mutate((store) => {
      const index = store.orders.findIndex((order) => order.order_id === orderId.trim());
      if (index < 0) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
      const existing = store.webhook_events.find((event) => event.event_id === eventId.trim());
      if (existing) {
        if ((existing.status === "received" || existing.status === "failed") && !hasProcessingWebhookEvent(store, orderId, existing.event_id)) {
          existing.status = "processing";
        }
        return {
          order: cloneOrder(store.orders[index]),
          event: cloneWebhookEvent(existing),
          completed: existing.status === "completed",
        };
      }
      const status: BillingWebhookProcessingStatus = hasProcessingWebhookEvent(store, orderId) ? "received" : "processing";
      const event: BillingWebhookEventRecord = {
        event_id: eventId.trim(),
        order_id: store.orders[index].order_id,
        event_type: input.eventType || "payment_succeeded",
        status,
        received_at: nowIso(),
        occurred_at: input.occurredAt || null,
        safe_error: input.safeError || null,
      };
      store.orders[index] = {
        ...store.orders[index],
        webhook_event_ids: [...store.orders[index].webhook_event_ids, event.event_id],
        version: store.orders[index].version + 1,
      };
      store.webhook_events.push(event);
      return {
        order: cloneOrder(store.orders[index]),
        event: cloneWebhookEvent(event),
        completed: false,
      };
    });
  }

  async updateWebhookEventStatus(eventId: string, status: BillingWebhookProcessingStatus, safeError: string | null = null) {
    return this.mutate((store) => {
      const index = store.webhook_events.findIndex((event) => event.event_id === eventId.trim());
      if (index < 0) return null;
      if (
        status === "processing"
        && store.webhook_events[index].status !== "processing"
        && hasProcessingWebhookEvent(store, store.webhook_events[index].order_id, store.webhook_events[index].event_id)
      ) {
        return cloneWebhookEvent(store.webhook_events[index]);
      }
      store.webhook_events[index] = {
        ...store.webhook_events[index],
        status,
        safe_error: safeError,
      };
      return cloneWebhookEvent(store.webhook_events[index]);
    });
  }

  async appendAudit(input: Omit<BillingAuditEvent, "id" | "created_at"> & { id?: string; created_at?: string }) {
    await this.mutate((store) => {
      store.audit.push({
        id: input.id || randomUUID(),
        order_id: input.order_id,
        event: input.event,
        created_at: input.created_at || nowIso(),
        local_user_id: input.local_user_id,
        safe_details: { ...input.safe_details },
      });
      if (store.audit.length > 1000) store.audit = store.audit.slice(-1000);
    });
  }

  async listAuditEvents() {
    const store = await this.storage.read();
    return store.audit.map((event) => ({ ...event, safe_details: { ...event.safe_details } }));
  }
}

export function createMemoryBillingRepository(seed: Partial<BillingStore> = {}) {
  let store = normalizeStore(seed);
  return new StoreBillingRepository({
    async read() {
      return cloneStore(store);
    },
    async write(nextStore) {
      store = cloneStore(nextStore);
    },
  });
}

export function createJsonBillingRepository(path = defaultBillingStorePath) {
  return new StoreBillingRepository({
    async read() {
      return normalizeStore(await readJsonFile<Partial<BillingStore> | null>(path, null));
    },
    async write(store) {
      await writeJsonFile(path, store);
    },
  });
}
