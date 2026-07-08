"use client";

import { ChevronRight, Crown, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot } from "@/lib/server/quota";
import { getPlanStatusDisplay, type CheckInStatus, type PlanStatus } from "@/lib/account-status";
import { cn } from "@/lib/utils";

type AccountView = "center" | "recharge" | "usage";
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
  checkInStatus: CheckInStatus;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenCenter?: () => void;
  onOpenRecharge?: () => void;
  onCheckInUnavailable?: () => void;
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function createEntitlementItems(entitlements: MembershipEntitlements | null | undefined) {
  if (!entitlements) return [];
  return [
    ["剩余提示词", `${formatQuota(entitlements.prompt_optimize.remaining)} 次`],
    ["剩余生图", `${formatQuota(entitlements.image_generation.remaining)} 张`],
    ["剩余视频", `${formatQuota(entitlements.video_generation.remaining)} 次`],
  ].filter(([, value]) => value !== "0 次" && value !== "0 张");
}

export function WorkspaceAccountPanel({
  user,
  quota,
  membershipEntitlements,
  loading,
  accountError = "",
  accountView,
  planStatus,
  checkInStatus,
  onRefresh,
  onLogout,
  onOpenCenter,
  onOpenRecharge,
  onCheckInUnavailable,
}: WorkspaceAccountPanelProps) {
  const displayName = user?.display_name || user?.username || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();
  const pointsLabel = loading ? "加载中" : quota ? `${formatQuota(quota.quota_units)} ✦` : "—";
  const planDisplay = getPlanStatusDisplay(planStatus);
  const currentCenter = accountView === "center";
  const entitlementItems = createEntitlementItems(membershipEntitlements);
  const checkInButtonLabel = checkInStatus === "checked" ? "已签到" : "签到";
  const checkInButtonDisabled = !user || checkInStatus === "checked" || checkInStatus === "loading" || checkInStatus === "submitting";

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
        <div className="account-popover-row">
          <span>
            <Crown className="size-3.5" aria-hidden="true" />
            当前套餐
          </span>
          <strong>{planDisplay.label}</strong>
          <button type="button" onClick={planStatus.status === "error" ? onRefresh : onOpenRecharge} disabled={!user}>
            {planDisplay.actionLabel}
          </button>
        </div>
        {entitlementItems.length ? (
          <div className="account-popover-entitlements" aria-label="会员剩余次数">
            {entitlementItems.map(([label, value]) => (
              <span key={label}>
                <em>{label}</em>
                <strong>{value}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>

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
      </div>

      <button type="button" className="account-popover-card__logout" onClick={onLogout} disabled={!user || loading}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
        退出登录
      </button>
    </div>
  );
}
