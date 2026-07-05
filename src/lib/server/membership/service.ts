import {
  addMembershipDuration,
  getMembershipPlan,
  getMembershipSku,
  membershipPlans,
  type MembershipEntitlementKind,
} from "./plans";
import { createMembershipPersistenceRepository } from "./persistence";
import type { MembershipRepository } from "./repository";
import type { MembershipStatusSnapshot, UserMembership } from "./types";

export type MembershipGrantInput = {
  localUserId: string;
  orderId: string;
  planId: string | null;
  cycle: string | null;
  now?: Date;
};

export type MembershipConsumeInput = {
  localUserId: string;
  kind: MembershipEntitlementKind;
  amount: number;
  idempotencyKey: string;
  taskId?: string | null;
  now?: Date;
};

export type MembershipServiceDependencies = {
  repository?: MembershipRepository;
  now?: () => Date;
};

const emptyEntitlements: MembershipStatusSnapshot["entitlements"] = {
  prompt_optimize: { remaining: 0, granted: 0, used: 0 },
  image_generation: { remaining: 0, granted: 0, used: 0 },
  video_generation: { remaining: 0, granted: 0, used: 0 },
};

function nowIso(now: Date) {
  return now.toISOString();
}

function byActiveRankAt(now: string) {
  return (record: UserMembership) => record.status === "active" && record.starts_at <= now && record.ends_at > now;
}

function byQueued(record: UserMembership) {
  return record.status === "queued";
}

function compareStarts(a: UserMembership, b: UserMembership) {
  return a.starts_at.localeCompare(b.starts_at);
}

function compareEndsDesc(a: UserMembership, b: UserMembership) {
  return b.ends_at.localeCompare(a.ends_at);
}

function addEntitlements(
  target: MembershipStatusSnapshot["entitlements"],
  kind: MembershipEntitlementKind,
  grant: { remaining: number; granted: number; used: number },
) {
  target[kind] = {
    remaining: target[kind].remaining + grant.remaining,
    granted: target[kind].granted + grant.granted,
    used: target[kind].used + grant.used,
  };
}

function cloneEmptyEntitlements() {
  return {
    prompt_optimize: { ...emptyEntitlements.prompt_optimize },
    image_generation: { ...emptyEntitlements.image_generation },
    video_generation: { ...emptyEntitlements.video_generation },
  };
}

export class MembershipService {
  private readonly repository: MembershipRepository;
  private readonly now: () => Date;

  constructor(dependencies: MembershipServiceDependencies = {}) {
    this.repository = dependencies.repository || createMembershipPersistenceRepository();
    this.now = dependencies.now || (() => new Date());
  }

  listPlans() {
    return membershipPlans.map((plan) => ({ ...plan, prices: { ...plan.prices }, monthly_entitlements: { ...plan.monthly_entitlements } }));
  }

  getSku(planId: string | null | undefined, cycle: unknown) {
    return getMembershipSku(planId, cycle);
  }

  async getStatus(localUserId: string, at: Date = this.now()): Promise<MembershipStatusSnapshot> {
    const timestamp = nowIso(at);
    await this.refreshExpired(localUserId, at);
    const memberships = await this.repository.listMemberships(localUserId);
    const active = memberships
      .filter(byActiveRankAt(timestamp))
      .sort((a, b) => (getMembershipPlan(b.plan_id)?.rank || 0) - (getMembershipPlan(a.plan_id)?.rank || 0) || compareEndsDesc(a, b))[0] || null;
    const queued = memberships.filter(byQueued).sort(compareStarts)[0] || null;
    const entitlements = cloneEmptyEntitlements();
    for (const grant of await this.repository.listEntitlements(localUserId, timestamp)) {
      addEntitlements(entitlements, grant.kind, {
        remaining: grant.remaining,
        granted: grant.granted,
        used: grant.used,
      });
    }
    return {
      active,
      queued,
      recharge_bonus_basis_points: active ? getMembershipPlan(active.plan_id)?.recharge_bonus_basis_points || 0 : 0,
      entitlements,
    };
  }

  async applyPaidMembership(input: MembershipGrantInput) {
    const now = input.now || this.now();
    const timestamp = nowIso(now);
    const existing = await this.repository.getMembershipByOrder(input.orderId);
    if (existing) return existing;
    const sku = getMembershipSku(input.planId, input.cycle);
    if (!sku) throw new Error("Invalid membership SKU.");
    await this.refreshExpired(input.localUserId, now);
    const memberships = await this.repository.listMemberships(input.localUserId);
    const active = memberships
      .filter(byActiveRankAt(timestamp))
      .sort((a, b) => (getMembershipPlan(b.plan_id)?.rank || 0) - (getMembershipPlan(a.plan_id)?.rank || 0) || compareEndsDesc(a, b))[0] || null;
    const activePlan = active ? getMembershipPlan(active.plan_id) : null;
    const startsAt = this.membershipStartTime(active, memberships, activePlan?.rank || 0, sku.plan.rank, now);
    const endsAt = addMembershipDuration(startsAt, sku.cycle);
    const status = startsAt.getTime() <= now.getTime() ? "active" : "queued";
    const record = await this.repository.createMembership({
      localUserId: input.localUserId,
      planId: sku.plan.id,
      cycle: sku.cycle,
      status,
      startsAt: nowIso(startsAt),
      endsAt: nowIso(endsAt),
      sourceOrderId: input.orderId,
      now: timestamp,
    });
    if (status === "active" && active && active.id !== record.id && sku.plan.rank > (activePlan?.rank || 0)) {
      await this.repository.updateMembership(active.id, {
        status: "cancelled",
        cancelled_at: timestamp,
        updated_at: timestamp,
      }, active.version);
    }
    await this.grantMembershipEntitlements(input.localUserId, input.orderId, sku.grant_entitlements, record.ends_at, timestamp);
    return record;
  }

  async cancelByOrder(orderId: string, at: Date = this.now()) {
    const record = await this.repository.getMembershipByOrder(orderId);
    if (!record || record.status === "cancelled") return record;
    return this.repository.updateMembership(record.id, {
      status: "cancelled",
      cancelled_at: nowIso(at),
      updated_at: nowIso(at),
    }, record.version);
  }

  async consumeEntitlement(input: MembershipConsumeInput) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) return { consumed: 0 };
    const now = input.now || this.now();
    const status = await this.getStatus(input.localUserId, now);
    if (!status.active) return { consumed: 0 };
    const result = await this.repository.consumeEntitlement({
      localUserId: input.localUserId,
      kind: input.kind,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      taskId: input.taskId || null,
      now: nowIso(now),
    });
    return { consumed: result.consumed };
  }

  async consumedForTask(localUserId: string, taskId: string) {
    const keys = [
      `membership:image_generation:${taskId}`,
      `membership:video_generation:${taskId}`,
      `membership:prompt_optimize:${taskId}`,
    ];
    for (const key of keys) {
      const ledger = await this.repository.getLedgerByIdempotencyKey(localUserId, key);
      if (ledger && ledger.delta < 0) return Math.abs(ledger.delta);
    }
    return 0;
  }

  private membershipStartTime(
    active: UserMembership | null,
    memberships: UserMembership[],
    activeRank: number,
    nextRank: number,
    now: Date,
  ) {
    if (!active || nextRank > activeRank) return now;
    const queuedEnd = memberships
      .filter(byQueued)
      .reduce((latest, record) => Math.max(latest, Date.parse(record.ends_at)), 0);
    return new Date(Math.max(now.getTime(), Date.parse(active.ends_at), queuedEnd));
  }

  private async grantMembershipEntitlements(
    localUserId: string,
    orderId: string,
    entitlements: Record<MembershipEntitlementKind, number>,
    expiresAt: string,
    timestamp: string,
  ) {
    for (const [kind, amount] of Object.entries(entitlements) as Array<[MembershipEntitlementKind, number]>) {
      if (amount <= 0) continue;
      await this.repository.grantEntitlement({
        localUserId,
        kind,
        amount,
        sourceOrderId: orderId,
        expiresAt,
        idempotencyKey: `membership-grant:${orderId}:${kind}`,
        now: timestamp,
      });
    }
  }

  private async refreshExpired(localUserId: string, at: Date) {
    const timestamp = nowIso(at);
    const memberships = await this.repository.listMemberships(localUserId);
    for (const record of memberships) {
      if (record.status === "active" && record.ends_at <= timestamp) {
        await this.repository.updateMembership(record.id, {
          status: "expired",
          updated_at: timestamp,
        }, record.version);
      }
    }
    const refreshed = await this.repository.listMemberships(localUserId);
    const hasActive = refreshed.some(byActiveRankAt(timestamp));
    if (hasActive) return;
    const next = refreshed
      .filter((record) => record.status === "queued" && record.starts_at <= timestamp && record.ends_at > timestamp)
      .sort(compareStarts)[0];
    if (next) {
      await this.repository.updateMembership(next.id, {
        status: "active",
        updated_at: timestamp,
      }, next.version);
    }
  }
}

let singleton: MembershipService | null = null;

export function getMembershipService() {
  if (!singleton) singleton = new MembershipService();
  return singleton;
}

export function resetMembershipServiceForTests() {
  singleton = null;
}
