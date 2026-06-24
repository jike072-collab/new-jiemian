"use client";

import { CalendarCheck, ChevronRight, Crown, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot } from "@/lib/server/quota";
import { getCheckInStatusDisplay, getPlanStatusDisplay, type CheckInStatus, type PlanStatus } from "@/lib/account-status";
import { cn } from "@/lib/utils";

type AccountView = "center" | "recharge" | "usage";

type WorkspaceAccountPanelProps = {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
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

export function WorkspaceAccountPanel({
  user,
  quota,
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
  const checkInDisplay = getCheckInStatusDisplay(checkInStatus);
  const currentCenter = accountView === "center";

  return (
    <div className="account-popover-card" data-account-error={accountError && !loading ? "true" : undefined}>
      <div className="account-popover-card__head">
        <div className="account-popover-card__avatar">{user ? avatarText : <UserRound className="size-5" aria-hidden="true" />}</div>
        <div className="account-popover-card__identity">
          <strong>{displayName}</strong>
          <span>{user?.email || "登录后查看账户信息"}</span>
        </div>
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
        <div className="account-popover-row">
          <span>
            <CalendarCheck className="size-3.5" aria-hidden="true" />
            每日签到
          </span>
          <strong>{checkInDisplay.label}</strong>
          <button
            type="button"
            onClick={checkInStatus === "error" ? onRefresh : onCheckInUnavailable}
            disabled={!user || (checkInStatus !== "unavailable" && checkInDisplay.actionDisabled)}
          >
            {checkInDisplay.actionLabel}
          </button>
        </div>
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
