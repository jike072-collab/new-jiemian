import { type NextRequest, NextResponse } from "next/server";

import { authRequestContext, requireAuthSession, readJsonBody } from "../auth";
import { getTaskBillingService } from "./task-billing-service";
import { getQuotaService } from "./service";
import { type BillableOperation, type QuotaErrorCode } from "./types";

const billableOperations = new Set<BillableOperation>([
  "cloud_image_generation",
  "cloud_video_generation",
  "cloud_image_upscale",
  "cloud_video_upscale",
]);

function quotaErrorResponse(input: {
  code: QuotaErrorCode | string;
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

function invalidQuotaRequest() {
  return quotaErrorResponse({
    code: "invalid_quota_request",
    status: 400,
    message: "Quota request is invalid.",
  });
}

function parseBillableOperation(value: unknown): BillableOperation | null {
  return typeof value === "string" && billableOperations.has(value as BillableOperation)
    ? value as BillableOperation
    : null;
}

async function requireLocalUser(request: NextRequest) {
  const session = await requireAuthSession(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({
        ok: false,
        code: "permission_denied",
        message: "Permission denied.",
      }, { status: session.status }),
    };
  }
  return { ok: true as const, localUserId: session.user.local_user_id };
}

export async function quotaSnapshotResponse(request: NextRequest) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const result = await getQuotaService().getCurrentQuota(auth.localUserId, { allowCached: true });
  if (!result.ok) return quotaErrorResponse(result);
  return NextResponse.json({ ok: true, quota: result.snapshot });
}

export async function usagePageResponse(request: NextRequest) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("pageSize") || 20);
  const source = url.searchParams.get("source") || "local";
  const quota = getQuotaService();
  const result = source === "upstream"
    ? await quota.listUpstreamUsage(auth.localUserId, page, pageSize)
    : await quota.listLocalUsage(auth.localUserId, page, pageSize);
  if ("ok" in result && result.ok === false) return quotaErrorResponse(result);
  return NextResponse.json({ ok: true, usage: result });
}

export async function precheckResponse(request: NextRequest) {
  const auth = await requireLocalUser(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  const operation = parseBillableOperation(body.operation);
  const taskId = String(body.taskId || "").trim();
  const idempotencyKey = String(body.idempotencyKey || body.taskId || "").trim();
  if (!operation || !taskId || !idempotencyKey) return invalidQuotaRequest();

  const result = await getTaskBillingService().precheck({
    localUserId: auth.localUserId,
    estimatedQuotaUnits: Number(body.estimatedQuotaUnits),
    operation,
    taskId,
    idempotencyKey,
    requestFingerprint: String(body.requestFingerprint || "").trim() || null,
  });
  if (!result.ok) return quotaErrorResponse(result);
  const quota = await getQuotaService().getCurrentQuota(auth.localUserId, { allowCached: true });
  return NextResponse.json({
    ok: true,
    quota: quota.ok ? quota.snapshot : null,
    estimatedQuotaUnits: result.record.estimated_quota_units,
    taskBilling: result.record,
    usage: result.usage,
  });
}

export function readonlyAdminQuotaQueryResponse(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    contract: "B10 admin quota queries are read-only, must use a project admin session, and must never expose New API admin credentials.",
    context: authRequestContext(request).requestId || null,
  });
}
