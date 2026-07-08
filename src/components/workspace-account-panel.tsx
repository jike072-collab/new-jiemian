"use client";

import { ChevronRight, CreditCard, Crown, History, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot } from "@/lib/server/quota";
import { getPlanStatusDisplay, getPlanTone, type CheckInStatus, type PlanStatus } from "@/lib/account-status";
import { cn } from "@/lib/utils";

type AccountView = "center" | "recharge" | "usage" | "orders";
type MembershipEntitlements = Record<"prompt_optimize" | "image_generation" | "video_generation", {
  remaining: number;
  granted: number;
  used: number;
}>;

type WorkspaceAccountPanelProps = {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  membershipEntitlements?: MembershipEntitlements | null;
  loading: boolean;
  accountError?: string;
  accountView?: AccountView;
  planStatus: PlanStatus;
  membershipEndsAt?: string | null;
  checkInStatus: CheckInStatus;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenCenter?: () => void;
  onOpenRecharge?: () => void;
  onOpenUsage?: () => void;
  onOpenOrders?: () => void;
  onCheckInUnavailable?: () => void;
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function createEntitlementItems(entitlements: MembershipEntitlements | null | undefined) {
  if (!entitlements) return [];
  return [
    ["提示词优化", `${formatQuota(entitlements.prompt_optimize.remaining)} 次`],
    ["生图额度", `${formatQuota(entitlements.image_generation.remaining)} 张`],
    ["视频额度", `${formatQuota(entitlements.video_generation.remaining)} 次`],
  ].filter(([, value]) => value !== "0 次" && value !== "0 张");
}

function formatPlanDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatRemainingDays(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const remaining = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
  return `${formatQuota(remaining)} 天`;
}

export function WorkspaceAccountPanel({
  user,
  quota,
  membershipEntitlements,
  loading,
  accountError = "",
  accountView,
  planStatus,
  membershipEndsAt,
  checkInStatus,
  onRefresh,
  onLogout,
  onOpenCenter,
  onOpenRecharge,
  onOpenUsage,
  onOpenOrders,
  onCheckInUnavailable,
}: WorkspaceAccountPanelProps) {
  const displayName = user?.display_name || user?.username || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();
  const pointsLabel = loading ? "加载中" : quota ? `${formatQuota(quota.quota_units)} ✦` : "—";
  const planDisplay = getPlanStatusDisplay(planStatus);
  const planTone = getPlanTone(planDisplay.label);
  const currentCenter = accountView === "center";
  const currentUsage = accountView === "usage";
  const currentOrders = accountView === "orders";
  const entitlementItems = createEntitlementItems(membershipEntitlements);
  const planEndsAtLabel = formatPlanDate(membershipEndsAt);
  const planRemainingLabel = formatRemainingDays(membershipEndsAt);
  const checkInButtonLabel = checkInStatus === "checked" ? "已签到" : "签到";
  const checkInButtonDisabled = !user || checkInStatus === "checked" || checkInStatus === "loading" || checkInStatus === "submitting";
  const handlePlanClick = planStatus.status === "error" ? onRefresh : onOpenRecharge;

  return (
    <div className="account-popover-card" data-account-error={accountError && !loading ? "true" : undefined}>
      <div className="account-popover-card__head">
        <div className="account-popover-card__avatar">{user ? avatarText : <UserRound className="size-5" aria-hidden="true" />}</div>
        <div className="account-popover-card__identity">
          <strong>{displayName}</strong>
          <span>{user?.email || "登录后查看账户信息"}</span>
        </div>
        <button
          type="button"
          className={cn("account-popover-card__checkin", checkInStatus === "checked" && "is-checked")}
          onClick={checkInButtonDisabled ? undefined : onCheckInUnavailable}
          disabled={checkInButtonDisabled}
        >
          {checkInButtonLabel}
        </button>
      </div>

      <div className="account-popover-card__rows">
        <div className="account-popover-row">
          <span>
            <Sparkles className="size-3.5" aria-hidden="true" />
            可用积分
          </span>
          <strong>{pointsLabel}</strong>
          <button type="button" onClick={onOpenRecharge} disabled={!user}>
            充值
          </button>
        </div>
        <button
          type="button"
          className={cn("account-popover-plan-card", `account-popover-plan-card--${planTone}`)}
          onClick={handlePlanClick}
          disabled={!user}
        >
          <span className="account-popover-plan-card__label">
            <Crown className="size-3.5" aria-hidden="true" />
            当前套餐
          </span>
          <strong>{planDisplay.label}</strong>
          <span className="account-popover-plan-card__meta">
            {planEndsAtLabel ? <em>到期 {planEndsAtLabel}</em> : null}
            {planRemainingLabel ? <em>剩余 {planRemainingLabel}</em> : null}
          </span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      {entitlementItems.length ? (
        <section className="account-popover-entitlement-section" aria-label="会员剩余额度">
          <div className="account-popover-section-title">剩余额度</div>
          <div className="account-popover-entitlements">
            {entitlementItems.map(([label, value]) => (
              <span key={label}>
                <em>{label}</em>
                <strong>{value}</strong>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="account-popover-card__nav">
        <button
          type="button"
          className={cn("account-popover-nav-row", currentCenter && "is-current")}
          onClick={onOpenCenter}
          disabled={!user || currentCenter}
          aria-current={currentCenter ? "page" : undefined}
        >
          <span>
            <UserRound className="size-4" aria-hidden="true" />
            用户中心
          </span>
          <em>{currentCenter ? "当前位于用户中心" : <ChevronRight className="size-4" aria-hidden="true" />}</em>
        </button>
        <button
          type="button"
          className={cn("account-popover-nav-row", currentUsage && "is-current")}
          onClick={onOpenUsage}
          disabled={!user || currentUsage}
          aria-current={currentUsage ? "page" : undefined}
        >
          <span>
            <History className="size-4" aria-hidden="true" />
            积分明细
          </span>
          <em>{currentUsage ? "当前位于积分明细" : <ChevronRight className="size-4" aria-hidden="true" />}</em>
        </button>
        <button
          type="button"
          className={cn("account-popover-nav-row", currentOrders && "is-current")}
          onClick={onOpenOrders}
          disabled={!user || currentOrders}
          aria-current={currentOrders ? "page" : undefined}
        >
          <span>
            <CreditCard className="size-4" aria-hidden="true" />
            订单记录
          </span>
          <em>{currentOrders ? "当前位于订单记录" : <ChevronRight className="size-4" aria-hidden="true" />}</em>
        </button>
        <button type="button" className="account-popover-nav-row account-popover-nav-row--danger" onClick={onLogout} disabled={!user || loading}>
          <span>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            退出登录
          </span>
          <em><ChevronRight className="size-4" aria-hidden="true" /></em>
        </button>
      </div>
    </div>
  );
}
