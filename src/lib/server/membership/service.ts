import { randomUUID } from "node:crypto";

import {
  createEmptyMembershipEntitlements,
  addMembershipDuration,
  getMembershipFirstPurchaseReward,
  getMembershipPlan,
  getMembershipSku,
  membershipPlans,
  type MembershipEntitlementKind,
} from "./plans";
import { createMembershipPersistenceRepository } from "./persistence";
import type { MembershipRepository } from "./repository";
import type { MembershipStatusSnapshot, UserMembership } from "./types";
import { getNewApiSubscriptionMembershipStatus } from "./new-api-subscription";
import { getBillingService } from "../billing/service";

export type MembershipGrantInput = {
  localUserId: string;
  orderId: string;
  planId: string | null;
  cycle: string | null;
  now?: Date;
};

export type ManualMembershipGrantInput = MembershipGrantInput;

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
  externalStatus?: (localUserId: string, at: Date) => Promise<MembershipStatusSnapshot | null>;
  externalMembershipFulfillment?: (input: {
    localUserId: string;
    sourceOrderId: string;
    planId: string;
    cycle: string;
    startsAt: string;
  }) => Promise<void>;
  now?: () => Date;
};

const emptyEntitlements: MembershipStatusSnapshot["entitlements"] = {
  prompt_optimize: { remaining: 0, granted: 0, used: 0 },
  image_generation: { remaining: 0, granted: 0, used: 0 },
  video_generation: { remaining: 0, granted: 0, used: 0 },
  image_edit: { remaining: 0, granted: 0, used: 0 },
  image_upscale: { remaining: 0, granted: 0, used: 0 },
  video_upscale: { remaining: 0, granted: 0, used: 0 },
};

const externalStatusRefreshMs = 30_000;

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
  const next = createEmptyMembershipEntitlements();
  return Object.fromEntries(
    Object.entries(next).map(([kind]) => [kind, { ...emptyEntitlements[kind as MembershipEntitlementKind] }]),
  ) as MembershipStatusSnapshot["entitlements"];
}

export class MembershipService {
  private readonly repository: MembershipRepository;
  private readonly externalStatus: (localUserId: string, at: Date) => Promise<MembershipStatusSnapshot | null>;
  private readonly externalMembershipFulfillment: NonNullable<MembershipServiceDependencies["externalMembershipFulfillment"]>;
  private readonly now: () => Date;
  private readonly externalStatusCheckedAt = new Map<string, number>();

  constructor(dependencies: MembershipServiceDependencies = {}) {
    this.repository = dependencies.repository || createMembershipPersistenceRepository();
    this.externalStatus = dependencies.externalStatus || getNewApiSubscriptionMembershipStatus;
    this.externalMembershipFulfillment = dependencies.externalMembershipFulfillment || (async (input) => {
      const result = await getBillingService().fulfillExternalMembership(input);
      if (!result.ok || result.action === "review") {
        throw new Error(result.ok ? "External membership credit requires reconciliation." : result.message);
      }
    });
    this.now = dependencies.now || (() => new Date());
  }

  listPlans() {
    return membershipPlans.map((plan) => ({ ...plan, prices: { ...plan.prices }, monthly_entitlements: { ...plan.monthly_entitlements } }));
  }

  getSku(planId: string | null | undefined, cycle: unknown) {
    return getMembershipSku(planId, cycle);
  }

  private async mirrorExternalStatus(localUserId: string, status: MembershipStatusSnapshot, now: Date) {
    const desiredMemberships = [status.active, status.queued]
      .filter((membership): membership is UserMembership => Boolean(membership))
      .filter((membership, index, records) => records.findIndex((record) => record.source_order_id === membership.source_order_id) === index);
    if (!desiredMemberships.length) return false;
    try {
      const timestamp = nowIso(now);
      const memberships = await this.repository.listMemberships(localUserId);
      for (const desired of desiredMemberships) {
        const existing = await this.repository.getMembershipByOrder(desired.source_order_id);
        const extended = Boolean(existing && desired.ends_at > existing.ends_at);
        const sku = getMembershipSku(desired.plan_id, desired.cycle);
        const desiredEntitlements = desired.source_order_id === status.active?.source_order_id
          ? status.entitlements
          : sku
            ? Object.fromEntries(Object.entries(sku.grant_entitlements).map(([kind, amount]) => [kind, { remaining: amount, granted: amount, used: 0 }])) as MembershipStatusSnapshot["entitlements"]
            : emptyEntitlements;
        const grantDesiredEntitlements = async () => {
          for (const [kind, grant] of Object.entries(desiredEntitlements) as Array<[MembershipEntitlementKind, { remaining: number; granted: number; used: number }]>) {
            if (grant.granted <= 0) continue;
            await this.repository.grantEntitlement({
              localUserId,
              kind,
              amount: grant.granted,
              sourceOrderId: desired.source_order_id,
              expiresAt: desired.ends_at,
              idempotencyKey: extended
                ? `new-api-renewal:${desired.source_order_id}:${desired.ends_at}:${kind}`
                : `new-api-mirror:${desired.source_order_id}:${kind}`,
              now: timestamp,
            });
          }
        };
        if (extended) await grantDesiredEntitlements();
        if (!existing) {
          await this.repository.createMembership({
            localUserId,
            planId: desired.plan_id,
            cycle: desired.cycle,
            status: desired.status,
            startsAt: desired.starts_at,
            endsAt: desired.ends_at,
            sourceOrderId: desired.source_order_id,
            now: timestamp,
          });
        } else if (existing.status !== desired.status || existing.starts_at !== desired.starts_at || existing.ends_at !== desired.ends_at) {
          await this.repository.updateMembership(existing.id, {
            status: desired.status,
            starts_at: desired.starts_at,
            ends_at: desired.ends_at,
            cancelled_at: null,
            updated_at: timestamp,
          }, existing.version);
        }
        if (!extended) await grantDesiredEntitlements();
      }
      const desiredOrderIds = new Set(desiredMemberships.map((membership) => membership.source_order_id));
      const replaced = memberships.filter((membership) => (
        membership.source_order_id.startsWith("new-api-subscription:")
        && !desiredOrderIds.has(membership.source_order_id)
        && (membership.status === "active" || membership.status === "queued")
      ));
      for (const membership of replaced) {
        await this.repository.updateMembership(membership.id, {
          status: "cancelled",
          cancelled_at: timestamp,
          updated_at: timestamp,
        }, membership.version);
      }
      await this.repository.expireEntitlementsBySourceOrder(
        localUserId,
        replaced.map((membership) => membership.source_order_id),
        timestamp,
      );
      if (status.active) await this.ensureExternalMembershipFulfillment(status.active);
      return true;
    } catch {
      return false;
    }
  }

  private async retireExternalMemberships(localUserId: string, memberships: UserMembership[], now: Date) {
    const timestamp = nowIso(now);
    const activeExternal = memberships.filter((membership) => (
      membership.source_order_id.startsWith("new-api-subscription:")
      && (membership.status === "active" || membership.status === "queued")
    ));
    if (!activeExternal.length) return false;
    for (const membership of activeExternal) {
      await this.repository.updateMembership(membership.id, {
        status: "cancelled",
        cancelled_at: timestamp,
        updated_at: timestamp,
      }, membership.version);
    }
    await this.repository.expireEntitlementsBySourceOrder(
      localUserId,
      activeExternal.map((membership) => membership.source_order_id),
      timestamp,
    );
    return true;
  }

  private async ensureExternalMembershipFulfillment(active: UserMembership) {
    if (!active.source_order_id.startsWith("new-api-subscription:")) return;
    await this.externalMembershipFulfillment({
      localUserId: active.local_user_id,
      sourceOrderId: active.source_order_id,
      planId: active.plan_id,
      cycle: active.cycle,
      startsAt: active.starts_at,
    });
  }

  private externalStatusDiffers(
    memberships: UserMembership[],
    status: MembershipStatusSnapshot,
  ) {
    const local = memberships
      .filter((membership) => membership.source_order_id.startsWith("new-api-subscription:"))
      .filter((membership) => membership.status === "active" || membership.status === "queued");
    const external = [status.active, status.queued]
      .filter((membership): membership is UserMembership => Boolean(membership))
      .filter((membership, index, records) => records.findIndex((record) => record.source_order_id === membership.source_order_id) === index);
    if (local.length !== external.length) return true;
    return external.some((expected) => {
      const current = local.find((membership) => membership.source_order_id === expected.source_order_id);
      return !current
        || current.status !== expected.status
        || current.plan_id !== expected.plan_id
        || current.cycle !== expected.cycle
        || current.starts_at !== expected.starts_at
        || current.ends_at !== expected.ends_at;
    });
  }

  private async backfillMissingEntitlements(active: UserMembership, timestamp: string) {
    const sku = getMembershipSku(active.plan_id, active.cycle);
    if (!sku) return;
    for (const [kind, amount] of Object.entries(sku.grant_entitlements) as Array<[MembershipEntitlementKind, number]>) {
      if (amount <= 0) continue;
      const existing = await this.repository.getEntitlementBySourceOrderAndKind(
        active.local_user_id,
        active.source_order_id,
        kind,
      );
      if (existing) continue;
      await this.repository.grantEntitlement({
        localUserId: active.local_user_id,
        kind,
        amount,
        sourceOrderId: active.source_order_id,
        expiresAt: active.ends_at,
        idempotencyKey: `membership-backfill-v2:${active.source_order_id}:${kind}`,
        now: timestamp,
      });
    }
  }

  async getStatus(localUserId: string, at: Date = this.now()): Promise<MembershipStatusSnapshot> {
    const timestamp = nowIso(at);
    await this.refreshExpired(localUserId, at);
    const memberships = await this.repository.listMemberships(localUserId);
    const active = memberships
      .filter(byActiveRankAt(timestamp))
      .sort((a, b) => (getMembershipPlan(b.plan_id)?.rank || 0) - (getMembershipPlan(a.plan_id)?.rank || 0) || compareEndsDesc(a, b))[0] || null;
    const queued = memberships.filter(byQueued).sort(compareStarts)[0] || null;
    const entitlementMemberships = [active, ...memberships.filter(byQueued)]
      .filter((membership): membership is UserMembership => Boolean(membership));
    for (const membership of entitlementMemberships) {
      await this.backfillMissingEntitlements(membership, timestamp).catch((error) => {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
        console.error("membership.entitlement_backfill_failed", {
          code,
          name: error instanceof Error ? error.name : "unknown",
        });
      });
    }
    const entitlements = cloneEmptyEntitlements();
    for (const grant of await this.repository.listEntitlements(localUserId, timestamp)) {
      addEntitlements(entitlements, grant.kind, {
        remaining: grant.remaining,
        granted: grant.granted,
        used: grant.used,
      });
    }
    const firstPurchaseReward = await this.repository.getFirstPurchaseReward(localUserId);
    const localStatus = {
      active,
      queued,
      recharge_bonus_basis_points: active ? getMembershipPlan(active.plan_id)?.recharge_bonus_basis_points || 0 : 0,
      first_purchase_reward_claimed: Boolean(firstPurchaseReward),
      entitlements,
    };
    if (active) {
      if (active.source_order_id.startsWith("new-api-subscription:")) {
        const lastCheckedAt = this.externalStatusCheckedAt.get(localUserId) || 0;
        if (at.getTime() - lastCheckedAt >= externalStatusRefreshMs) {
          this.externalStatusCheckedAt.set(localUserId, at.getTime());
          try {
            const external = await this.externalStatus(localUserId, at);
            if (!external) {
              if (await this.retireExternalMemberships(localUserId, memberships, at)) {
                return this.getStatus(localUserId, at);
              }
            } else if (this.externalStatusDiffers(memberships, external)) {
              if (await this.mirrorExternalStatus(localUserId, external, at)) {
                return this.getStatus(localUserId, at);
              }
            }
          } catch {
            // Keep the last valid local snapshot when NewAPI is temporarily unavailable.
          }
        }
      }
      await this.ensureExternalMembershipFulfillment(active).catch(() => undefined);
      return localStatus;
    }
    try {
      const external = await this.externalStatus(localUserId, at);
      this.externalStatusCheckedAt.set(localUserId, at.getTime());
      if (external) await this.mirrorExternalStatus(localUserId, external, at);
      return external || localStatus;
    } catch {
      return localStatus;
    }
  }

  async applyPaidMembership(input: MembershipGrantInput) {
    const now = input.now || this.now();
    const timestamp = nowIso(now);
    const existing = await this.repository.getMembershipByOrder(input.orderId);
    if (existing) return existing;
    const sku = getMembershipSku(input.planId, input.cycle);
    if (!sku) throw new Error("Invalid membership SKU.");
    const firstPurchaseReward = await this.claimFirstPurchaseReward(input);
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
    if (firstPurchaseReward.isOwner) {
      await this.grantMembershipEntitlements(
        input.localUserId,
        input.orderId,
        firstPurchaseReward.reward.bonus_entitlements,
        record.ends_at,
        timestamp,
        "membership-first-purchase-grant",
      );
    }
    return record;
  }

  async claimFirstPurchaseReward(input: MembershipGrantInput) {
    const sku = getMembershipSku(input.planId, input.cycle);
    const reward = getMembershipFirstPurchaseReward(input.planId, input.cycle);
    if (!sku || !reward) throw new Error("Invalid membership SKU.");
    const now = input.now || this.now();
    return this.repository.claimFirstPurchaseReward({
      localUserId: input.localUserId,
      sourceOrderId: input.orderId,
      planId: sku.plan.id,
      cycle: sku.cycle,
      bonusCredits: reward.bonus_credits,
      bonusEntitlements: reward.bonus_entitlements,
      now: nowIso(now),
    });
  }

  async applyManualMembership(input: ManualMembershipGrantInput) {
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

  createManualOrderId(localUserId: string, idempotencyKey: string) {
    return `admin-membership:${localUserId.trim()}:${idempotencyKey.trim() || randomUUID()}`;
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

  async restoreEntitlement(input: MembershipConsumeInput) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) return { restored: 0 };
    const now = input.now || this.now();
    const result = await this.repository.restoreEntitlement({
      localUserId: input.localUserId,
      kind: input.kind,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      taskId: input.taskId || null,
      now: nowIso(now),
    });
    return { restored: result.restored };
  }

  async consumedForTask(localUserId: string, taskId: string) {
    const keys = [
      `membership:image_generation:${taskId}`,
      `membership:video_generation:${taskId}`,
      `membership:image_edit:${taskId}`,
      `membership:image_upscale:${taskId}`,
      `membership:video_upscale:${taskId}`,
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
    idempotencyPrefix = "membership-grant",
  ) {
    for (const [kind, amount] of Object.entries(entitlements) as Array<[MembershipEntitlementKind, number]>) {
      if (amount <= 0) continue;
      await this.repository.grantEntitlement({
        localUserId,
        kind,
        amount,
        sourceOrderId: orderId,
        expiresAt,
        idempotencyKey: `${idempotencyPrefix}:${orderId}:${kind}`,
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
