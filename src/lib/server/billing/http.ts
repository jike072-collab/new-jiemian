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
import { type BillingErrorCode } from "./types";

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
