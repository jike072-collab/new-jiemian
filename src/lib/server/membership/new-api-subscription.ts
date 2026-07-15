import { createAuthPersistenceRepositories } from "../auth/persistence";
import { NewApiHttpClient, newApiAdminRequestContext } from "../integrations/new-api/client";
import type { MembershipCycle, MembershipEntitlementKind, MembershipPlanId } from "./plans";
import { createEmptyMembershipEntitlements, getMembershipPlan, getMembershipSku } from "./plans";
import type { MembershipStatusSnapshot, UserMembership } from "./types";

type NewApiSubscriptionRecord = Record<string, unknown>;

type NewApiSubscriptionPayload = {
  data?: unknown;
  subscriptions?: unknown;
  items?: unknown;
  rows?: unknown;
  records?: unknown;
};

const farFuture = "2099-12-31T23:59:59.000Z";

function normalizeRecord(value: unknown): NewApiSubscriptionRecord | null {
  if (!isRecord(value)) return null;
  const subscription = value.subscription;
  if (!isRecord(subscription)) return value;
  const plan = isRecord(value.plan) ? value.plan : isRecord(subscription.plan) ? subscription.plan : undefined;
  return {
    ...subscription,
    ...(plan ? { plan } : {}),
  };
}

function recordsFromPayload(payload: NewApiSubscriptionPayload) {
  const candidates = [
    payload.data,
    payload.subscriptions,
    payload.items,
    payload.rows,
    payload.records,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.map(normalizeRecord).filter((record): record is NewApiSubscriptionRecord => Boolean(record));
    if (isRecord(value)) {
      for (const key of ["items", "subscriptions", "rows", "records", "list"]) {
        const nested = value[key];
        if (Array.isArray(nested)) return nested.map(normalizeRecord).filter((record): record is NewApiSubscriptionRecord => Boolean(record));
      }
    }
  }
  return [];
}

function isRecord(value: unknown): value is NewApiSubscriptionRecord {
  return typeof value === "object" && value !== null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalized(value: unknown) {
  return text(value).toLowerCase();
}

function firstText(record: NewApiSubscriptionRecord, keys: string[]) {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function dateText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const raw = text(value);
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.length >= 10) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function firstDate(record: NewApiSubscriptionRecord, keys: string[]) {
  for (const key of keys) {
    const value = dateText(record[key]);
    if (value) return value;
  }
  return "";
}

function subscriptionPlanText(record: NewApiSubscriptionRecord) {
  const directName = firstText(record, [
    "plan_name",
    "planName",
    "name",
    "title",
  ]);
  if (directName) return directName;
  const plan = record.plan;
  if (isRecord(plan)) {
    const planName = firstText(plan, ["name", "title", "subtitle", "key"]);
    if (planName) return planName;
  }
  const directId = firstText(record, [
    "plan_id",
    "planId",
    "product_plan_id",
    "productPlanId",
  ]);
  if (directId) return directId;
  return "";
}

function planIdFromSubscription(record: NewApiSubscriptionRecord): MembershipPlanId | null {
  const value = [
    subscriptionPlanText(record),
    firstText(record, ["plan_id", "planId", "product_plan_id", "productPlanId"]),
  ].join(" ");
  const lower = value.toLowerCase();
  if (lower.includes("enterprise") || lower.includes("svip") || lower.includes("team") || value.includes("企业") || value.includes("旗舰") || value.includes("至尊")) return "enterprise";
  if (lower.includes("advanced") || lower.includes("plus") || lower.includes("standard") || value.includes("进阶") || value.includes("高级")) return "advanced";
  if (lower.includes("basic") || value.includes("基础") || value.includes("入门") || value.includes("普通")) return "basic";
  if (lower.includes("pro") || lower.includes("vip") || lower.includes("professional") || value.includes("专业")) return "pro";
  return null;
}

function cycleFromSubscription(record: NewApiSubscriptionRecord): MembershipCycle {
  const value = firstText(record, ["cycle", "period", "interval", "duration", "type"]) || subscriptionPlanText(record);
  const lower = value.toLowerCase();
  if (lower.includes("year") || lower.includes("annual") || value.includes("年")) return "yearly";
  if (lower.includes("quarter") || lower.includes("season") || value.includes("季")) return "quarterly";
  const durationUnit = normalized(record.duration_unit);
  const durationValue = Number(firstText(record, ["duration_value", "durationValue"]));
  if (durationUnit === "year") return "yearly";
  if (durationUnit === "month" && durationValue >= 12) return "yearly";
  if (durationUnit === "month" && durationValue >= 3) return "quarterly";
  if (durationUnit === "day" && durationValue >= 360) return "yearly";
  if (durationUnit === "day" && durationValue >= 80) return "quarterly";
  return "monthly";
}

function enrichSubscriptionsWithPlans(
  subscriptions: NewApiSubscriptionRecord[],
  plans: NewApiSubscriptionRecord[],
) {
  const planMap = new Map<string, NewApiSubscriptionRecord>();
  for (const record of plans) {
    const plan = isRecord(record.plan) ? record.plan : record;
    const id = firstText(plan, ["id", "plan_id", "planId"]);
    if (id) planMap.set(id, plan);
  }
  return subscriptions.map((record) => {
    const planId = firstText(record, ["plan_id", "planId", "product_plan_id", "productPlanId"]);
    const plan = planMap.get(planId);
    if (!plan) return record;
    return {
      ...plan,
      ...record,
      plan,
      plan_name: firstText(plan, ["title", "name", "subtitle"]),
    };
  });
}

function isActiveSubscription(record: NewApiSubscriptionRecord, nowIso: string) {
  const status = normalized(record.status ?? record.state);
  if (["cancelled", "canceled", "expired", "disabled", "failed", "inactive", "0"].includes(status)) return false;
  const endsAt = firstDate(record, ["ends_at", "end_at", "expired_at", "expires_at", "expire_time", "end_time", "valid_until"]);
  if (endsAt && endsAt <= nowIso) return false;
  return !status || ["active", "valid", "enabled", "paid", "success", "1"].includes(status);
}

function membershipFromSubscription(
  localUserId: string,
  record: NewApiSubscriptionRecord,
  nowIso: string,
): UserMembership | null {
  const planId = planIdFromSubscription(record);
  const plan = planId ? getMembershipPlan(planId) : null;
  if (!plan) return null;
  const startsAt = firstDate(record, ["starts_at", "start_at", "created_at", "start_time"]) || nowIso;
  const endsAt = firstDate(record, ["ends_at", "end_at", "expired_at", "expires_at", "expire_time", "end_time", "valid_until"]) || farFuture;
  return {
    id: `new-api-subscription:${text(record.id) || text(record.subscription_id) || plan.id}`,
    local_user_id: localUserId,
    plan_id: plan.id,
    cycle: cycleFromSubscription(record),
    status: startsAt <= nowIso ? "active" : "queued",
    starts_at: startsAt,
    ends_at: endsAt,
    source_order_id: `new-api-subscription:${text(record.id) || text(record.subscription_id) || plan.id}`,
    created_at: startsAt,
    updated_at: nowIso,
    cancelled_at: null,
    version: 1,
  };
}

export async function getNewApiSubscriptionMembershipStatus(
  localUserId: string,
  now: Date,
): Promise<MembershipStatusSnapshot | null> {
  const mappingRepository = createAuthPersistenceRepositories().mappingRepository;
  const mapping = await mappingRepository.getByLocalUserId(localUserId);
  if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) return null;

  const client = new NewApiHttpClient();
  const context = newApiAdminRequestContext(client.config);
  const [response, plansResponse] = await Promise.all([
    client.request<NewApiSubscriptionPayload>({
      path: `/api/subscription/admin/users/${encodeURIComponent(mapping.new_api_user_id)}/subscriptions`,
      context,
    }),
    client.request<NewApiSubscriptionPayload>({
      path: "/api/subscription/admin/plans",
      context,
    }),
  ]);
  const nowIso = now.toISOString();
  const memberships = enrichSubscriptionsWithPlans(
    recordsFromPayload(response.data),
    recordsFromPayload(plansResponse.data),
  )
    .filter((record) => isActiveSubscription(record, nowIso))
    .map((record) => membershipFromSubscription(localUserId, record, nowIso))
    .filter((record): record is UserMembership => Boolean(record));
  const active = memberships
    .filter((record) => record.status === "active")
    .sort((a, b) => (getMembershipPlan(b.plan_id)?.rank || 0) - (getMembershipPlan(a.plan_id)?.rank || 0) || b.ends_at.localeCompare(a.ends_at))[0] || null;
  const queued = memberships
    .filter((record) => record.status === "queued")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;
  if (!active && !queued) return null;
  const plan = active ? getMembershipPlan(active.plan_id) : null;
  const sku = active ? getMembershipSku(active.plan_id, active.cycle) : null;
  const grantEntitlements = createEmptyMembershipEntitlements();
  if (sku) {
    for (const kind of Object.keys(grantEntitlements) as MembershipEntitlementKind[]) {
      grantEntitlements[kind] = sku.grant_entitlements[kind];
    }
  }
  return {
    active,
    queued,
    recharge_bonus_basis_points: plan?.recharge_bonus_basis_points || 0,
    first_purchase_reward_claimed: false,
    entitlements: {
      prompt_optimize: { remaining: grantEntitlements.prompt_optimize, granted: grantEntitlements.prompt_optimize, used: 0 },
      image_generation: { remaining: grantEntitlements.image_generation, granted: grantEntitlements.image_generation, used: 0 },
      video_generation: { remaining: grantEntitlements.video_generation, granted: grantEntitlements.video_generation, used: 0 },
      image_edit: { remaining: grantEntitlements.image_edit, granted: grantEntitlements.image_edit, used: 0 },
      image_upscale: { remaining: grantEntitlements.image_upscale, granted: grantEntitlements.image_upscale, used: 0 },
      video_upscale: { remaining: grantEntitlements.video_upscale, granted: grantEntitlements.video_upscale, used: 0 },
    },
  };
}
