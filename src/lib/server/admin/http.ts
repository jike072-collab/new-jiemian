import { type NextRequest, NextResponse } from "next/server";

import { authRequestContext, csrfFailure, readJsonBody, requireCsrf, sessionTokenFromRequest } from "../auth";
import { getAdminService, type AdminActor, type AdminFailure } from "./service";

type AdminHandler = (actor: AdminActor) => Promise<{ ok: true; status: number } & Record<string, unknown> | AdminFailure>;

function json(result: ({ ok: true; status: number } & Record<string, unknown>) | AdminFailure) {
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      code: result.code,
      message: result.message,
    }, { status: result.status });
  }
  const { status, ...body } = result;
  return NextResponse.json(body, { status });
}

export async function adminResponse(request: NextRequest, handler: AdminHandler) {
  const context = authRequestContext(request);
  const admin = await getAdminService().requireAdmin(sessionTokenFromRequest(request), context);
  if (!admin.ok) return json(admin);
  try {
    return json(await handler(admin.actor));
  } catch {
    return json({
      ok: false,
      status: 503,
      code: "admin_upstream_unavailable",
      message: "Admin request is unavailable.",
    });
  }
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || "");
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function adminListUsersResponse(request: NextRequest) {
  const url = new URL(request.url);
  return adminResponse(request, (actor) => getAdminService().listUsers(actor, {
    status: url.searchParams.get("status") || undefined,
    role: url.searchParams.get("role") || undefined,
    query: url.searchParams.get("query") || undefined,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1000000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100),
  }, authRequestContext(request)));
}

export function adminGetUserResponse(request: NextRequest, localUserId: string) {
  return adminResponse(request, (actor) => getAdminService().getUser(actor, localUserId, authRequestContext(request)));
}

export async function adminUpdateUserStatusResponse(request: NextRequest, localUserId: string) {
  if (!requireCsrf(request)) return json(csrfFailureForAdmin());
  const body = await readJsonBody(request);
  return adminResponse(request, (actor) => getAdminService().updateUserStatus(
    actor,
    localUserId,
    String(body.status || ""),
    String(body.reason || ""),
    authRequestContext(request),
  ));
}

export function adminListMappingsResponse(request: NextRequest) {
  const url = new URL(request.url);
  return adminResponse(request, (actor) => getAdminService().listMappings(actor, {
    status: url.searchParams.get("status") || undefined,
    localUserId: url.searchParams.get("localUserId") || url.searchParams.get("local_user_id") || undefined,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1000000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100),
  }, authRequestContext(request)));
}

export async function adminRepairMappingResponse(request: NextRequest, localUserId: string) {
  if (!requireCsrf(request)) return json(csrfFailureForAdmin());
  const body = await readJsonBody(request);
  return adminResponse(request, (actor) => getAdminService().repairMapping(
    actor,
    localUserId,
    String(body.action || ""),
    String(body.reason || ""),
    authRequestContext(request),
  ));
}

export async function adminAdjustQuotaResponse(request: NextRequest, localUserId: string) {
  if (!requireCsrf(request)) return json(csrfFailureForAdmin());
  const body = await readJsonBody(request);
  return adminResponse(request, (actor) => getAdminService().adjustQuota(
    actor,
    {
      localUserId,
      quotaDelta: Number(body.quotaDelta ?? body.quota_delta),
      idempotencyKey: String(body.idempotencyKey || body.idempotency_key || ""),
      reason: String(body.reason || ""),
    },
    authRequestContext(request),
  ));
}

export function adminListOrdersResponse(request: NextRequest) {
  const url = new URL(request.url);
  return adminResponse(request, (actor) => getAdminService().listOrders(actor, {
    localUserId: url.searchParams.get("localUserId") || url.searchParams.get("local_user_id") || undefined,
    status: url.searchParams.get("status") || undefined,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1000000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100),
  }, authRequestContext(request)));
}

export function adminGetOrderResponse(request: NextRequest, orderId: string) {
  return adminResponse(request, (actor) => getAdminService().getOrder(actor, orderId, authRequestContext(request)));
}

export async function adminReviewOrderResponse(request: NextRequest, orderId: string) {
  if (!requireCsrf(request)) return json(csrfFailureForAdmin());
  const body = await readJsonBody(request);
  return adminResponse(request, (actor) => getAdminService().reviewOrder(
    actor,
    orderId,
    String(body.status || ""),
    String(body.reason || ""),
    authRequestContext(request),
  ));
}

export function adminListTaskBillingRecordsResponse(request: NextRequest) {
  const url = new URL(request.url);
  return adminResponse(request, (actor) => getAdminService().listTaskBillingRecords(actor, {
    localUserId: url.searchParams.get("localUserId") || url.searchParams.get("local_user_id") || undefined,
    state: url.searchParams.get("state") || undefined,
    taskId: url.searchParams.get("taskId") || url.searchParams.get("task_id") || undefined,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1000000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100),
  }, authRequestContext(request)));
}

function csrfFailureForAdmin(): AdminFailure {
  const failure = csrfFailure();
  return {
    ok: false,
    status: failure.status,
    code: "admin_permission_denied",
    message: "CSRF token is required.",
  };
}
