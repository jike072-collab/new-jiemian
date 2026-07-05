import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  requireAuthSession,
  requireCsrf,
  readJsonBody,
} from "../auth";
import { InMemoryRateLimiter } from "../auth/rate-limit";
import { getMembershipService } from "../membership/service";
import { getTaskBillingService } from "../quota/task-billing-service";
import { getPromptOptimizeService } from "./optimizer";

const limiter = new InMemoryRateLimiter(
  Number(process.env.PROMPT_OPTIMIZER_RATE_LIMIT || 20),
  60_000,
);
const PROMPT_OPTIMIZE_QUOTA_UNITS = 10;

function failureResponse(input: {
  code: string;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}) {
  return NextResponse.json({
    ok: false,
    code: input.code,
    message: input.message,
    retryAfterSeconds: input.retryAfterSeconds,
  }, { status: input.status });
}

export async function optimizePromptResponse(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());

  const session = await requireAuthSession(request);
  if (!session.ok) {
    return failureResponse({
      code: "permission_denied",
      status: session.status,
      message: "Permission denied.",
    });
  }

  const context = authRequestContext(request);
  const rateKey = `${session.user.local_user_id}:${context.ip || "unknown"}`;
  const rate = limiter.consume(rateKey);
  if (!rate.allowed) {
    return failureResponse({
      code: "rate_limited",
      status: 429,
      message: "Too many prompt optimization requests.",
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const body = await readJsonBody(request);
  const idempotencyKey = String(body.idempotencyKey || body.taskId || context.requestId || `prompt-${randomUUID()}`).trim();
  const membership = getMembershipService();
  const membershipStatus = await membership.getStatus(session.user.local_user_id);
  const hasPromptEntitlement = membershipStatus.entitlements.prompt_optimize.remaining > 0;
  const taskBilling = getTaskBillingService();

  if (!hasPromptEntitlement) {
    const precheck = await taskBilling.precheck({
      localUserId: session.user.local_user_id,
      taskId: idempotencyKey,
      operation: "prompt_optimize",
      estimatedQuotaUnits: PROMPT_OPTIMIZE_QUOTA_UNITS,
      idempotencyKey,
      requestFingerprint: `prompt_optimize:${idempotencyKey}`,
    });
    if (!precheck.ok) return failureResponse(precheck);
  }

  const result = await getPromptOptimizeService().optimize(body, {
    localUserId: session.user.local_user_id,
    requestId: context.requestId,
  });

  if (!result.ok) {
    if (!hasPromptEntitlement) {
      await taskBilling.fail({
        localUserId: session.user.local_user_id,
        taskId: idempotencyKey,
        reason: result.message,
      }).catch(() => undefined);
    }
    return failureResponse(result);
  }

  const entitlement = hasPromptEntitlement && idempotencyKey
    ? await membership.consumeEntitlement({
      localUserId: session.user.local_user_id,
      kind: "prompt_optimize",
      amount: 1,
      idempotencyKey: `membership:prompt_optimize:${idempotencyKey}`,
      taskId: idempotencyKey,
    })
    : { consumed: 0 };
  if (!hasPromptEntitlement) {
    const settled = await taskBilling.settleSuccess({
      localUserId: session.user.local_user_id,
      taskId: idempotencyKey,
      actualQuotaUnits: PROMPT_OPTIMIZE_QUOTA_UNITS,
    });
    if (!settled.ok) return failureResponse(settled);
  }

  return NextResponse.json({
    optimizedPrompt: result.optimizedPrompt,
    membershipEntitlementConsumed: entitlement.consumed,
  });
}
