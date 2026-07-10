import { randomUUID } from "node:crypto";

import {
  adminCreditNewApiUserQuota,
  creditsToNewApiQuota,
  getNewApiQuotaDisplayConfig,
  type NewApiUserMappingRepository,
  type NewApiQuotaDisplayConfig,
} from "../integrations/new-api";
import { createAuthPersistenceRepositories } from "../auth/persistence";
import {
  amountAllowed,
  calculateCreditedQuota,
  getPaymentChannel,
  listPaymentChannels,
  publicPaymentChannels,
} from "./config";
import { createBillingPersistenceRepository } from "./persistence";
import { BillingRepositoryError, type BillingRepository } from "./repository";
import { getPaymentAdapter, type PaymentAdapter } from "./payment-adapters";
import { getMembershipService, type MembershipService } from "../membership/service";
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
  type PaymentProviderOperationResult,
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
  membershipService?: MembershipService;
  creditQuota?: (input: CreditQuotaInput) => Promise<CreditQuotaResult>;
  getProviderStatus?: (order: BillingOrder) => Promise<PaymentProviderStatus>;
  getPaymentAdapter?: (channel: string) => PaymentAdapter;
  getQuotaDisplayConfig?: () => Promise<NewApiQuotaDisplayConfig>;
  now?: () => Date;
};

const allowedTransitions: Record<BillingOrderStatus, BillingOrderStatus[]> = {
  pending: ["processing", "cancelled", "failed", "expired", "review"],
  processing: ["paid", "failed", "cancelled", "expired", "review"],
  paid: ["refunded", "review"],
  failed: ["review"],
  cancelled: ["review"],
  expired: ["review"],
  review: ["processing", "paid", "failed", "cancelled", "refunded"],
  refunded: ["review"],
};

const duplicatePendingOrderWindowMs = 5 * 60 * 1000;

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

function createBillingOrderId() {
  return `bo_${randomUUID().replace(/-/g, "").slice(0, 29)}`;
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

export class BillingService {
  private readonly repository: BillingRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly membershipService: MembershipService;
  private readonly getQuotaDisplayConfig: NonNullable<BillingServiceDependencies["getQuotaDisplayConfig"]>;
  private readonly creditQuota: (input: CreditQuotaInput) => Promise<CreditQuotaResult>;
  private readonly getProviderStatus?: (order: BillingOrder) => Promise<PaymentProviderStatus>;
  private readonly getPaymentAdapter: (channel: string) => PaymentAdapter;
  private readonly now: () => Date;

  constructor(dependencies: BillingServiceDependencies = {}) {
    this.repository = dependencies.repository || createBillingPersistenceRepository();
    this.mappingRepository = dependencies.mappingRepository || createAuthPersistenceRepositories().mappingRepository;
    this.membershipService = dependencies.membershipService || getMembershipService();
    this.getQuotaDisplayConfig = dependencies.getQuotaDisplayConfig || getNewApiQuotaDisplayConfig;
    this.creditQuota = dependencies.creditQuota || this.defaultCreditQuota.bind(this);
    this.getProviderStatus = dependencies.getProviderStatus;
    this.getPaymentAdapter = dependencies.getPaymentAdapter || getPaymentAdapter;
    this.now = dependencies.now || (() => new Date());
  }

  private async defaultCreditQuota(input: CreditQuotaInput): Promise<CreditQuotaResult> {
    try {
      const quotaDisplayConfig = await this.getQuotaDisplayConfig();
      await adminCreditNewApiUserQuota({
        newApiUserId: Number(input.newApiUserId),
        quotaDelta: creditsToNewApiQuota(input.quotaUnits, quotaDisplayConfig),
      });
      return {
        ok: true,
        providerCreditId: `new-api:${input.orderId}`,
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

  listPaymentChannels() {
    return publicPaymentChannels();
  }

  async createOrder(input: CreateBillingOrderInput, context: BillingRequestContext = {}): Promise<CreateBillingOrderResult> {
    const channel = getPaymentChannel(input.channel);
    if (!channel || !channel.enabled) {
      return billingFailure("payment_channel_unavailable", 400, "Payment channel is unavailable.");
    }
    const productType = input.productType || "credits";
    const sku = productType === "membership"
      ? this.membershipService.getSku(input.planId, input.cycle)
      : null;
    const requestedAmount = productType === "membership" && sku ? sku.price_amount : input.requestedAmount;
    if (
      input.currency !== channel.currency
      || (productType === "membership" && (!sku || input.requestedAmount !== requestedAmount))
      || !amountAllowed(channel, requestedAmount)
    ) {
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

    const duplicate = await this.findRecentOpenOrder({
      localUserId: input.localUserId,
      channel: channel.channel,
      productType,
      requestedAmount,
      planId: sku ? sku.plan.id : null,
      cycle: sku ? sku.cycle : null,
    });
    if (duplicate) {
      await this.audit("billing.order.reused_open_order", duplicate, context, {
        request_id: context.requestId || null,
        product_type: productType,
      });
      return {
        ok: true,
        status: 200,
        order: publicOrder(duplicate),
        payment: this.paymentDescriptor(duplicate),
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
    const orderId = createBillingOrderId();
    const creditedQuota = sku
      ? sku.grant_credits
      : await this.calculateCreditedQuotaWithMembershipBonus(input.localUserId, channel, requestedAmount);
    const adapter = this.getPaymentAdapter(channel.channel);
    const providerOrder = await adapter.createOrder({
      orderId,
      localUserId: input.localUserId,
      newApiUserId: mapping.new_api_user_id,
      channel: channel.channel,
      currency: channel.currency,
      requestedAmount,
      idempotencyKey,
      clientIp: context.ip,
      userAgent: context.userAgent,
    });
    if (!providerOrder.ok) {
      await this.repository.appendAudit({
        order_id: null,
        event: "billing.order.provider_rejected",
        local_user_id: input.localUserId,
        safe_details: safeDetails({
          channel: channel.channel,
          code: providerOrder.code,
          request_id: context.requestId || null,
        }),
      });
      return billingFailure(providerOrder.code, providerOrder.status, providerOrder.message);
    }
    const order = await this.repository.createOrder({
      order_id: orderId,
      local_user_id: input.localUserId,
      new_api_user_id: mapping.new_api_user_id,
      channel: channel.channel,
      currency: channel.currency,
      requested_amount: requestedAmount,
      paid_amount: 0,
      credited_quota: creditedQuota,
      product_type: productType,
      product_plan_id: sku ? sku.plan.id : null,
      product_cycle: sku ? sku.cycle : null,
      status: "pending",
      idempotency_key: idempotencyKey,
      provider_order_id: providerOrder.providerOrderId,
      created_at: timestamp,
      updated_at: timestamp,
      paid_at: null,
      last_error: null,
      quota_credit_applied_at: null,
      refunded_at: null,
    });
    await this.audit("billing.order.created", order, context, {
      amount: requestedAmount,
      credited_quota: creditedQuota,
      product_type: productType,
    });
    return {
      ok: true,
      status: 201,
      order: publicOrder(order),
      payment: {
        ...this.paymentDescriptor(order),
        ...(providerOrder.checkoutUrl ? { checkout_url: providerOrder.checkoutUrl } : {}),
        ...(providerOrder.qrcodeUrl ? { qrcode_url: providerOrder.qrcodeUrl } : {}),
        ...(providerOrder.qrcodeImageUrl ? { qrcode_image_url: providerOrder.qrcodeImageUrl } : {}),
        ...(providerOrder.providerTradeNo ? { provider_trade_no: providerOrder.providerTradeNo } : {}),
      },
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

  async queryProviderOrder(localUserId: string, orderId: string): Promise<PaymentProviderOperationResult> {
    const order = await this.repository.getOrder(orderId);
    if (!order || order.local_user_id !== localUserId) {
      return billingFailure("payment_not_found", 404, "Payment order was not found.");
    }
    const result = await this.getPaymentAdapter(order.channel).queryOrder(order);
    if (!result.ok) return billingFailure(result.code, result.status, result.message);
    return {
      ok: true,
      status: 200,
      provider: this.getPaymentAdapter(order.channel).kind,
      provider_order_id: order.provider_order_id,
      provider_status: result.providerStatus,
    };
  }

  async closeProviderOrder(localUserId: string, orderId: string): Promise<PaymentProviderOperationResult> {
    const order = await this.repository.getOrder(orderId);
    if (!order || order.local_user_id !== localUserId) {
      return billingFailure("payment_not_found", 404, "Payment order was not found.");
    }
    if (order.status !== "pending") {
      return billingFailure("invalid_billing_request", 409, "Only pending payment orders can be closed.");
    }
    const adapter = this.getPaymentAdapter(order.channel);
    const result = await adapter.closeOrder(order);
    if (!result.ok) return billingFailure(result.code, result.status, result.message);
    return {
      ok: true,
      status: 200,
      provider: adapter.kind,
      provider_order_id: order.provider_order_id,
      provider_operation_id: result.providerCloseId,
    };
  }

  async requestProviderRefund(input: {
    localUserId: string;
    orderId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<PaymentProviderOperationResult> {
    const order = await this.repository.getOrder(input.orderId);
    if (!order || order.local_user_id !== input.localUserId) {
      return billingFailure("payment_not_found", 404, "Payment order was not found.");
    }
    if (order.status !== "paid") {
      return billingFailure("invalid_billing_request", 409, "Only paid payment orders can be refunded.");
    }
    const adapter = this.getPaymentAdapter(order.channel);
    const result = await adapter.refundOrder({
      order,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    if (!result.ok) return billingFailure(result.code, result.status, result.message);
    return {
      ok: true,
      status: 202,
      provider: adapter.kind,
      provider_order_id: order.provider_order_id,
      provider_operation_id: result.providerRefundId,
    };
  }

  async handleSandboxWebhook(input: {
    rawBody: string;
    timestamp: string | null;
    signature: string | null;
    now?: Date;
    context?: BillingRequestContext;
  }): Promise<BillingWebhookResult> {
    return this.handlePaymentWebhook("sandbox_alipay", {
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      signature: input.signature,
      now: input.now || this.now(),
      context: input.context,
    });
  }

  async handleProductionWebhook(input: {
    rawBody: string;
    timestamp: string | null;
    signature: string | null;
    now?: Date;
    context?: BillingRequestContext;
  }): Promise<BillingWebhookResult> {
    return this.handlePaymentWebhook("production_generic", {
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      signature: input.signature,
      now: input.now || this.now(),
      context: input.context,
    });
  }

  async handlePaymentWebhook(channel: string, input: {
    rawBody: string;
    timestamp: string | null;
    signature: string | null;
    now?: Date;
    context?: BillingRequestContext;
  }): Promise<BillingWebhookResult> {
    const verification = await this.getPaymentAdapter(channel).verifyWebhook({
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      signature: input.signature,
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
      return billingFailure(verification.code, verification.status, verification.message);
    }
    return this.applyWebhookPayload(verification.payload, input.context || {});
  }

  async applyWebhookPayload(payload: BillingWebhookPayload, context: BillingRequestContext = {}): Promise<BillingWebhookResult> {
    if (!payload.event_id || !payload.order_id || !payload.provider_order_id) {
      return billingFailure("invalid_billing_request", 400, "Webhook payload is invalid.");
    }
    const eventResult = await this.repository.appendWebhookEvent(payload.order_id, payload.event_id, {
      eventType: payload.event_type,
      occurredAt: payload.occurred_at,
      status: "received",
    });
    let order = eventResult.order;
    const eventStatus = eventResult.event.status;
    const wasCompleted = eventResult.completed;
    const canBindFallbackProviderOrderId = (
      order.provider_order_id === order.order_id
      && payload.order_id === order.order_id
      && Boolean(payload.provider_order_id.trim())
    );
    if (wasCompleted && !(
      eventResult.event.safe_error === "Provider order id mismatch."
      && canBindFallbackProviderOrderId
    )) {
      await this.audit("billing.webhook.idempotent", order, context, { event_id: payload.event_id });
      return { ok: true, status: 200, order: publicOrder(order), action: "idempotent" };
    }
    if (wasCompleted) {
      await this.repository.updateWebhookEventStatus(payload.event_id, "processing", null);
      order = await this.repository.getOrder(payload.order_id) || order;
    }
    if (eventStatus === "received") {
      const claimed = await this.repository.updateWebhookEventStatus(payload.event_id, "processing");
      if (claimed?.status !== "processing") {
        await this.audit("billing.webhook.processing", order, context, { event_id: payload.event_id });
        return { ok: true, status: 202, order: publicOrder(order), action: "idempotent" };
      }
      if (claimed) {
        order = await this.repository.getOrder(payload.order_id) || order;
      }
    }

    const mismatch = this.webhookMismatch(order, payload, canBindFallbackProviderOrderId);
    if (mismatch) {
      const review = await this.updateStatus(order, "review", {
        paid_amount: payload.paid_amount,
        last_error: mismatch,
      });
      await this.repository.updateWebhookEventStatus(payload.event_id, "completed", mismatch);
      await this.audit("billing.webhook.review", review, context, { event_id: payload.event_id, reason: mismatch });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }
    if (canBindFallbackProviderOrderId && order.provider_order_id !== payload.provider_order_id) {
      order = await this.repository.updateOrder(order.order_id, {
        provider_order_id: payload.provider_order_id,
      }, order.version);
    }

    const targetStatus = statusFromEvent(payload.event_type);
    if (targetStatus === "paid") {
      return this.handlePaidWebhook(order, payload, context);
    }
    if (!assertTransition(order.status, targetStatus)) {
      const review = await this.updateStatus(order, "review", {
        last_error: `Illegal transition ${order.status} -> ${targetStatus}.`,
      });
      await this.repository.updateWebhookEventStatus(payload.event_id, "completed", review.last_error);
      await this.audit("billing.webhook.out_of_order", review, context, { event_id: payload.event_id });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }

    const updated = await this.updateStatus(order, targetStatus, {
      paid_amount: payload.event_type === "payment_refunded" ? order.paid_amount : payload.paid_amount,
      paid_at: order.paid_at,
      refunded_at: targetStatus === "refunded" ? nowIso(this.now()) : order.refunded_at,
    });
    if (targetStatus === "refunded" && updated.product_type === "membership") {
      try {
        await this.membershipService.cancelByOrder(updated.order_id, this.now());
      } catch (error) {
        const review = await this.updateStatus(updated, "review", {
          last_error: sanitizeError(error instanceof Error ? error.message : "Membership cancellation failed."),
        });
        await this.repository.updateWebhookEventStatus(payload.event_id, "failed", review.last_error);
        await this.audit("billing.membership.refund_cancel_failed", review, context, { event_id: payload.event_id });
        return { ok: true, status: 202, order: publicOrder(review), action: "review" };
      }
    }
    await this.repository.updateWebhookEventStatus(payload.event_id, "completed", null);
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
        const expired = await this.updateStatus(order, "expired", {
          last_error: "Order exceeded reconciliation timeout.",
        });
        result.issues.push({
          order_id: expired.order_id,
          status: expired.status,
          issue: "timeout",
          action: "marked_expired",
        });
      }
    }
    return result;
  }

  private async findRecentOpenOrder(input: {
    localUserId: string;
    channel: string;
    productType: BillingOrder["product_type"];
    requestedAmount: number;
    planId: string | null;
    cycle: string | null;
  }) {
    const cutoff = this.now().getTime() - duplicatePendingOrderWindowMs;
    const orders = await this.repository.listOrders({
      localUserId: input.localUserId,
      statuses: ["pending", "processing"],
    });
    return orders.find((order) => (
      Date.parse(order.created_at) >= cutoff
      && order.channel === input.channel
      && order.product_type === input.productType
      && order.requested_amount === input.requestedAmount
      && order.product_plan_id === input.planId
      && order.product_cycle === input.cycle
    )) || null;
  }

  sandboxWebhookSecretConfigured() {
    return Boolean(process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET?.trim());
  }

  rawPaymentChannelsForTests() {
    return listPaymentChannels();
  }

  private paymentDescriptor(order: BillingOrder) {
    return this.getPaymentAdapter(order.channel).paymentDescriptor(order);
  }

  private async calculateCreditedQuotaWithMembershipBonus(
    localUserId: string,
    channel: Parameters<typeof calculateCreditedQuota>[0],
    requestedAmount: number,
  ) {
    const baseQuota = calculateCreditedQuota(channel, requestedAmount);
    const status = await this.membershipService.getStatus(localUserId, this.now());
    const bonusBasisPoints = Math.max(0, status.recharge_bonus_basis_points || 0);
    return Math.floor((baseQuota * (10000 + bonusBasisPoints)) / 10000);
  }

  private webhookMismatch(order: BillingOrder, payload: BillingWebhookPayload, canBindFallbackProviderOrderId = false) {
    if (order.provider_order_id !== payload.provider_order_id && !canBindFallbackProviderOrderId) return "Provider order id mismatch.";
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
    eventId = payload.event_id,
  ): Promise<BillingWebhookResult> {
    if (order.quota_credit_applied_at) {
      const paid = order.status === "paid" ? order : await this.updateStatus(order, "paid", {
        paid_amount: order.paid_amount || payload.paid_amount,
        paid_at: order.paid_at || payload.occurred_at || nowIso(this.now()),
      });
      await this.repository.updateWebhookEventStatus(eventId, "completed", null);
      await this.audit("billing.webhook.already_paid", paid, context, { event_id: payload.event_id });
      return { ok: true, status: 200, order: publicOrder(paid), action: "idempotent" };
    }

    if (order.status === "processing") {
      const credited = await this.creditPaidOrder(order, context, eventId);
      if (credited.ok && credited.action === "credited") {
        await this.repository.updateWebhookEventStatus(eventId, "completed", null);
      }
      return credited;
    }

    if (
      order.status === "review"
      && order.paid_amount === payload.paid_amount
      && !order.quota_credit_applied_at
    ) {
      const credited = await this.creditPaidOrder(order, context, eventId);
      if (credited.ok && credited.action === "credited") {
        await this.repository.updateWebhookEventStatus(eventId, "completed", null);
      }
      return credited;
    }

    if (order.status !== "pending") {
      const review = await this.updateStatus(order, "review", {
        last_error: `Illegal transition ${order.status} -> paid.`,
      });
      await this.repository.updateWebhookEventStatus(eventId, "completed", review.last_error);
      await this.audit("billing.webhook.out_of_order", review, context, { event_id: payload.event_id });
      return { ok: true, status: 202, order: publicOrder(review), action: "review" };
    }

    try {
      const processing = await this.updateStatus(order, "processing", {
        paid_amount: payload.paid_amount,
        paid_at: payload.occurred_at || nowIso(this.now()),
        last_error: null,
      });
      await this.repository.updateWebhookEventStatus(eventId, "processing", null);
      const result = await this.creditPaidOrder(processing, context, eventId);
      if (result.ok && result.action === "credited") {
        await this.repository.updateWebhookEventStatus(eventId, "completed", null);
      }
      return result;
    } catch (error) {
      if (!isVersionConflict(error) || attempt >= 3) throw error;
      const fresh = await this.repository.getOrder(order.order_id);
      if (!fresh) throw error;
      return this.handlePaidWebhook(fresh, payload, context, attempt + 1, eventId);
    }
  }

  private async creditPaidOrder(order: BillingOrder, context: BillingRequestContext, eventId: string) {
    if (order.product_type === "membership") {
      return this.fulfillMembershipOrder(order, context, eventId);
    }

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
      await this.repository.updateWebhookEventStatus(eventId, "failed", sanitizeError(credit.message));
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
    await this.repository.updateWebhookEventStatus(eventId, "completed", null);
    await this.audit("billing.quota.credited", paid, context, {
      event_id: eventId,
      provider_credit_id: credit.providerCreditId,
      credited_quota: paid.credited_quota,
    });
    return { ok: true as const, status: 200, order: publicOrder(paid), action: "credited" as const };
  }

  private async fulfillMembershipOrder(order: BillingOrder, context: BillingRequestContext, eventId: string) {
    if (order.quota_credit_applied_at) {
      const paid = order.status === "paid" ? order : await this.updateStatus(order, "paid", {});
      return { ok: true as const, status: 200, order: publicOrder(paid), action: "idempotent" as const };
    }
    const sku = this.membershipService.getSku(order.product_plan_id, order.product_cycle);
    if (!sku || sku.price_amount !== order.requested_amount) {
      const review = await this.updateStatusWithRetry(order, "review", {
        last_error: "Invalid membership SKU on paid order.",
      });
      await this.repository.updateWebhookEventStatus(eventId, "failed", review.last_error);
      await this.audit("billing.membership.invalid_sku", review, context, { event_id: eventId });
      return { ok: true as const, status: 202, order: publicOrder(review), action: "review" as const };
    }

    const credit = await this.creditQuota({
      orderId: order.order_id,
      localUserId: order.local_user_id,
      newApiUserId: order.new_api_user_id,
      quotaUnits: order.credited_quota,
      idempotencyKey: `membership-credit:${order.order_id}`,
    });
    if (!credit.ok) {
      const review = await this.updateStatusWithRetry(order, "review", {
        last_error: credit.message,
      });
      await this.repository.updateWebhookEventStatus(eventId, "failed", sanitizeError(credit.message));
      await this.audit("billing.membership.credit_failed", review, context, {
        event_id: eventId,
        error_code: credit.code,
        retryable: credit.retryable,
      });
      return { ok: true as const, status: 202, order: publicOrder(review), action: "review" as const };
    }

    try {
      await this.membershipService.applyPaidMembership({
        localUserId: order.local_user_id,
        orderId: order.order_id,
        planId: order.product_plan_id,
        cycle: order.product_cycle,
        now: this.now(),
      });
    } catch (error) {
      const review = await this.updateStatusWithRetry(order, "review", {
        last_error: sanitizeError(error instanceof Error ? error.message : "Membership activation failed."),
      });
      await this.repository.updateWebhookEventStatus(eventId, "failed", review.last_error);
      await this.audit("billing.membership.activation_failed", review, context, {
        event_id: eventId,
        provider_credit_id: credit.providerCreditId,
      });
      return { ok: true as const, status: 202, order: publicOrder(review), action: "review" as const };
    }

    const paid = await this.updateStatusWithRetry(order, "paid", {
      quota_credit_applied_at: nowIso(this.now()),
      last_error: null,
    });
    await this.repository.updateWebhookEventStatus(eventId, "completed", null);
    await this.audit("billing.membership.fulfilled", paid, context, {
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
