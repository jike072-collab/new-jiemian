import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { type BillingAuditEvent, type BillingOrder, type BillingOrderStatus, type BillingStore } from "./types";

type BillingStorage = {
  read(): Promise<BillingStore>;
  write(store: BillingStore): Promise<void>;
};

export type CreateOrderRecordInput = Omit<BillingOrder, "version" | "webhook_event_ids"> & {
  version?: number;
  webhook_event_ids?: string[];
};

export type BillingOrderPatch = Partial<Omit<BillingOrder, "order_id" | "created_at" | "local_user_id" | "new_api_user_id" | "idempotency_key">>;

export type BillingRepository = {
  getOrder(orderId: string): Promise<BillingOrder | null>;
  getOrderByIdempotencyKey(localUserId: string, idempotencyKey: string): Promise<BillingOrder | null>;
  getOrderByProviderOrderId(providerOrderId: string): Promise<BillingOrder | null>;
  createOrder(input: CreateOrderRecordInput): Promise<BillingOrder>;
  updateOrder(orderId: string, patch: BillingOrderPatch, expectedVersion?: number): Promise<BillingOrder>;
  listOrders(filter?: { localUserId?: string; statuses?: BillingOrderStatus[] }): Promise<BillingOrder[]>;
  appendWebhookEvent(orderId: string, eventId: string): Promise<{ order: BillingOrder; alreadyProcessed: boolean }>;
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

function normalizeStore(store: Partial<BillingStore> | null): BillingStore {
  return {
    orders: Array.isArray(store?.orders) ? store.orders.map((order) => ({
      ...order,
      webhook_event_ids: Array.isArray(order.webhook_event_ids) ? order.webhook_event_ids : [],
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
    audit: store.audit.map((event) => ({ ...event, safe_details: { ...event.safe_details } })),
  };
}

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
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

  async listOrders(filter: { localUserId?: string; statuses?: BillingOrderStatus[] } = {}) {
    const statuses = filter.statuses ? new Set(filter.statuses) : null;
    const localUserId = filter.localUserId?.trim();
    const store = await this.storage.read();
    return store.orders
      .filter((order) => !localUserId || order.local_user_id === localUserId)
      .filter((order) => !statuses || statuses.has(order.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(cloneOrder);
  }

  async appendWebhookEvent(orderId: string, eventId: string) {
    return this.mutate((store) => {
      const index = store.orders.findIndex((order) => order.order_id === orderId.trim());
      if (index < 0) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
      if (store.orders[index].webhook_event_ids.includes(eventId)) {
        return { order: cloneOrder(store.orders[index]), alreadyProcessed: true };
      }
      store.orders[index] = {
        ...store.orders[index],
        webhook_event_ids: [...store.orders[index].webhook_event_ids, eventId],
        version: store.orders[index].version + 1,
      };
      return { order: cloneOrder(store.orders[index]), alreadyProcessed: false };
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
