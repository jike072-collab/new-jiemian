import "server-only";

import { createHash } from "node:crypto";

import { type PaymentAdapter, type PaymentAdapterFailure } from "./payment-adapters";
import { type BillingOrder, type BillingWebhookPayload, type PaymentProviderStatus } from "./types";

export const ZPAY_ZHU_SHENGYONG_CHANNEL_ID = "19932";

const defaultMApiUrl = "https://zpayz.cn/mapi.php";
const defaultApiUrl = "https://zpayz.cn/api.php";

type ZpayConfig = {
  pid: string;
  key: string;
  channelId: string;
  notifyUrl: string;
  returnUrl: string;
  mapiUrl: string;
  apiUrl: string;
};

type ZpayCreateResponse = {
  code?: number | string;
  msg?: string;
  O_id?: string;
  trade_no?: string;
  payurl?: string;
  payurl2?: string;
  qrcode?: string;
  img?: string;
};

type ZpayOrderResponse = {
  code?: number | string;
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  money?: string;
  status?: number | string;
};

function failure(input: PaymentAdapterFailure): PaymentAdapterFailure {
  return input;
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function normalizePublicBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function zpayPublicBaseUrl() {
  return normalizePublicBaseUrl(
    env("ZPAY_PUBLIC_BASE_URL")
      || env("APP_PUBLIC_BASE_URL")
      || env("PUBLIC_APP_URL")
      || env("NEXT_PUBLIC_APP_URL"),
  );
}

function zpayChannelId() {
  return env("ZPAY_CHANNEL_ID") || ZPAY_ZHU_SHENGYONG_CHANNEL_ID;
}

function maybeZpayConfig(): ZpayConfig | null {
  const pid = env("ZPAY_PID");
  const key = env("ZPAY_KEY");
  const channelId = zpayChannelId();
  const publicBaseUrl = zpayPublicBaseUrl();
  const notifyUrl = env("ZPAY_NOTIFY_URL") || (publicBaseUrl ? `${publicBaseUrl}/api/billing/webhooks/production` : "");
  const returnUrl = env("ZPAY_RETURN_URL") || (publicBaseUrl ? `${publicBaseUrl}/` : "");
  if (!pid || !key || !notifyUrl || !returnUrl) return null;
  if (channelId !== ZPAY_ZHU_SHENGYONG_CHANNEL_ID) return null;
  return {
    pid,
    key,
    channelId,
    notifyUrl,
    returnUrl,
    mapiUrl: env("ZPAY_MAPI_URL") || defaultMApiUrl,
    apiUrl: env("ZPAY_API_URL") || defaultApiUrl,
  };
}

function assertZpayConfig(): ZpayConfig {
  const config = maybeZpayConfig();
  if (!config) {
    throw new Error("Z-Pay production payment is not configured.");
  }
  return config;
}

export function isZpayProductionPaymentConfigured() {
  return Boolean(maybeZpayConfig());
}

function signableEntries(params: Record<string, string>) {
  return Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export function signZpayParams(params: Record<string, string>, key: string) {
  const payload = signableEntries(params)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash("md5")
    .update(`${payload}${key}`)
    .digest("hex")
    .toLowerCase();
}

function createSignedParams(params: Record<string, string>, key: string) {
  const signed = { ...params };
  signed.sign = signZpayParams(signed, key);
  signed.sign_type = "MD5";
  return signed;
}

function parseZpayPayload(rawBody: string) {
  const search = rawBody.startsWith("?") ? rawBody.slice(1) : rawBody;
  const params = new URLSearchParams(search);
  const payload: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
}

function parseJsonResponse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isSuccessCode(value: unknown) {
  return value === 1 || value === "1";
}

function minorUnitsToYuan(amount: number) {
  return (amount / 100).toFixed(2);
}

function yuanToMinorUnits(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return Number.NaN;
  return Math.round(amount * 100);
}

export function createZpayPaymentParam(input: { localUserId: string; newApiUserId: string }) {
  return Buffer.from(JSON.stringify({
    localUserId: input.localUserId,
    newApiUserId: input.newApiUserId,
  }), "utf8").toString("base64url");
}

function parseZpayPaymentParam(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<{
      localUserId: string;
      newApiUserId: string;
    }>;
    if (typeof parsed.localUserId !== "string" || typeof parsed.newApiUserId !== "string") return null;
    return {
      localUserId: parsed.localUserId,
      newApiUserId: parsed.newApiUserId,
    };
  } catch {
    return null;
  }
}

function statusForZpayOrder(response: ZpayOrderResponse): PaymentProviderStatus {
  if (isSuccessCode(response.status)) return "paid";
  if (response.status === 0 || response.status === "0") return "pending";
  return "unknown";
}

function zpayStatusToEvent(status: string): BillingWebhookPayload["event_type"] {
  return status === "TRADE_SUCCESS" ? "payment_succeeded" : "payment_failed";
}

async function readTextResponse(response: Response) {
  return response.text().catch(() => "");
}

async function fetchZpayJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(url, init);
  const text = await readTextResponse(response);
  if (!response.ok) return null;
  return parseJsonResponse<T>(text);
}

function unavailable(message = "Z-Pay production payment is unavailable."): PaymentAdapterFailure {
  return failure({
    ok: false,
    status: 503,
    code: "payment_channel_unavailable",
    message,
  });
}

function invalidRequest(message = "Z-Pay payment request is invalid."): PaymentAdapterFailure {
  return failure({
    ok: false,
    status: 400,
    code: "invalid_billing_request",
    message,
  });
}

function invalidSignature(): PaymentAdapterFailure {
  return failure({
    ok: false,
    status: 401,
    code: "payment_invalid_signature",
    message: "Z-Pay webhook signature is invalid.",
  });
}

export function createZpayPaymentAdapter(): PaymentAdapter {
  return {
    kind: "production",
    async createOrder(input) {
      let config: ZpayConfig;
      try {
        config = assertZpayConfig();
      } catch {
        return unavailable();
      }
      const params = createSignedParams({
        pid: config.pid,
        cid: config.channelId,
        type: "alipay",
        out_trade_no: input.orderId,
        notify_url: config.notifyUrl,
        return_url: config.returnUrl,
        name: "傲凰AI积分充值",
        money: minorUnitsToYuan(input.requestedAmount),
        clientip: input.clientIp || "127.0.0.1",
        device: input.userAgent?.toLowerCase().includes("mobile") ? "mobile" : "pc",
        param: createZpayPaymentParam({
          localUserId: input.localUserId,
          newApiUserId: input.newApiUserId,
        }),
      }, config.key);
      const body = new URLSearchParams(params);
      const result = await fetchZpayJson<ZpayCreateResponse>(config.mapiUrl, {
        method: "POST",
        body,
      });
      if (!result || !isSuccessCode(result.code)) {
        return unavailable("Z-Pay order creation failed.");
      }
      const providerOrderId = String(result.trade_no || result.O_id || input.orderId).trim();
      if (!providerOrderId) return invalidRequest("Z-Pay order id is missing.");
      return {
        ok: true,
        providerOrderId,
        providerTradeNo: result.trade_no || result.O_id,
        checkoutUrl: result.payurl || result.payurl2 || result.qrcode,
        qrcodeUrl: result.qrcode,
        qrcodeImageUrl: result.img,
      };
    },
    async queryOrder(order) {
      let config: ZpayConfig;
      try {
        config = assertZpayConfig();
      } catch {
        return unavailable();
      }
      const url = new URL(config.apiUrl);
      url.searchParams.set("act", "order");
      url.searchParams.set("pid", config.pid);
      url.searchParams.set("key", config.key);
      url.searchParams.set("out_trade_no", order.order_id);
      const result = await fetchZpayJson<ZpayOrderResponse>(url.toString());
      if (!result || !isSuccessCode(result.code)) {
        return unavailable("Z-Pay order query failed.");
      }
      return { ok: true, providerStatus: statusForZpayOrder(result) };
    },
    async closeOrder(order) {
      return { ok: true, providerCloseId: `zpay:close:${order.order_id}` };
    },
    async refundOrder(input) {
      let config: ZpayConfig;
      try {
        config = assertZpayConfig();
      } catch {
        return unavailable();
      }
      const params = new URLSearchParams({
        act: "refund",
        pid: config.pid,
        key: config.key,
        out_trade_no: input.order.order_id,
        money: minorUnitsToYuan(input.order.paid_amount || input.order.requested_amount),
      });
      const result = await fetchZpayJson<{ code?: number | string; msg?: string }>(config.apiUrl, {
        method: "POST",
        body: params,
      });
      if (!result || !isSuccessCode(result.code)) {
        return unavailable("Z-Pay refund request failed.");
      }
      return { ok: true, providerRefundId: `zpay:refund:${input.order.order_id}:${input.idempotencyKey}` };
    },
    async verifyWebhook(input) {
      let config: ZpayConfig;
      try {
        config = assertZpayConfig();
      } catch {
        return unavailable();
      }
      const payload = parseZpayPayload(input.rawBody);
      const signature = payload.sign || "";
      if (!signature || signature.toLowerCase() !== signZpayParams(payload, config.key)) {
        return invalidSignature();
      }
      if (payload.pid !== config.pid) return invalidSignature();
      const tradeNo = payload.trade_no || "";
      const orderId = payload.out_trade_no || "";
      const money = yuanToMinorUnits(payload.money || "");
      const metadata = parseZpayPaymentParam(payload.param || "");
      if (!tradeNo || !orderId || !Number.isFinite(money) || !metadata) {
        return invalidRequest("Z-Pay webhook payload is invalid.");
      }
      const tradeStatus = payload.trade_status || "";
      return {
        ok: true,
        payload: {
          event_id: `zpay:${tradeNo}:${tradeStatus || "unknown"}`,
          event_type: zpayStatusToEvent(tradeStatus),
          order_id: orderId,
          provider_order_id: tradeNo,
          local_user_id: metadata.localUserId,
          new_api_user_id: metadata.newApiUserId,
          channel: "production_generic",
          currency: "CNY",
          paid_amount: money,
          occurred_at: new Date().toISOString(),
        },
      };
    },
    paymentDescriptor(order: BillingOrder) {
      return {
        channel: order.channel,
        provider_order_id: order.provider_order_id,
        provider: "production",
        webhook_path: "/api/billing/webhooks/production",
      };
    },
  };
}
