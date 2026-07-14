import "server-only";

import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig, withApplicationTransaction } from "../database";
import type { MembershipEntitlementKind, MembershipCycle, MembershipPlanId } from "./plans";
import {
  MembershipRepositoryError,
  type ClaimFirstPurchaseRewardInput,
  type ConsumeEntitlementInput,
  type CreateMembershipInput,
  type GrantEntitlementInput,
  type MembershipPatch,
  type MembershipRepository,
  type RestoreEntitlementInput,
} from "./repository";
import type { MembershipEntitlementGrant, MembershipEntitlementLedger, MembershipFirstPurchaseRewardRecord, UserMembership, UserMembershipStatus } from "./types";

type MembershipRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  plan_id: MembershipPlanId;
  cycle: MembershipCycle;
  status: UserMembershipStatus;
  starts_at: Date | string;
  ends_at: Date | string;
  source_order_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  cancelled_at: Date | string | null;
  version: number;
};

type EntitlementRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  kind: MembershipEntitlementKind;
  granted: number;
  used: number;
  remaining: number;
  source_order_id: string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

type LedgerRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  kind: MembershipEntitlementKind;
  delta: number;
  idempotency_key: string;
  source_order_id: string | null;
  task_id: string | null;
  created_at: Date | string;
};

type FirstPurchaseRewardRow = QueryResultRow & {
  local_user_id: string;
  source_order_id: string;
  plan_id: MembershipPlanId;
  cycle: MembershipCycle;
  bonus_credits: number;
  bonus_entitlements: Record<MembershipEntitlementKind, number>;
  created_at: Date | string;
};

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function membershipFromRow(row: MembershipRow): UserMembership {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    plan_id: row.plan_id,
    cycle: row.cycle,
    status: row.status,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    source_order_id: row.source_order_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    cancelled_at: isoOrNull(row.cancelled_at),
    version: Number(row.version),
  };
}

function entitlementFromRow(row: EntitlementRow): MembershipEntitlementGrant {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    kind: row.kind,
    granted: Number(row.granted),
    used: Number(row.used),
    remaining: Number(row.remaining),
    source_order_id: row.source_order_id,
    expires_at: iso(row.expires_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    version: Number(row.version),
  };
}

function ledgerFromRow(row: LedgerRow): MembershipEntitlementLedger {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    kind: row.kind,
    delta: Number(row.delta),
    idempotency_key: row.idempotency_key,
    source_order_id: row.source_order_id,
    task_id: row.task_id,
    created_at: iso(row.created_at),
  };
}

function firstPurchaseRewardFromRow(row: FirstPurchaseRewardRow): MembershipFirstPurchaseRewardRecord {
  return {
    local_user_id: row.local_user_id,
    source_order_id: row.source_order_id,
    plan_id: row.plan_id,
    cycle: row.cycle,
    bonus_credits: Number(row.bonus_credits),
    bonus_entitlements: { ...row.bonus_entitlements },
    created_at: iso(row.created_at),
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

export class PostgresMembershipRepository implements MembershipRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async listMemberships(localUserId: string) {
    const result = await applicationQuery<MembershipRow>(`
      select * from user_memberships
      where local_user_id = $1
      order by starts_at asc, created_at asc
    `, [localUserId.trim()]);
    return result.rows.map(membershipFromRow);
  }

  async getMembershipByOrder(sourceOrderId: string) {
    const result = await applicationQuery<MembershipRow>(`
      select * from user_memberships
      where source_order_id = $1
      limit 1
    `, [sourceOrderId.trim()]);
    return result.rows[0] ? membershipFromRow(result.rows[0]) : null;
  }

  async getFirstPurchaseReward(localUserId: string) {
    const result = await applicationQuery<FirstPurchaseRewardRow>(`
      select * from membership_first_purchase_rewards
      where local_user_id = $1
      limit 1
    `, [localUserId.trim()]);
    return result.rows[0] ? firstPurchaseRewardFromRow(result.rows[0]) : null;
  }

  async claimFirstPurchaseReward(input: ClaimFirstPurchaseRewardInput) {
    const timestamp = input.now || new Date().toISOString();
    return withApplicationTransaction(async (client) => {
      const owner = input.localUserId.trim();
      const existing = await client.query<FirstPurchaseRewardRow>(`
        select * from membership_first_purchase_rewards
        where local_user_id = $1
        limit 1
      `, [owner]);
      if (existing.rows[0]) {
        const reward = firstPurchaseRewardFromRow(existing.rows[0]);
        return { reward, isOwner: reward.source_order_id === input.sourceOrderId.trim() };
      }
      const previous = await client.query<MembershipRow>(`
        select * from user_memberships
        where local_user_id = $1 and source_order_id not like 'admin-membership:%'
        order by created_at asc
        limit 1
      `, [owner]);
      const previousMembership = previous.rows[0] ? membershipFromRow(previous.rows[0]) : null;
      const values = previousMembership ? {
        sourceOrderId: previousMembership.source_order_id,
        planId: previousMembership.plan_id,
        cycle: previousMembership.cycle,
        bonusCredits: 0,
        bonusEntitlements: {},
        createdAt: previousMembership.created_at,
      } : {
        sourceOrderId: input.sourceOrderId.trim(),
        planId: input.planId,
        cycle: input.cycle,
        bonusCredits: input.bonusCredits,
        bonusEntitlements: input.bonusEntitlements,
        createdAt: timestamp,
      };
      const inserted = await client.query<FirstPurchaseRewardRow>(`
        insert into membership_first_purchase_rewards (
          local_user_id, source_order_id, plan_id, cycle, bonus_credits, bonus_entitlements, created_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict (local_user_id) do nothing
        returning *
      `, [owner, values.sourceOrderId, values.planId, values.cycle, values.bonusCredits, JSON.stringify(values.bonusEntitlements), values.createdAt]);
      const row = inserted.rows[0] || (await client.query<FirstPurchaseRewardRow>(`
        select * from membership_first_purchase_rewards where local_user_id = $1 limit 1
      `, [owner])).rows[0];
      if (!row) throw new Error("First purchase reward claim was not persisted.");
      const reward = firstPurchaseRewardFromRow(row);
      return { reward, isOwner: reward.source_order_id === input.sourceOrderId.trim() };
    });
  }

  async createMembership(input: CreateMembershipInput) {
    try {
      const timestamp = input.now || new Date().toISOString();
      const result = await applicationQuery<MembershipRow>(`
        insert into user_memberships(
          id, local_user_id, plan_id, cycle, status, starts_at, ends_at,
          source_order_id, created_at, updated_at, cancelled_at, version
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,null,1)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.planId,
        input.cycle,
        input.status,
        input.startsAt,
        input.endsAt,
        input.sourceOrderId.trim(),
        timestamp,
      ]);
      return membershipFromRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new MembershipRepositoryError("MEMBERSHIP_DUPLICATE", "Membership already exists for order.");
      throw error;
    }
  }

  async updateMembership(id: string, patch: MembershipPatch, expectedVersion?: number) {
    const values: unknown[] = [id.trim()];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.starts_at !== undefined) add("starts_at", patch.starts_at);
    if (patch.ends_at !== undefined) add("ends_at", patch.ends_at);
    if (patch.updated_at !== undefined) add("updated_at", patch.updated_at);
    if (patch.cancelled_at !== undefined) add("cancelled_at", patch.cancelled_at);
    assignments.push("version = version + 1");
    const expectedVersionClause = expectedVersion === undefined ? "" : ` and version = $${values.length + 1}`;
    if (expectedVersion !== undefined) values.push(expectedVersion);
    const result = await applicationQuery<MembershipRow>(`
      update user_memberships
      set ${assignments.join(", ")}
      where id = $1${expectedVersionClause}
      returning *
    `, values);
    if (result.rows[0]) return membershipFromRow(result.rows[0]);
    const existing = await applicationQuery("select id from user_memberships where id = $1", [id.trim()]);
    if (!existing.rows[0]) throw new MembershipRepositoryError("MEMBERSHIP_NOT_FOUND", "Membership was not found.");
    throw new MembershipRepositoryError("MEMBERSHIP_VERSION_CONFLICT", "Membership changed before update.");
  }

  async listEntitlements(localUserId: string, now = new Date().toISOString()) {
    const result = await applicationQuery<EntitlementRow>(`
      select * from membership_entitlements
      where local_user_id = $1 and remaining > 0 and expires_at > $2
      order by expires_at asc, created_at asc
    `, [localUserId.trim(), now]);
    return result.rows.map(entitlementFromRow);
  }

  async getEntitlementBySourceOrderAndKind(localUserId: string, sourceOrderId: string, kind: MembershipEntitlementKind) {
    const result = await applicationQuery<EntitlementRow>(`
      select * from membership_entitlements
      where local_user_id = $1 and source_order_id = $2 and kind = $3
      order by created_at desc
      limit 1
    `, [localUserId.trim(), sourceOrderId.trim(), kind]);
    return result.rows[0] ? entitlementFromRow(result.rows[0]) : null;
  }

  async grantEntitlement(input: GrantEntitlementInput) {
    if (input.amount <= 0) return null;
    const timestamp = input.now || new Date().toISOString();
    return withApplicationTransaction(async (client) => {
      const existing = await client.query<LedgerRow>(`
        select * from membership_entitlement_ledger
        where local_user_id = $1 and idempotency_key = $2
        limit 1
      `, [input.localUserId.trim(), input.idempotencyKey.trim()]);
      if (existing.rows[0]) {
        const grant = await client.query<EntitlementRow>(`
          select * from membership_entitlements
          where source_order_id = $1 and kind = $2
          order by created_at desc
          limit 1
        `, [input.sourceOrderId.trim(), input.kind]);
        return grant.rows[0] ? entitlementFromRow(grant.rows[0]) : null;
      }
      const grant = await client.query<EntitlementRow>(`
        insert into membership_entitlements(
          id, local_user_id, kind, granted, used, remaining, source_order_id,
          expires_at, created_at, updated_at, version
        ) values ($1,$2,$3,$4,0,$4,$5,$6,$7,$7,1)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.kind,
        input.amount,
        input.sourceOrderId.trim(),
        input.expiresAt,
        timestamp,
      ]);
      await client.query(`
        insert into membership_entitlement_ledger(
          id, local_user_id, kind, delta, idempotency_key, source_order_id, task_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,null,$7)
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.kind,
        input.amount,
        input.idempotencyKey.trim(),
        input.sourceOrderId.trim(),
        timestamp,
      ]);
      return entitlementFromRow(grant.rows[0]);
    });
  }

  async expireEntitlementsBySourceOrder(localUserId: string, sourceOrderIds: string[], now = new Date().toISOString()) {
    const owner = localUserId.trim();
    const orderIds = sourceOrderIds.map((value) => value.trim()).filter(Boolean);
    if (!owner || !orderIds.length) return 0;
    return withApplicationTransaction(async (client) => {
      const grants = await client.query<EntitlementRow>(`
        select * from membership_entitlements
        where local_user_id = $1 and source_order_id = any($2::text[]) and remaining > 0
        for update
      `, [owner, orderIds]);
      let expired = 0;
      for (const grant of grants.rows) {
        const remaining = Number(grant.remaining);
        if (remaining <= 0) continue;
        await client.query(`
          update membership_entitlements
          set used = used + $2, remaining = 0, updated_at = $3, version = version + 1
          where id = $1
        `, [grant.id, remaining, now]);
        await client.query(`
          insert into membership_entitlement_ledger(
            id, local_user_id, kind, delta, idempotency_key, source_order_id, task_id, created_at
          ) values ($1,$2,$3,$4,$5,$6,null,$7)
        `, [
          randomUUID(),
          owner,
          grant.kind,
          -remaining,
          `membership-expire:${grant.source_order_id}:${grant.kind}:${grant.id}`,
          grant.source_order_id,
          now,
        ]);
        expired += remaining;
      }
      return expired;
    });
  }

  async consumeEntitlement(input: ConsumeEntitlementInput) {
    if (input.amount <= 0) return { consumed: 0, ledger: null };
    const timestamp = input.now || new Date().toISOString();
    return withApplicationTransaction(async (client) => {
      const existing = await client.query<LedgerRow>(`
        select * from membership_entitlement_ledger
        where local_user_id = $1 and idempotency_key = $2
        limit 1
      `, [input.localUserId.trim(), input.idempotencyKey.trim()]);
      if (existing.rows[0]) {
        const ledger = ledgerFromRow(existing.rows[0]);
        return { consumed: Math.abs(Math.min(0, ledger.delta)), ledger };
      }
      const grants = await client.query<EntitlementRow>(`
        select * from membership_entitlements
        where local_user_id = $1 and kind = $2 and remaining > 0 and expires_at > $3
        order by expires_at asc, created_at asc
        for update
      `, [input.localUserId.trim(), input.kind, timestamp]);
      const available = grants.rows.reduce((total, grant) => total + Number(grant.remaining), 0);
      if (available < input.amount) return { consumed: 0, ledger: null };
      let remaining = input.amount;
      let consumed = 0;
      for (const grant of grants.rows) {
        if (remaining <= 0) break;
        const use = Math.min(remaining, Number(grant.remaining));
        await client.query(`
          update membership_entitlements
          set remaining = remaining - $2, used = used + $2, updated_at = $3, version = version + 1
          where id = $1
        `, [grant.id, use, timestamp]);
        remaining -= use;
        consumed += use;
      }
      if (consumed <= 0) return { consumed: 0, ledger: null };
      const ledger = await client.query<LedgerRow>(`
        insert into membership_entitlement_ledger(
          id, local_user_id, kind, delta, idempotency_key, source_order_id, task_id, created_at
        ) values ($1,$2,$3,$4,$5,null,$6,$7)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.kind,
        -consumed,
        input.idempotencyKey.trim(),
        input.taskId || null,
        timestamp,
      ]);
      return { consumed, ledger: ledgerFromRow(ledger.rows[0]) };
    });
  }

  async restoreEntitlement(input: RestoreEntitlementInput) {
    if (input.amount <= 0) return { restored: 0, ledger: null };
    const timestamp = input.now || new Date().toISOString();
    return withApplicationTransaction(async (client) => {
      const existing = await client.query<LedgerRow>(`
        select * from membership_entitlement_ledger
        where local_user_id = $1 and idempotency_key = $2
        limit 1
      `, [input.localUserId.trim(), input.idempotencyKey.trim()]);
      if (existing.rows[0]) {
        const ledger = ledgerFromRow(existing.rows[0]);
        return { restored: Math.max(0, ledger.delta), ledger };
      }

      const grants = await client.query<EntitlementRow>(`
        select * from membership_entitlements
        where local_user_id = $1 and kind = $2 and used > 0 and expires_at > $3
        order by expires_at asc, created_at asc
        for update
      `, [input.localUserId.trim(), input.kind, timestamp]);
      let remaining = input.amount;
      let restored = 0;
      let sourceOrderId: string | null = null;
      for (const grant of grants.rows) {
        if (remaining <= 0) break;
        const giveBack = Math.min(remaining, Number(grant.used));
        if (giveBack <= 0) continue;
        await client.query(`
          update membership_entitlements
          set remaining = remaining + $2, used = used - $2, updated_at = $3, version = version + 1
          where id = $1
        `, [grant.id, giveBack, timestamp]);
        remaining -= giveBack;
        restored += giveBack;
        sourceOrderId ||= grant.source_order_id;
      }
      if (restored <= 0) return { restored: 0, ledger: null };
      const ledger = await client.query<LedgerRow>(`
        insert into membership_entitlement_ledger(
          id, local_user_id, kind, delta, idempotency_key, source_order_id, task_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.kind,
        restored,
        input.idempotencyKey.trim(),
        sourceOrderId,
        input.taskId || null,
        timestamp,
      ]);
      return { restored, ledger: ledgerFromRow(ledger.rows[0]) };
    });
  }

  async getLedgerByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    const result = await applicationQuery<LedgerRow>(`
      select * from membership_entitlement_ledger
      where local_user_id = $1 and idempotency_key = $2
      limit 1
    `, [localUserId.trim(), idempotencyKey.trim()]);
    return result.rows[0] ? ledgerFromRow(result.rows[0]) : null;
  }
}

export function createPostgresMembershipRepository() {
  return new PostgresMembershipRepository();
}
