import { type BillingCurrency, type BillingOrder, type BillingWebhookPayload, type PaymentProviderStatus } from "./types";
import { assertProductionPaymentEnabled, assertSandboxWebhookEnabled, getPaymentChannel } from "./config";
import { verifySandboxWebhook } from "./sandbox-provider";

export type PaymentAdapterKind = "sandbox" | "production";

export type PaymentAdapterFailure = {
  ok: false;
  status: number;
  code: "billing_disabled" | "invalid_billing_request" | "payment_channel_unavailable" | "payment_invalid_signature" | "payment_replay_detected";
  message: string;
};

export type PaymentAdapterResult<T> = ({ ok: true } & T) | PaymentAdapterFailure;

export type PaymentCreateInput = {
  orderId: string;
  localUserId: string;
  newApiUserId: string;
  channel: string;
  currency: BillingCurrency;
  requestedAmount: number;
  idempotencyKey: string;
};

export type PaymentRefundInput = {
  order: BillingOrder;
  idempotencyKey: string;
  reason: string;
};

export type PaymentWebhookInput = {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: Date;
};

export type PaymentAdapter = {
  kind: PaymentAdapterKind;
  createOrder(input: PaymentCreateInput): Promise<PaymentAdapterResult<{ providerOrderId: string }>>;
  queryOrder(order: BillingOrder): Promise<PaymentAdapterResult<{ providerStatus: PaymentProviderStatus }>>;
  closeOrder(order: BillingOrder): Promise<PaymentAdapterResult<{ providerCloseId: string }>>;
  refundOrder(input: PaymentRefundInput): Promise<PaymentAdapterResult<{ providerRefundId: string }>>;
  verifyWebhook(input: PaymentWebhookInput): Promise<PaymentAdapterResult<{ payload: BillingWebhookPayload }>>;
  paymentDescriptor(order: BillingOrder): {
    channel: string;
    provider_order_id: string;
    provider: PaymentAdapterKind;
    webhook_path: string;
    sandbox_webhook_path?: string;
  };
};

function failure(input: PaymentAdapterFailure): PaymentAdapterFailure {
  return input;
}

function unavailable(message = "Payment channel is unavailable."): PaymentAdapterFailure {
  return failure({
    ok: false,
    status: 400,
    code: "payment_channel_unavailable",
    message,
  });
}

function parsePayload(rawBody: string): PaymentAdapterResult<{ payload: BillingWebhookPayload }> {
  try {
    const payload = JSON.parse(rawBody) as BillingWebhookPayload;
    return { ok: true, payload };
  } catch {
    return failure({
      ok: false,
      status: 400,
      code: "invalid_billing_request",
      message: "Webhook payload is invalid.",
    });
  }
}

function mapVerificationFailure(input: { code: string; message: string }): PaymentAdapterFailure {
  return failure({
    ok: false,
    status: input.code === "replay" ? 409 : 401,
    code: input.code === "replay" ? "payment_replay_detected" : "payment_invalid_signature",
    message: input.message,
  });
}

function assertChannelEnabled(channel: string) {
  const config = getPaymentChannel(channel);
  return Boolean(config?.enabled);
}

function providerStatusFor(order: BillingOrder): PaymentProviderStatus {
  switch (order.status) {
    case "pending":
    case "paid":
    case "failed":
    case "cancelled":
    case "refunded":
      return order.status;
    default:
      return "unknown";
  }
}

export function createSandboxPaymentAdapter(): PaymentAdapter {
  return {
    kind: "sandbox",
    async createOrder(input) {
      if (!assertChannelEnabled(input.channel)) return unavailable();
      return { ok: true, providerOrderId: `sandbox_${input.orderId}` };
    },
    async queryOrder(order) {
      return { ok: true, providerStatus: providerStatusFor(order) };
    },
    async closeOrder(order) {
      return { ok: true, providerCloseId: `sandbox:close:${order.order_id}` };
    },
    async refundOrder(input) {
      return { ok: true, providerRefundId: `sandbox:refund:${input.order.order_id}:${input.idempotencyKey}` };
    },
    async verifyWebhook(input) {
      let secret: string;
      try {
        secret = assertSandboxWebhookEnabled();
      } catch {
        return failure({
          ok: false,
          status: 503,
          code: "billing_disabled",
          message: "Sandbox payment webhook is disabled.",
        });
      }
      const verification = verifySandboxWebhook({
        secret,
        timestamp: input.timestamp,
        signature: input.signature,
        body: input.rawBody,
        now: input.now,
      });
      if (!verification.ok) return mapVerificationFailure(verification);
      return parsePayload(input.rawBody);
    },
    paymentDescriptor(order) {
      return {
        channel: order.channel,
        provider_order_id: order.provider_order_id,
        provider: "sandbox",
        webhook_path: "/api/billing/webhooks/sandbox",
        sandbox_webhook_path: "/api/billing/webhooks/sandbox",
      };
    },
  };
}

export function createProductionPaymentAdapter(): PaymentAdapter {
  const disabled = () => {
    try {
      assertProductionPaymentEnabled();
      return null;
    } catch {
      return failure({
        ok: false as const,
        status: 503,
        code: "billing_disabled" as const,
        message: "Production payment is disabled.",
      });
    }
  };
  return {
    kind: "production",
    async createOrder(input) {
      const blocked = disabled();
      if (blocked) return blocked;
      if (!assertChannelEnabled(input.channel)) return unavailable("Production payment channel is unavailable.");
      return { ok: true, providerOrderId: `production_${input.orderId}` };
    },
    async queryOrder(order) {
      const blocked = disabled();
      if (blocked) return blocked;
      return { ok: true, providerStatus: providerStatusFor(order) };
    },
    async closeOrder(order) {
      const blocked = disabled();
      if (blocked) return blocked;
      return { ok: true, providerCloseId: `production:close:${order.order_id}` };
    },
    async refundOrder(input) {
      const blocked = disabled();
      if (blocked) return blocked;
      return { ok: true, providerRefundId: `production:refund:${input.order.order_id}:${input.idempotencyKey}` };
    },
    async verifyWebhook(input) {
      let secret: string;
      try {
        secret = assertProductionPaymentEnabled();
      } catch {
        return failure({
          ok: false,
          status: 503,
          code: "billing_disabled",
          message: "Production payment is disabled.",
        });
      }
      const verification = verifySandboxWebhook({
        secret,
        timestamp: input.timestamp,
        signature: input.signature,
        body: input.rawBody,
        now: input.now,
      });
      if (!verification.ok) return mapVerificationFailure(verification);
      return parsePayload(input.rawBody);
    },
    paymentDescriptor(order) {
      return {
        channel: order.channel,
        provider_order_id: order.provider_order_id,
        provider: "production",
        webhook_path: "/api/billing/webhooks/production",
      };
    },
  };
}

export function getPaymentAdapter(channel: string): PaymentAdapter {
  return channel.startsWith("production_")
    ? createProductionPaymentAdapter()
    : createSandboxPaymentAdapter();
}
