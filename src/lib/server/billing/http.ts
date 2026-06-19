import { type NextRequest, NextResponse } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  requireAuthSession,
  requireCsrf,
  readJsonBody,
} from "../auth";
import { getBillingService } from "./service";
import { type BillingErrorCode, type BillingOrderStatus } from "./types";

function billingErrorResponse(input: {
  code: BillingErrorCode;
  status: number;
  message: string;
}) {
  return NextResponse.json({
    ok: false,
    code: input.code,
    message: input.message,
  }, { status: input.status });
}

async function requireLocalUser(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: billingErrorResponse({
        code: "permission_denied",
        status: session.status,
        message: "Permission denied.",
      }),
    };
  }
  return { ok: true as const, localUserId: session.user.local_user_id };
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isInteger(amount) ? amount : Number.NaN;
}

const orderStatuses = new Set<BillingOrderStatus>([
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "review",
  "refunded",
]);

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || "");
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseStatuses(value: string | null) {
  if (!value) return undefined;
  const statuses = value
    .split(",")
    .map((status) => status.trim())
    .filter((status): status is BillingOrderStatus => orderStatuses.has(status as BillingOrderStatus));
  return statuses.length ? statuses : undefined;
}

export function paymentConfigResponse() {
  return NextResponse.json({
    ok: true,
    channels: getBillingService().listPaymentChannels(),
  });
}

export async function createBillingOrderResponse(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  const result = await getBillingService().createOrder({
    localUserId: auth.localUserId,
    channel: String(body.channel || ""),
    currency: body.currency === "CNY" ? "CNY" : "CNY",
    requestedAmount: parseAmount(body.requestedAmount),
    idempotencyKey: String(body.idempotencyKey || ""),
  }, authRequestContext(request));
  if (!result.ok) return billingErrorResponse(result);
  return NextResponse.json({
    ok: true,
    order: result.order,
    payment: result.payment,
  }, { status: result.status });
}

export async function listBillingOrdersResponse(request: NextRequest) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const result = await getBillingService().listOrdersForUser({
    localUserId: auth.localUserId,
    statuses: parseStatuses(url.searchParams.get("status")),
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1000000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100),
  });
  if (!result.ok) return billingErrorResponse(result);
  return NextResponse.json({
    ok: true,
    orders: result.orders,
    page: result.page,
    page_size: result.page_size,
    total: result.total,
    has_more: result.has_more,
  }, { status: result.status });
}

export async function getBillingOrderResponse(request: NextRequest, orderId: string) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const result = await getBillingService().getOrderForUser(auth.localUserId, orderId);
  if (!result.ok) return billingErrorResponse(result);
  return NextResponse.json({
    ok: true,
    order: result.order,
  });
}

export async function sandboxWebhookResponse(request: NextRequest) {
  const rawBody = await request.text();
  const result = await getBillingService().handleSandboxWebhook({
    rawBody,
    timestamp: request.headers.get("x-payment-timestamp"),
    signature: request.headers.get("x-payment-signature"),
    context: authRequestContext(request),
  });
  if (!result.ok) return billingErrorResponse(result);
  return NextResponse.json({
    ok: true,
    action: result.action,
    order: result.order,
  }, { status: result.status });
}

export async function productionWebhookResponse(request: NextRequest) {
  const rawBody = await request.text();
  const result = await getBillingService().handleProductionWebhook({
    rawBody,
    timestamp: request.headers.get("x-payment-timestamp"),
    signature: request.headers.get("x-payment-signature"),
    context: authRequestContext(request),
  });
  if (!result.ok) return billingErrorResponse(result);
  return NextResponse.json({
    ok: true,
    action: result.action,
    order: result.order,
  }, { status: result.status });
}
