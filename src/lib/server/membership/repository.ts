import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import type { MembershipEntitlementKind, MembershipPlanId, MembershipCycle } from "./plans";
import type { MembershipEntitlementGrant, MembershipEntitlementLedger, UserMembership, UserMembershipStatus } from "./types";

type MembershipStore = {
  memberships: UserMembership[];
  entitlements: MembershipEntitlementGrant[];
  ledger: MembershipEntitlementLedger[];
};

type MembershipStorage = {
  read(): Promise<MembershipStore>;
  write(store: MembershipStore): Promise<void>;
};

export type CreateMembershipInput = {
  localUserId: string;
  planId: MembershipPlanId;
  cycle: MembershipCycle;
  status: UserMembershipStatus;
  startsAt: string;
  endsAt: string;
  sourceOrderId: string;
  now?: string;
};

export type MembershipPatch = Partial<Pick<UserMembership, "status" | "starts_at" | "ends_at" | "updated_at" | "cancelled_at">>;

export type GrantEntitlementInput = {
  localUserId: string;
  kind: MembershipEntitlementKind;
  amount: number;
  sourceOrderId: string;
  expiresAt: string;
  idempotencyKey: string;
  now?: string;
};

export type ConsumeEntitlementInput = {
  localUserId: string;
  kind: MembershipEntitlementKind;
  amount: number;
  idempotencyKey: string;
  taskId?: string | null;
  now?: string;
};

export type RestoreEntitlementInput = {
  localUserId: string;
  kind: MembershipEntitlementKind;
  amount: number;
  idempotencyKey: string;
  taskId?: string | null;
  now?: string;
};

export type MembershipRepository = {
  listMemberships(localUserId: string): Promise<UserMembership[]>;
  getMembershipByOrder(sourceOrderId: string): Promise<UserMembership | null>;
  createMembership(input: CreateMembershipInput): Promise<UserMembership>;
  updateMembership(id: string, patch: MembershipPatch, expectedVersion?: number): Promise<UserMembership>;
  listEntitlements(localUserId: string, now?: string): Promise<MembershipEntitlementGrant[]>;
  grantEntitlement(input: GrantEntitlementInput): Promise<MembershipEntitlementGrant | null>;
  expireEntitlementsBySourceOrder(localUserId: string, sourceOrderIds: string[], now?: string): Promise<number>;
  consumeEntitlement(input: ConsumeEntitlementInput): Promise<{ consumed: number; ledger: MembershipEntitlementLedger | null }>;
  restoreEntitlement(input: RestoreEntitlementInput): Promise<{ restored: number; ledger: MembershipEntitlementLedger | null }>;
  getLedgerByIdempotencyKey(localUserId: string, idempotencyKey: string): Promise<MembershipEntitlementLedger | null>;
};

export class MembershipRepositoryError extends Error {
  constructor(readonly code: "MEMBERSHIP_DUPLICATE" | "MEMBERSHIP_NOT_FOUND" | "MEMBERSHIP_VERSION_CONFLICT", message: string) {
    super(message);
    this.name = "MembershipRepositoryError";
  }
}

const defaultMembershipPath = join(dataRoot, "membership-store.json");

function nowIso(now?: string) {
  return now || new Date().toISOString();
}

function cloneMembership(record: UserMembership): UserMembership {
  return { ...record };
}

function cloneEntitlement(record: MembershipEntitlementGrant): MembershipEntitlementGrant {
  return { ...record };
}

function cloneLedger(record: MembershipEntitlementLedger): MembershipEntitlementLedger {
  return { ...record };
}

function normalizeStore(store: Partial<MembershipStore> | null): MembershipStore {
  return {
    memberships: Array.isArray(store?.memberships) ? store.memberships.map((record) => ({ ...record })) : [],
    entitlements: Array.isArray(store?.entitlements) ? store.entitlements.map((record) => ({ ...record })) : [],
    ledger: Array.isArray(store?.ledger) ? store.ledger.map((record) => ({ ...record })) : [],
  };
}

function cloneStore(store: MembershipStore): MembershipStore {
  return {
    memberships: store.memberships.map(cloneMembership),
    entitlements: store.entitlements.map(cloneEntitlement),
    ledger: store.ledger.map(cloneLedger),
  };
}

class StoreMembershipRepository implements MembershipRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: MembershipStorage) {}

  private async withLock<T>(operation: () => Promise<T>) {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async mutate<T>(operation: (store: MembershipStore) => Promise<T> | T) {
    return this.withLock(async () => {
      const store = cloneStore(await this.storage.read());
      const result = await operation(store);
      await this.storage.write(store);
      return result;
    });
  }

  async listMemberships(localUserId: string) {
    const store = await this.storage.read();
    return store.memberships
      .filter((record) => record.local_user_id === localUserId.trim())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(cloneMembership);
  }

  async getMembershipByOrder(sourceOrderId: string) {
    const store = await this.storage.read();
    const found = store.memberships.find((record) => record.source_order_id === sourceOrderId.trim());
    return found ? cloneMembership(found) : null;
  }

  async createMembership(input: CreateMembershipInput) {
    const timestamp = nowIso(input.now);
    return this.mutate((store) => {
      const existing = store.memberships.find((record) => record.source_order_id === input.sourceOrderId.trim());
      if (existing) throw new MembershipRepositoryError("MEMBERSHIP_DUPLICATE", "Membership already exists for order.");
      const record: UserMembership = {
        id: randomUUID(),
        local_user_id: input.localUserId.trim(),
        plan_id: input.planId,
        cycle: input.cycle,
        status: input.status,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        source_order_id: input.sourceOrderId.trim(),
        created_at: timestamp,
        updated_at: timestamp,
        cancelled_at: null,
        version: 1,
      };
      store.memberships.push(record);
      return cloneMembership(record);
    });
  }

  async updateMembership(id: string, patch: MembershipPatch, expectedVersion?: number) {
    return this.mutate((store) => {
      const index = store.memberships.findIndex((record) => record.id === id.trim());
      if (index < 0) throw new MembershipRepositoryError("MEMBERSHIP_NOT_FOUND", "Membership was not found.");
      if (expectedVersion !== undefined && store.memberships[index].version !== expectedVersion) {
        throw new MembershipRepositoryError("MEMBERSHIP_VERSION_CONFLICT", "Membership changed before update.");
      }
      store.memberships[index] = {
        ...store.memberships[index],
        ...patch,
        version: store.memberships[index].version + 1,
      };
      return cloneMembership(store.memberships[index]);
    });
  }

  async listEntitlements(localUserId: string, now = new Date().toISOString()) {
    const store = await this.storage.read();
    return store.entitlements
      .filter((record) => record.local_user_id === localUserId.trim())
      .filter((record) => record.remaining > 0 && record.expires_at > now)
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
      .map(cloneEntitlement);
  }

  async grantEntitlement(input: GrantEntitlementInput) {
    if (input.amount <= 0) return null;
    const timestamp = nowIso(input.now);
    return this.mutate((store) => {
      const existing = store.ledger.find((record) => (
        record.local_user_id === input.localUserId.trim()
        && record.idempotency_key === input.idempotencyKey.trim()
      ));
      if (existing) {
        const found = store.entitlements.find((record) => (
          record.source_order_id === input.sourceOrderId.trim()
          && record.kind === input.kind
        ));
        return found ? cloneEntitlement(found) : null;
      }
      const grant: MembershipEntitlementGrant = {
        id: randomUUID(),
        local_user_id: input.localUserId.trim(),
        kind: input.kind,
        granted: input.amount,
        used: 0,
        remaining: input.amount,
        source_order_id: input.sourceOrderId.trim(),
        expires_at: input.expiresAt,
        created_at: timestamp,
        updated_at: timestamp,
        version: 1,
      };
      store.entitlements.push(grant);
      store.ledger.push({
        id: randomUUID(),
        local_user_id: grant.local_user_id,
        kind: input.kind,
        delta: input.amount,
        idempotency_key: input.idempotencyKey.trim(),
        source_order_id: input.sourceOrderId.trim(),
        task_id: null,
        created_at: timestamp,
      });
      return cloneEntitlement(grant);
    });
  }

  async expireEntitlementsBySourceOrder(localUserId: string, sourceOrderIds: string[], now = new Date().toISOString()) {
    const owner = localUserId.trim();
    const orderIds = new Set(sourceOrderIds.map((value) => value.trim()).filter(Boolean));
    if (!owner || !orderIds.size) return 0;
    return this.mutate((store) => {
      let expired = 0;
      for (const grant of store.entitlements) {
        if (grant.local_user_id !== owner || !orderIds.has(grant.source_order_id) || grant.remaining <= 0) continue;
        const delta = -grant.remaining;
        grant.used += grant.remaining;
        grant.remaining = 0;
        grant.updated_at = now;
        grant.version += 1;
        store.ledger.push({
          id: randomUUID(),
          local_user_id: owner,
          kind: grant.kind,
          delta,
          idempotency_key: `membership-expire:${grant.source_order_id}:${grant.kind}:${grant.id}`,
          source_order_id: grant.source_order_id,
          task_id: null,
          created_at: now,
        });
        expired += Math.abs(delta);
      }
      return expired;
    });
  }

  async consumeEntitlement(input: ConsumeEntitlementInput) {
    if (input.amount <= 0) return { consumed: 0, ledger: null };
    const timestamp = nowIso(input.now);
    return this.mutate((store) => {
      const existing = store.ledger.find((record) => (
        record.local_user_id === input.localUserId.trim()
        && record.idempotency_key === input.idempotencyKey.trim()
      ));
      if (existing) return { consumed: Math.abs(Math.min(0, existing.delta)), ledger: cloneLedger(existing) };

      let remaining = input.amount;
      let consumed = 0;
      const active = store.entitlements
        .filter((record) => record.local_user_id === input.localUserId.trim())
        .filter((record) => record.kind === input.kind && record.remaining > 0 && record.expires_at > timestamp)
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
      for (const grant of active) {
        if (remaining <= 0) break;
        const use = Math.min(remaining, grant.remaining);
        grant.remaining -= use;
        grant.used += use;
        grant.updated_at = timestamp;
        grant.version += 1;
        remaining -= use;
        consumed += use;
      }
      if (consumed <= 0) return { consumed: 0, ledger: null };
      const ledger: MembershipEntitlementLedger = {
        id: randomUUID(),
        local_user_id: input.localUserId.trim(),
        kind: input.kind,
        delta: -consumed,
        idempotency_key: input.idempotencyKey.trim(),
        source_order_id: null,
        task_id: input.taskId || null,
        created_at: timestamp,
      };
      store.ledger.push(ledger);
      return { consumed, ledger: cloneLedger(ledger) };
    });
  }

  async restoreEntitlement(input: RestoreEntitlementInput) {
    if (input.amount <= 0) return { restored: 0, ledger: null };
    const timestamp = nowIso(input.now);
    return this.mutate((store) => {
      const existing = store.ledger.find((record) => (
        record.local_user_id === input.localUserId.trim()
        && record.idempotency_key === input.idempotencyKey.trim()
      ));
      if (existing) return { restored: Math.max(0, existing.delta), ledger: cloneLedger(existing) };

      let remaining = input.amount;
      let restored = 0;
      let sourceOrderId: string | null = null;
      const active = store.entitlements
        .filter((record) => record.local_user_id === input.localUserId.trim())
        .filter((record) => record.kind === input.kind && record.used > 0 && record.expires_at > timestamp)
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
      for (const grant of active) {
        if (remaining <= 0) break;
        const giveBack = Math.min(remaining, grant.used);
        grant.used -= giveBack;
        grant.remaining += giveBack;
        grant.updated_at = timestamp;
        grant.version += 1;
        remaining -= giveBack;
        restored += giveBack;
        sourceOrderId ||= grant.source_order_id;
      }
      if (restored <= 0) return { restored: 0, ledger: null };
      const ledger: MembershipEntitlementLedger = {
        id: randomUUID(),
        local_user_id: input.localUserId.trim(),
        kind: input.kind,
        delta: restored,
        idempotency_key: input.idempotencyKey.trim(),
        source_order_id: sourceOrderId,
        task_id: input.taskId || null,
        created_at: timestamp,
      };
      store.ledger.push(ledger);
      return { restored, ledger: cloneLedger(ledger) };
    });
  }

  async getLedgerByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    const store = await this.storage.read();
    const found = store.ledger.find((record) => (
      record.local_user_id === localUserId.trim()
      && record.idempotency_key === idempotencyKey.trim()
    ));
    return found ? cloneLedger(found) : null;
  }
}

export function createMemoryMembershipRepository(seed: Partial<MembershipStore> = {}) {
  let store = normalizeStore(seed);
  return new StoreMembershipRepository({
    async read() {
      return cloneStore(store);
    },
    async write(nextStore) {
      store = cloneStore(nextStore);
    },
  });
}

export function createJsonMembershipRepository(path = defaultMembershipPath) {
  return new StoreMembershipRepository({
    async read() {
      return normalizeStore(await readJsonFile<Partial<MembershipStore> | null>(path, null));
    },
    async write(store) {
      await writeJsonFile(path, store);
    },
  });
}
