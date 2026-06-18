import { randomUUID } from "node:crypto";

import {
  adminCreditNewApiUserQuota,
  createJsonNewApiUserMappingRepository,
  type NewApiUserMappingRepository,
} from "../integrations/new-api";
import {
  amountAllowed,
  assertSandboxWebhookEnabled,
  calculateCreditedQuota,
  getPaymentChannel,
  listPaymentChannels,
  publicPaymentChannels,
  sandboxWebhookSecret,
} from "./config";
import { createBillingPersistenceRepository } from "./persistence";
import { BillingRepositoryError, type BillingRepository } from "./repository";
import { verifySandboxWebhook } from "./sandbox-provider";
import {
  type BillingErrorCode,
  type BillingFailure,
  type BillingOrderListResult,
  type BillingOrder,
  type BillingOrderStatus,
  type BillingRequestContext,
  type BillingWebhookPayload,
  type BillingWebhookResult,
  type CreateBillingOrderInput,
  type CreateBillingOrderResult,
  type PaymentProviderStatus,
  type ReconciliationResult,
} from "./types";

export type CreditQuotaInput = {
  orderId: string;
  localUserId: string;
  newApiUserId: string;
  quotaUnits: number;
  idempotencyKey: string;
};

export type CreditQuotaResult = {
  ok: true;
  providerCreditId: string;
} | {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
};

export type BillingServiceDependencies = {
  repository?: BillingRepository;
  mappingRepository?: NewApiUserMappingRepository;
  creditQuota?: (input: CreditQuotaInput) => Promise<CreditQuotaResult>;
  getProviderStatus?: (order: BillingOrder) => Promise<PaymentProviderStatus>;
  now?: () => Date;
};

const allowedTransitions: Record<BillingOrderStatus, BillingOrderStatus[]> = {
  pending: ["processing", "cancelled", "failed", "review"],
  processing: ["paid", "failed", "cancelled", "review"],
  paid: ["refunded", "review"],
  failed: ["review"],
  cancelled: ["review"],
  review: ["processing", "paid", "failed", "cancelled", "refunded"],
  refunded: ["review"],
};

function nowIso(now: Date) {
  return now.toISOString();
}

function failure(input: Omit<BillingFailure, "ok">): BillingFailure {
  return { ok: false, ...input };
}

function billingFailure(code: BillingErrorCode, status: number, message: string): BillingFailure {
  return failure({ code, status, message });
}

function publicOrder(order: BillingOrder): BillingOrder {
  return { ...order, webhook_event_ids: order.webhook_event_ids.slice() };
}

function assertTransition(from: BillingOrderStatus, to: BillingOrderStatus) {
  return from === to || allowedTransitions[from]?.includes(to);
}

function isVersionConflict(error: unknown) {
  return error instanceof BillingRepositoryError && error.code === "BILLING_VERSION_CONFLICT";
}

function sanitizeError(value: string) {
  return String(value || "billing failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key|signature)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 300);
}

function statusFromEvent(eventType: BillingWebhookPayload["event_type"]): BillingOrderStatus {
  if (eventType === "payment_succeeded") return "paid";
  if (eventType === "payment_failed") return "failed";
  if (eventType === "payment_cancelled") return "cancelled";
  return "refunded";
}

function safeDetails(details: Record<string, string | number | boolean | null>) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    result[key] = typeof value === "string" ? sanitizeError(value) : value;
  }
  return result;
}

async function defaultCreditQuota(_input: CreditQuotaInput): Promise<CreditQuotaResult> {
  try {
    await adminCreditNewApiUserQuota({
      newApiUserId: Number(_input.newApiUserId),
      quotaDelta: _input.quotaUnits,
    });
    return {
      ok: true,
      providerCreditId: `new-api:${_input.orderId}`,
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error ? error.name : "NEW_API_CREDIT_FAILED",
      message: "New API quota credit failed.",
      retryable: true,
    };
  }
}

export class BillingService {
  private readonly repository: BillingRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly creditQuota: (input: CreditQuotaInput) => Promise<CreditQuotaResult>;
  private readonly getProviderStatus?: (order: BillingOrder) => Promise<PaymentProviderStatus>;
  private readonly now: () => Date;

  constructor(dependencies: BillingServiceDependencies = {}) {
    this.repository = dependencies.repository || createBillingPersistenceRepository();
    this.mappingRepository = dependencies.mappingRepository || createJsonNewApiUserMappingRepository();
    this.creditQuota = dependencies.creditQuota || defaultCreditQuota;
    this.getProviderStatus = dependencies.getProviderStatus;
    this.now = dependencies.now || (() => new Date());
  }

  listPaymentChannels() {
    return publicPaymentChannels();
  }

  async createOrder(input: CreateBillingOrderInput, context: BillingRequestContext = {}): Promise<CreateBillingOrderResult> {
    const channel = getPaymentChannel(input.channel);
    if (!channel || !channel.enabled) {
      return billingFailure("payment_channel_unavailable", 400, "Payment channel is unavailable.");
    }
    if (input.currency !== channel.currency || !amountAllowed(channel, input.requestedAmount)) {
      return billingFailure("invalid_billing_request", 400, "Billing amount is invalid.");
    }
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return billingFailure("invalid_billing_request", 400, "Idempotency key is required.");
    }

    const existing = await this.repository.getOrderByIdempotencyKey(input.localUserId, idempotencyKey);
    if (existing) {
      await this.audit("billing.order.idempotent", existing, context, { request_id: context.requestId || null });
      return {
        ok: true,
        status: 200,
        order: publicOrder(existing),
        payment: this.paymentDescriptor(existing),
      };
    }

    const mapping = await this.mappingRepository.getByLocalUserId(input.localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      await this.repository.appendAudit({
        order_id: null,
        event: "billing.order.mapping_pending",
        local_user_id: input.localUserId,
        safe_details: safeDetails({ request_id: context.requestId || null }),
      });
      return billingFailure("mapping_pending", 409, "New API mapping is not active.");
    }

    const timestamp = nowIso(this.now());
    const orderId = `bo_${randomUUID()}`;
    const creditedQuota = calculateCreditedQuota(channel, input.requestedAmount);
    const order = await this.repository.createOrder({
      order_id: orderId,
      local_user_id: input.localUserId,
      new_api_user_id: mapping.new_api_user_id,
      channel: channel.channel,
      currency: channel.currency,
      requested_amount: input.requestedAmount,
      paid_amount: 0,
      credited_quota: creditedQuota,
      status: "pending",
      idempotency_key: idempotencyKey,
      provider_order_id: `sandbox_${orderId}`,
      created_at: timestamp,
      updated_at: timestamp,
      paid_at: null,
      last_error: null,
      quota_credit_applied_at: null,
      refunded_at: null,
    });
    await this.audit("billing.order.created", order, context, {
      amount: input.requestedAmount,
      credited_quota: creditedQuota,
    });
    return {
      ok: true,
      status: 201,
      order: publicOrder(order),
      payment: this.paymentDescriptor(order),
    };
  }

  async getOrderForUser(localUserId: string, orderId: string) {
    const order = await this.repository.getOrder(orderId);
    if (!order || order.local_user_id !== localUserId) {
      return billingFailure("payment_not_found", 404, "Payment order was not found.");
    }
    return { ok: true as const, status: 200, order: publicOrder(order) };
  }

  async listOrdersForUser(input: {
    localUserId: string;
    statuses?: BillingOrderStatus[];
    page?: number;
    pageSize?: number;
  }): Promise<BillingOrderListResult> {
    const page = Math.max(1, Math.trunc(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize || 20)));
    const filter = {
      localUserId: input.localUserId,
      statuses: input.statuses,
      page,
      pageSize,
    };
    const result = this.repository.listOrdersPage
      ? await this.repository.listOrdersPage(filter)
      : await this.listOrdersPageFallback(filter);
    return {
      ok: true,
      status: 200,
      orders: result.orders.map(publicOrder),
      page,
      page_size: pageSize,
      total: result.total,
      has_more: page * pageSize < result.total,
    };
  }

  async handleSandboxWebhook(input: {
    rawBody: string;
    timestamp: string | null;
    signature: string | null;
    now?: Date;
    context?: BillingRequestContext;
  }): Promise<BillingWebhookResult> {
    let secret: string;
    try {
      secret = assertSandboxWebhookEnabled();
    } catch {
      return billingFailure("billing_disabled", 503, "Sandbox payment webhook is disabled.");
    }

    const verification = verifySandboxWebhook({
      secret,
      timestamp: input.timestamp,
      signature: input.signature,
      body: input.rawBody,
      now: input.now || this.now(),
    });
    if (!verification.ok) {
      await this.repository.appendAudit({
        order_id: null,
        event: "billing.webhook.rejected",
        local_user_id: null,
        safe_details: safeDetails({
          code: verification.code,
          request_id: input.context?.requestId || null,
        }),
      });
      return billingFailure(
        verification.code === "replay" ? "payment_replay_detected" : "payment_invalid_signature",
        verification.code === "replay" ? 409 : 401,
        verification.message,
      );
    }

    let payload: BillingWebhookPayload;
    try {
      payload = JSON.parse(input.rawBody) as BillingWebhookPayload;
    } catch {
      return billingFailure("invalid_billing_request", 400, "Webhook payload is invalid.");
    }
    return this.applyWebhookPayload(payload, input.context || {});
  }

  async applyWebhookPayload(payload: BillingWebhookPayload, context: BillingRequestContext = {}): Promise<BillingWebhookResult> {
    if (!payload.event_id || !payload.order_id || !payload.provider_order_id) {
      return billingFailure("invalid_billing_request", 400, "Webhook payload is invalid.");
    }
    const eventResult = await this.repository.appendWebhookEvent(payload.order_id, payload.event_id, {
      eventType: payload.event_type,
      occurredAt: payload.occurred_at,
    });
    if (eventResult.alreadyProcessed) {
      await this.audit("billing.webhook.idempotent", eventResult.order, context, { event_id: payload.event_id });
      return { ok: true, status: 200, order: publicOrder(eventResult.order), action: "idempotent" };
    }

    const order = eventResult.order;
    const mismatch = this.webhookMismatch(order, payload);
    if (mismatch) {
      const review = await this.updateStatus(order, "review", {
        paid_amount: payload.paid_amount,
        last_error: mismatch,
      });
      await this.audit("billing.webhook.review", review, context, { event_id: payload.event_id, reason: mismatch });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }

    const targetStatus = statusFromEvent(payload.event_type);
    if (targetStatus === "paid") {
      return this.handlePaidWebhook(order, payload, context);
    }
    if (!assertTransition(order.status, targetStatus)) {
      const review = await this.updateStatus(order, "review", {
        last_error: `Illegal transition ${order.status} -> ${targetStatus}.`,
      });
      await this.audit("billing.webhook.out_of_order", review, context, { event_id: payload.event_id });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }

    const updated = await this.updateStatus(order, targetStatus, {
      paid_amount: payload.event_type === "payment_refunded" ? order.paid_amount : payload.paid_amount,
      paid_at: order.paid_at,
      refunded_at: targetStatus === "refunded" ? nowIso(this.now()) : order.refunded_at,
    });
    await this.audit(`billing.webhook.${targetStatus}`, updated, context, { event_id: payload.event_id });
    return { ok: true, status: 200, order: publicOrder(updated), action: "status_updated" };
  }

  async reconcile(input: { timeoutMinutes?: number; now?: Date } = {}): Promise<ReconciliationResult> {
    const now = input.now || this.now();
    const timeoutMs = (input.timeoutMinutes ?? 30) * 60 * 1000;
    const candidates = await this.repository.listOrders({ statuses: ["pending", "processing", "review"] });
    const result: ReconciliationResult = { checked: candidates.length, issues: [] };
    for (const order of candidates) {
      const ageMs = now.getTime() - Date.parse(order.updated_at);
      const providerStatus = this.getProviderStatus ? await this.getProviderStatus(order) : "unknown";
      if (
        (order.status === "processing" || order.status === "review")
        && order.paid_amount === order.requested_amount
        && !order.quota_credit_applied_at
      ) {
        const credited = await this.creditPaidOrder(order, {}, "reconcile");
        result.issues.push({
          order_id: order.order_id,
          status: credited.order.status,
          issue: credited.action === "credited" ? "quota_credit_retried" : "quota_credit_review",
          action: credited.action === "credited" ? "credited" : "marked_review",
        });
        continue;
      }
      if (providerStatus === "paid" && order.status !== "paid") {
        const paid = await this.updateStatus(order, "review", {
          last_error: "Provider reports paid but no verified webhook completed the order.",
        });
        result.issues.push({
          order_id: paid.order_id,
          status: paid.status,
          issue: "provider_paid_without_verified_webhook",
          action: "marked_review",
        });
        continue;
      }
      if (ageMs > timeoutMs && (order.status === "pending" || order.status === "processing")) {
        const review = await this.updateStatus(order, "review", {
          last_error: "Order exceeded reconciliation timeout.",
        });
        result.issues.push({
          order_id: review.order_id,
          status: review.status,
          issue: "timeout",
          action: "marked_review",
        });
      }
    }
    return result;
  }

  sandboxWebhookSecretConfigured() {
    return Boolean(sandboxWebhookSecret().trim());
  }

  rawPaymentChannelsForTests() {
    return listPaymentChannels();
  }

  private paymentDescriptor(order: BillingOrder) {
    return {
      channel: order.channel,
      provider_order_id: order.provider_order_id,
      sandbox_webhook_path: "/api/billing/webhooks/sandbox",
    };
  }

  private webhookMismatch(order: BillingOrder, payload: BillingWebhookPayload) {
    if (order.provider_order_id !== payload.provider_order_id) return "Provider order id mismatch.";
    if (order.local_user_id !== payload.local_user_id) return "Local user mismatch.";
    if (order.new_api_user_id !== payload.new_api_user_id) return "New API user mismatch.";
    if (order.channel !== payload.channel) return "Payment channel mismatch.";
    if (order.currency !== payload.currency) return "Payment currency mismatch.";
    if (payload.event_type === "payment_succeeded" && order.requested_amount !== payload.paid_amount) {
      return "Payment amount mismatch.";
    }
    return null;
  }

  private async updateStatus(
    order: BillingOrder,
    status: BillingOrderStatus,
    patch: Partial<BillingOrder> = {},
  ) {
    if (!assertTransition(order.status, status)) {
      return this.repository.updateOrder(order.order_id, {
        status: "review",
        updated_at: nowIso(this.now()),
        last_error: sanitizeError(`Illegal transition ${order.status} -> ${status}.`),
      }, order.version);
    }
    return this.repository.updateOrder(order.order_id, {
      ...patch,
      status,
      updated_at: nowIso(this.now()),
      last_error: patch.last_error ? sanitizeError(patch.last_error) : patch.last_error ?? order.last_error,
    }, order.version);
  }

  private async handlePaidWebhook(
    order: BillingOrder,
    payload: BillingWebhookPayload,
    context: BillingRequestContext,
    attempt = 0,
  ): Promise<BillingWebhookResult> {
    if (order.quota_credit_applied_at) {
      const paid = order.status === "paid" ? order : await this.updateStatus(order, "paid", {
        paid_amount: order.paid_amount || payload.paid_amount,
        paid_at: order.paid_at || payload.occurred_at || nowIso(this.now()),
      });
      await this.audit("billing.webhook.already_paid", paid, context, { event_id: payload.event_id });
      return { ok: true, status: 200, order: publicOrder(paid), action: "idempotent" };
    }

    if (order.status === "processing") {
      await this.audit("billing.webhook.processing", order, context, { event_id: payload.event_id });
      return { ok: true, status: 202, order: publicOrder(order), action: "idempotent" };
    }

    if (order.status !== "pending") {
      const review = await this.updateStatus(order, "review", {
        last_error: `Illegal transition ${order.status} -> paid.`,
      });
      await this.audit("billing.webhook.out_of_order", review, context, { event_id: payload.event_id });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }

    try {
      const processing = await this.updateStatus(order, "processing", {
        paid_amount: payload.paid_amount,
        paid_at: payload.occurred_at || nowIso(this.now()),
        last_error: null,
      });
      return this.creditPaidOrder(processing, context, payload.event_id);
    } catch (error) {
      if (!isVersionConflict(error) || attempt >= 3) throw error;
      const fresh = await this.repository.getOrder(order.order_id);
      if (!fresh) throw error;
      return this.handlePaidWebhook(fresh, payload, context, attempt + 1);
    }
  }

  private async creditPaidOrder(order: BillingOrder, context: BillingRequestContext, eventId: string) {
    if (order.quota_credit_applied_at) {
      const paid = order.status === "paid" ? order : await this.updateStatus(order, "paid", {});
      return { ok: true as const, status: 200, order: publicOrder(paid), action: "idempotent" as const };
    }

    const credit = await this.creditQuota({
      orderId: order.order_id,
      localUserId: order.local_user_id,
      newApiUserId: order.new_api_user_id,
      quotaUnits: order.credited_quota,
      idempotencyKey: `billing:${order.order_id}`,
    });
    if (!credit.ok) {
      const review = await this.updateStatusWithRetry(order, "review", {
        last_error: credit.message,
      });
      await this.audit("billing.quota.credit_failed", review, context, {
        event_id: eventId,
        error_code: credit.code,
        retryable: credit.retryable,
      });
      return { ok: true as const, status: 202, order: publicOrder(review), action: "review" as const };
    }

    const paid = await this.updateStatusWithRetry(order, "paid", {
      quota_credit_applied_at: nowIso(this.now()),
      last_error: null,
    });
    await this.audit("billing.quota.credited", paid, context, {
      event_id: eventId,
      provider_credit_id: credit.providerCreditId,
      credited_quota: paid.credited_quota,
    });
    return { ok: true as const, status: 200, order: publicOrder(paid), action: "credited" as const };
  }

  private async updateStatusWithRetry(
    order: BillingOrder,
    status: BillingOrderStatus,
    patch: Partial<BillingOrder> = {},
    attempt = 0,
  ): Promise<BillingOrder> {
    try {
      return await this.updateStatus(order, status, patch);
    } catch (error) {
      if (!isVersionConflict(error) || attempt >= 3) throw error;
      const fresh = await this.repository.getOrder(order.order_id);
      if (!fresh) throw error;
      return this.updateStatusWithRetry(fresh, status, patch, attempt + 1);
    }
  }

  private async listOrdersPageFallback(input: {
    localUserId: string;
    statuses?: BillingOrderStatus[];
    page: number;
    pageSize: number;
  }) {
    const orders = await this.repository.listOrders(input);
    const start = (input.page - 1) * input.pageSize;
    return {
      orders: orders.slice(start, start + input.pageSize),
      total: orders.length,
    };
  }


  private async audit(
    event: string,
    order: BillingOrder,
    context: BillingRequestContext,
    details: Record<string, string | number | boolean | null>,
  ) {
    await this.repository.appendAudit({
      order_id: order.order_id,
      event,
      local_user_id: order.local_user_id,
      safe_details: safeDetails({
        ...details,
        request_id: context.requestId || null,
      }),
    });
  }
}

let defaultBillingService: BillingService | null = null;

export function createBillingService(dependencies?: BillingServiceDependencies) {
  return new BillingService(dependencies);
}

export function getBillingService() {
  defaultBillingService ||= new BillingService();
  return defaultBillingService;
}

export { allowedTransitions };
