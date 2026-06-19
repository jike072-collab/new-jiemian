import { type NextRequest, NextResponse } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  requireAuthSession,
  requireCsrf,
  readJsonBody,
} from "../auth";
import { InMemoryRateLimiter } from "../auth/rate-limit";
import { getPromptOptimizeService } from "./optimizer";

const limiter = new InMemoryRateLimiter(
  Number(process.env.PROMPT_OPTIMIZER_RATE_LIMIT || 20),
  60_000,
);

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

  const result = await getPromptOptimizeService().optimize(await readJsonBody(request), {
    localUserId: session.user.local_user_id,
    requestId: context.requestId,
  });

  if (!result.ok) {
    return failureResponse(result);
  }

  return NextResponse.json({
    optimizedPrompt: result.optimizedPrompt,
  });
}
