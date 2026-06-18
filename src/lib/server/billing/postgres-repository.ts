import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig, withApplicationTransaction } from "../database";
import {
  BillingRepositoryError,
  type BillingOrderListFilter,
  type BillingOrderPatch,
  type BillingRepository,
  type CreateOrderRecordInput,
  type BillingWebhookEventInput,
} from "./repository";
import {
  type BillingAuditEvent,
  type BillingCurrency,
  type BillingOrder,
  type BillingOrderStatus,
  type BillingWebhookEventRecord,
  type BillingWebhookEventType,
  type BillingWebhookProcessingStatus,
} from "./types";

type BillingOrderRow = QueryResultRow & {
  order_id: string;
  local_user_id: string;
  new_api_user_id: string;
  channel: string;
  currency: BillingCurrency;
  requested_amount: number;
  paid_amount: number;
  credited_quota: number;
  status: BillingOrderStatus;
  idempotency_key: string;
  provider_order_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  paid_at: Date | string | null;
  last_error: string | null;
  version: number;
  quota_credit_applied_at: Date | string | null;
  refunded_at: Date | string | null;
  webhook_event_ids: string[] | null;
};

type BillingAuditRow = QueryResultRow & {
  id: string;
  event: string;
  local_user_id: string | null;
  created_at: Date | string;
  safe_details: Record<string, string | number | boolean | null> | null;
};

type BillingWebhookEventRow = QueryResultRow & {
  event_id: string;
  order_id: string;
  event_type: BillingWebhookEventType;
  status: BillingWebhookProcessingStatus;
  received_at: Date | string;
  occurred_at: Date | string | null;
  safe_error: string | null;
};

const orderColumns = `
  bo.*,
  coalesce(
    array_agg(bwe.event_id order by bwe.received_at asc)
      filter (where bwe.event_id is not null),
    array[]::text[]
  ) as webhook_event_ids
`;

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function orderFromRow(row: BillingOrderRow): BillingOrder {
  return {
    order_id: row.order_id,
    local_user_id: row.local_user_id,
    new_api_user_id: row.new_api_user_id,
    channel: row.channel,
    currency: row.currency,
    requested_amount: Number(row.requested_amount),
    paid_amount: Number(row.paid_amount),
    credited_quota: Number(row.credited_quota),
    status: row.status,
    idempotency_key: row.idempotency_key,
    provider_order_id: row.provider_order_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    paid_at: isoOrNull(row.paid_at),
    last_error: row.last_error,
    version: Number(row.version),
    quota_credit_applied_at: isoOrNull(row.quota_credit_applied_at),
    refunded_at: isoOrNull(row.refunded_at),
    webhook_event_ids: Array.isArray(row.webhook_event_ids) ? row.webhook_event_ids.slice() : [],
  };
}

function auditFromRow(row: BillingAuditRow): BillingAuditEvent {
  return {
    id: row.id,
    order_id: typeof row.safe_details?.order_id === "string" ? row.safe_details.order_id : null,
    event: row.event,
    created_at: iso(row.created_at),
    local_user_id: row.local_user_id,
    safe_details: row.safe_details || {},
  };
}

function webhookEventFromRow(row: BillingWebhookEventRow): BillingWebhookEventRecord {
  return {
    event_id: row.event_id,
    order_id: row.order_id,
    event_type: row.event_type,
    status: row.status,
    received_at: iso(row.received_at),
    occurred_at: isoOrNull(row.occurred_at),
    safe_error: row.safe_error,
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

function payloadHash(orderId: string, eventId: string) {
  return createHash("sha256").update(`billing-webhook:${orderId}:${eventId}`).digest("hex");
}

async function selectOrderBy(whereClause: string, values: unknown[]) {
  const result = await applicationQuery<BillingOrderRow>(`
    select ${orderColumns}
    from billing_orders bo
    left join billing_webhook_events bwe on bwe.order_id = bo.order_id
    where ${whereClause}
    group by bo.order_id
  `, values);
  return result.rows[0] ? orderFromRow(result.rows[0]) : null;
}

export class PostgresBillingRepository implements BillingRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async getOrder(orderId: string) {
    return selectOrderBy("bo.order_id = $1", [orderId.trim()]);
  }

  async getOrderByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    return selectOrderBy("bo.local_user_id = $1 and bo.idempotency_key = $2", [
      localUserId.trim(),
      idempotencyKey.trim(),
    ]);
  }

  async getOrderByProviderOrderId(providerOrderId: string) {
    return selectOrderBy("bo.provider_order_id = $1", [providerOrderId.trim()]);
  }

  async createOrder(input: CreateOrderRecordInput) {
    try {
      const result = await applicationQuery<BillingOrderRow>(`
        insert into billing_orders(
          order_id, local_user_id, new_api_user_id, channel, currency, requested_amount,
          paid_amount, credited_quota, status, idempotency_key, provider_order_id,
          created_at, updated_at, paid_at, last_error, version, quota_credit_applied_at, refunded_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        returning *, array[]::text[] as webhook_event_ids
      `, [
        input.order_id,
        input.local_user_id,
        input.new_api_user_id,
        input.channel,
        input.currency,
        input.requested_amount,
        input.paid_amount,
        input.credited_quota,
        input.status,
        input.idempotency_key,
        input.provider_order_id,
        input.created_at,
        input.updated_at,
        input.paid_at,
        input.last_error,
        input.version ?? 1,
        input.quota_credit_applied_at,
        input.refunded_at,
      ]);
      await applicationQuery(`
        insert into billing_idempotency_keys(
          key_id, local_user_id, idempotency_key, scope, order_id, created_at
        ) values ($1,$2,$3,'billing_order',$4,$5)
        on conflict (local_user_id, scope, idempotency_key) do nothing
      `, [randomUUID(), input.local_user_id, input.idempotency_key, input.order_id, input.created_at]);
      return orderFromRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BillingRepositoryError("BILLING_DUPLICATE", "Billing order already exists.");
      }
      throw error;
    }
  }

  async updateOrder(orderId: string, patch: BillingOrderPatch, expectedVersion?: number) {
    const values: unknown[] = [orderId.trim()];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.channel !== undefined) add("channel", patch.channel);
    if (patch.currency !== undefined) add("currency", patch.currency);
    if (patch.requested_amount !== undefined) add("requested_amount", patch.requested_amount);
    if (patch.paid_amount !== undefined) add("paid_amount", patch.paid_amount);
    if (patch.credited_quota !== undefined) add("credited_quota", patch.credited_quota);
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.provider_order_id !== undefined) add("provider_order_id", patch.provider_order_id);
    if (patch.updated_at !== undefined) add("updated_at", patch.updated_at);
    if (patch.paid_at !== undefined) add("paid_at", patch.paid_at);
    if (patch.last_error !== undefined) add("last_error", patch.last_error);
    if (patch.quota_credit_applied_at !== undefined) add("quota_credit_applied_at", patch.quota_credit_applied_at);
    if (patch.refunded_at !== undefined) add("refunded_at", patch.refunded_at);
    assignments.push("version = version + 1");

    const expectedVersionClause = expectedVersion === undefined ? "" : ` and version = $${values.length + 1}`;
    if (expectedVersion !== undefined) values.push(expectedVersion);
    const result = await applicationQuery<BillingOrderRow>(`
      update billing_orders
      set ${assignments.join(", ")}
      where order_id = $1${expectedVersionClause}
      returning *, array(
        select event_id from billing_webhook_events
        where order_id = billing_orders.order_id
        order by received_at asc
      ) as webhook_event_ids
    `, values);
    if (result.rows[0]) return orderFromRow(result.rows[0]);
    const current = await this.getOrder(orderId);
    if (!current) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
    throw new BillingRepositoryError("BILLING_VERSION_CONFLICT", "Billing order changed before update.");
  }

  async listOrders(filter: BillingOrderListFilter = {}) {
    const { whereClause, values } = this.listWhereClause(filter);
    const result = await applicationQuery<BillingOrderRow>(`
      select ${orderColumns}
      from billing_orders bo
      left join billing_webhook_events bwe on bwe.order_id = bo.order_id
      ${whereClause}
      group by bo.order_id
      order by bo.created_at desc, bo.order_id desc
    `, values);
    return result.rows.map(orderFromRow);
  }

  async listOrdersPage(filter: BillingOrderListFilter = {}) {
    const { whereClause, values } = this.listWhereClause(filter);
    const count = await applicationQuery<{ count: string }>(
      `select count(*)::text as count from billing_orders bo ${whereClause}`,
      values,
    );
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const queryValues = values.slice();
    queryValues.push(pageSize, (page - 1) * pageSize);
    const result = await applicationQuery<BillingOrderRow>(`
      select ${orderColumns}
      from billing_orders bo
      left join billing_webhook_events bwe on bwe.order_id = bo.order_id
      ${whereClause}
      group by bo.order_id
      order by bo.created_at desc, bo.order_id desc
      limit $${queryValues.length - 1}
      offset $${queryValues.length}
    `, queryValues);
    return {
      orders: result.rows.map(orderFromRow),
      total: Number(count.rows[0]?.count || 0),
    };
  }

  private listWhereClause(filter: BillingOrderListFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (filter.localUserId?.trim()) {
      values.push(filter.localUserId.trim());
      clauses.push(`bo.local_user_id = $${values.length}`);
    }
    if (filter.statuses?.length) {
      values.push(filter.statuses);
      clauses.push(`bo.status = any($${values.length}::text[])`);
    }
    return {
      whereClause: clauses.length ? `where ${clauses.join(" and ")}` : "",
      values,
    };
  }

  async appendWebhookEvent(orderId: string, eventId: string, input: BillingWebhookEventInput = {}) {
    const order = await this.getOrder(orderId);
    if (!order) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
    const eventType = input.eventType || "payment_succeeded";
    const trimmedEventId = eventId.trim();
    const event = await withApplicationTransaction(async (client) => {
      await client.query("select order_id from billing_orders where order_id = $1 for update", [order.order_id]);
      const processing = await client.query<{ count: string }>(`
        select count(*)::text as count
        from billing_webhook_events
        where order_id = $1 and status = 'processing' and event_id <> $2
      `, [order.order_id, trimmedEventId]);
      const status: BillingWebhookProcessingStatus = Number(processing.rows[0]?.count || 0) > 0 ? "received" : "processing";
      const inserted = await client.query<BillingWebhookEventRow>(`
        insert into billing_webhook_events(
          event_id, order_id, provider_order_id, event_type, occurred_at, payload_hash, status, safe_error
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (event_id) do nothing
        returning event_id, order_id, event_type, status, received_at, occurred_at, safe_error
      `, [
        trimmedEventId,
        order.order_id,
        order.provider_order_id,
        eventType,
        input.occurredAt || null,
        payloadHash(order.order_id, trimmedEventId),
        status,
        input.safeError || null,
      ]);
      if (inserted.rows[0]) return webhookEventFromRow(inserted.rows[0]);

      const existing = await client.query<BillingWebhookEventRow>(`
        select event_id, order_id, event_type, status, received_at, occurred_at, safe_error
        from billing_webhook_events
        where event_id = $1
        for update
      `, [trimmedEventId]);
      const existingEvent = existing.rows[0] ? webhookEventFromRow(existing.rows[0]) : null;
      if (
        existingEvent
        && (existingEvent.status === "received" || existingEvent.status === "failed")
        && Number(processing.rows[0]?.count || 0) === 0
      ) {
        const claimed = await client.query<BillingWebhookEventRow>(`
          update billing_webhook_events
          set status = 'processing', safe_error = null
          where event_id = $1
          returning event_id, order_id, event_type, status, received_at, occurred_at, safe_error
        `, [trimmedEventId]);
        return claimed.rows[0] ? webhookEventFromRow(claimed.rows[0]) : existingEvent;
      }
      return existingEvent;
    });
    const updated = await this.getOrder(orderId);
    if (!updated) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing order was not found.");
    if (!event) throw new BillingRepositoryError("BILLING_NOT_FOUND", "Billing webhook event was not found.");
    return {
      order: updated,
      event,
      completed: event.status === "completed",
    };
  }

  async updateWebhookEventStatus(eventId: string, status: BillingWebhookProcessingStatus, safeError: string | null = null) {
    return withApplicationTransaction(async (client) => {
      const current = await client.query<BillingWebhookEventRow>(`
        select event_id, order_id, event_type, status, received_at, occurred_at, safe_error
        from billing_webhook_events
        where event_id = $1
        for update
      `, [eventId.trim()]);
      if (!current.rows[0]) return null;
      const currentEvent = webhookEventFromRow(current.rows[0]);
      await client.query("select order_id from billing_orders where order_id = $1 for update", [currentEvent.order_id]);
      if (status === "processing" && currentEvent.status !== "processing") {
        const processing = await client.query<{ count: string }>(`
          select count(*)::text as count
          from billing_webhook_events
          where order_id = $1 and status = 'processing' and event_id <> $2
        `, [currentEvent.order_id, currentEvent.event_id]);
        if (Number(processing.rows[0]?.count || 0) > 0) return currentEvent;
      }
      const result = await client.query<BillingWebhookEventRow>(`
        update billing_webhook_events
        set status = $2, safe_error = $3
        where event_id = $1
        returning event_id, order_id, event_type, status, received_at, occurred_at, safe_error
      `, [eventId.trim(), status, safeError]);
      return result.rows[0] ? webhookEventFromRow(result.rows[0]) : null;
    });
  }

  private async getWebhookEvent(eventId: string) {
    const result = await applicationQuery<BillingWebhookEventRow>(`
      select event_id, order_id, event_type, status, received_at, occurred_at, safe_error
      from billing_webhook_events
      where event_id = $1
    `, [eventId.trim()]);
    return result.rows[0] ? webhookEventFromRow(result.rows[0]) : null;
  }

  async appendAudit(input: Omit<BillingAuditEvent, "id" | "created_at"> & { id?: string; created_at?: string }) {
    await applicationQuery(`
      insert into audit_events(
        id, event, local_user_id, created_at, request_id, ip_hash, user_agent_hash, safe_details
      ) values ($1,$2,$3,$4,null,null,null,$5::jsonb)
    `, [
      input.id || randomUUID(),
      input.event,
      input.local_user_id,
      input.created_at || new Date().toISOString(),
      JSON.stringify({
        ...input.safe_details,
        order_id: input.order_id,
      }),
    ]);
  }

  async listAuditEvents() {
    const result = await applicationQuery<BillingAuditRow>(`
      select id, event, local_user_id, created_at, safe_details
      from audit_events
      where event like 'billing.%'
      order by created_at asc, id asc
    `);
    return result.rows.map(auditFromRow);
  }
}

export function createPostgresBillingRepository() {
  return new PostgresBillingRepository();
}
