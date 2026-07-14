import type { MembershipCycle, MembershipEntitlementKind, MembershipPlanId } from "./plans";

export type UserMembershipStatus = "active" | "queued" | "cancelled" | "expired";

export type UserMembership = {
  id: string;
  local_user_id: string;
  plan_id: MembershipPlanId;
  cycle: MembershipCycle;
  status: UserMembershipStatus;
  starts_at: string;
  ends_at: string;
  source_order_id: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  version: number;
};

export type MembershipEntitlementGrant = {
  id: string;
  local_user_id: string;
  kind: MembershipEntitlementKind;
  granted: number;
  used: number;
  remaining: number;
  source_order_id: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  version: number;
};

export type MembershipEntitlementLedger = {
  id: string;
  local_user_id: string;
  kind: MembershipEntitlementKind;
  delta: number;
  idempotency_key: string;
  source_order_id: string | null;
  task_id: string | null;
  created_at: string;
};

export type MembershipFirstPurchaseRewardRecord = {
  local_user_id: string;
  source_order_id: string;
  plan_id: MembershipPlanId;
  cycle: MembershipCycle;
  bonus_credits: number;
  bonus_entitlements: Record<MembershipEntitlementKind, number>;
  created_at: string;
};

export type MembershipStatusSnapshot = {
  active: UserMembership | null;
  queued: UserMembership | null;
  recharge_bonus_basis_points: number;
  first_purchase_reward_claimed: boolean;
  entitlements: Record<MembershipEntitlementKind, {
    remaining: number;
    granted: number;
    used: number;
  }>;
};
