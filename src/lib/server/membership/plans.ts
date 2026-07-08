export type MembershipPlanId = "basic" | "advanced" | "pro" | "enterprise";
export type MembershipCycle = "monthly" | "quarterly" | "yearly";
export type MembershipEntitlementKind = "prompt_optimize" | "image_generation" | "video_generation";

export type MembershipPlan = {
  id: MembershipPlanId;
  name: string;
  rank: number;
  recharge_bonus_basis_points: number;
  monthly_credits: number;
  monthly_entitlements: Record<MembershipEntitlementKind, number>;
  prices: Record<MembershipCycle, number>;
};

export type MembershipSku = {
  plan: MembershipPlan;
  cycle: MembershipCycle;
  price_amount: number;
  cycle_months: number;
  duration_days: number;
  grant_credits: number;
  grant_entitlements: Record<MembershipEntitlementKind, number>;
};

export const membershipPlans: MembershipPlan[] = [
  {
    id: "basic",
    name: "基础会员",
    rank: 10,
    recharge_bonus_basis_points: 500,
    monthly_credits: 3600,
    monthly_entitlements: {
      prompt_optimize: 10,
      image_generation: 10,
      video_generation: 0,
    },
    prices: {
      monthly: 2990,
      quarterly: 7900,
      yearly: 29900,
    },
  },
  {
    id: "advanced",
    name: "进阶会员",
    rank: 20,
    recharge_bonus_basis_points: 1000,
    monthly_credits: 9000,
    monthly_entitlements: {
      prompt_optimize: 30,
      image_generation: 30,
      video_generation: 1,
    },
    prices: {
      monthly: 5990,
      quarterly: 15900,
      yearly: 59900,
    },
  },
  {
    id: "pro",
    name: "专业会员",
    rank: 30,
    recharge_bonus_basis_points: 1500,
    monthly_credits: 16000,
    monthly_entitlements: {
      prompt_optimize: 80,
      image_generation: 60,
      video_generation: 3,
    },
    prices: {
      monthly: 9990,
      quarterly: 27900,
      yearly: 99900,
    },
  },
  {
    id: "enterprise",
    name: "企业会员",
    rank: 40,
    recharge_bonus_basis_points: 2000,
    monthly_credits: 36000,
    monthly_entitlements: {
      prompt_optimize: 200,
      image_generation: 150,
      video_generation: 8,
    },
    prices: {
      monthly: 19900,
      quarterly: 54900,
      yearly: 199900,
    },
  },
];

const cycleMonths: Record<MembershipCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

const cycleDays: Record<MembershipCycle, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

export function getMembershipPlan(planId: string | null | undefined) {
  return membershipPlans.find((plan) => plan.id === planId) || null;
}

export function isMembershipCycle(value: unknown): value is MembershipCycle {
  return value === "monthly" || value === "quarterly" || value === "yearly";
}

export function getMembershipSku(planId: string | null | undefined, cycle: unknown): MembershipSku | null {
  const plan = getMembershipPlan(planId);
  if (!plan || !isMembershipCycle(cycle)) return null;
  const months = cycleMonths[cycle];
  return {
    plan,
    cycle,
    price_amount: plan.prices[cycle],
    cycle_months: months,
    duration_days: cycleDays[cycle],
    grant_credits: plan.monthly_credits * months,
    grant_entitlements: {
      prompt_optimize: plan.monthly_entitlements.prompt_optimize * months,
      image_generation: plan.monthly_entitlements.image_generation * months,
      video_generation: plan.monthly_entitlements.video_generation * months,
    },
  };
}

export function addMembershipDuration(start: Date, cycle: MembershipCycle) {
  const next = new Date(start.getTime());
  if (cycle === "monthly") next.setMonth(next.getMonth() + 1);
  else if (cycle === "quarterly") next.setMonth(next.getMonth() + 3);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}
