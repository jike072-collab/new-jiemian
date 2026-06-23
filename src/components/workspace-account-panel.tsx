"use client";

import { CalendarCheck, Crown, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot, UsagePage } from "@/lib/server/quota";

type WorkspaceAccountPanelProps = {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenCenter?: () => void;
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function WorkspaceAccountPanel({
  user,
  quota,
  usage,
  loading,
  onRefresh,
  onLogout,
  onOpenCenter,
}: WorkspaceAccountPanelProps) {
  const displayName = user?.display_name || user?.username || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();
  const latestUsageCount = usage?.total ?? usage?.entries?.length ?? 0;

  return (
    <div className="account-popover-card" role="dialog" aria-label="快捷账户卡片">
      <div className="account-popover-card__head">
        <div className="account-popover-card__avatar">{user ? avatarText : <UserRound className="size-5" />}</div>
        <div className="account-popover-card__identity">
          <strong>{displayName}</strong>
          <span>{user?.email || "登录后查看账户信息"}</span>
        </div>
        <button
          type="button"
          className="account-popover-card__checkin"
          onClick={onRefresh}
          disabled
          aria-label="签到暂未开放"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
          签到
        </button>
      </div>

      <div className="account-popover-card__rows">
        <div data-account-row="quota">
          <span>
            <Sparkles className="size-3.5" aria-hidden="true" />
            积分
          </span>
          <strong>{loading ? "加载中" : `${formatQuota(quota?.quota_units)} 分`}</strong>
        </div>
        <div data-account-row="plan">
          <span>
            <Crown className="size-3.5" aria-hidden="true" />
            当前套餐
          </span>
          <strong>暂无套餐</strong>
        </div>
        <div data-account-row="checkin">
          <span>
            <CalendarCheck className="size-3.5" aria-hidden="true" />
            签到
          </span>
          <strong>今日未签到</strong>
        </div>
      </div>

      <p className="account-popover-card__hint">
        {latestUsageCount ? `最近已有 ${formatQuota(latestUsageCount)} 条真实使用记录。` : "开始创作后，使用记录会自动出现在用户中心。"}
      </p>

      <div className="account-popover-card__actions">
        <button
          type="button"
          className="account-popover-card__primary"
          onClick={onOpenCenter}
          disabled={!user}
        >
          用户中心
        </button>
        <button type="button" className="account-popover-card__secondary" onClick={onRefresh} disabled={!user || loading}>
          {loading ? "刷新中" : "刷新账户"}
        </button>
        <button type="button" className="account-popover-card__logout" onClick={onLogout} disabled={!user || loading}>
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </button>
      </div>
    </div>
  );
}
