"use client";

import { ArrowRight, CalendarCheck, Crown, Loader2, LogOut, RefreshCw, Sparkles, UserRound } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder, PublicPaymentChannelConfig } from "@/lib/server/billing";
import type { QuotaSnapshot, UsagePage } from "@/lib/server/quota";

type WorkspaceAccountPanelProps = {
  user: PublicAuthUser | null;
  mappingStatus: string | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  billingChannels: PublicPaymentChannelConfig[];
  billingOrders: BillingOrder[];
  selectedOrderId: string | null;
  selectedOrder: BillingOrder | null;
  loading: boolean;
  loadingOrders: boolean;
  submitting: boolean;
  onSelectOrder: (orderId: string) => void;
  onCreateOrder: (channel: PublicPaymentChannelConfig, amount: number) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenCenter?: () => void;
  isAccountCenter?: boolean;
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function WorkspaceAccountPanel({
  user,
  quota,
  usage,
  billingChannels,
  loading,
  submitting,
  onCreateOrder,
  onRefresh,
  onLogout,
  onOpenCenter,
  isAccountCenter = false,
}: WorkspaceAccountPanelProps) {
  const displayName = user?.display_name || user?.username || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();
  const preferredChannel = billingChannels[0] || null;
  const preferredAmount = preferredChannel ? preferredChannel.fixed_amounts[0] || preferredChannel.min_amount : 0;
  const canTopUp = Boolean(user && preferredChannel && !submitting);
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
          className="account-popover-card__refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="刷新账户信息"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      <div className="account-popover-card__rows">
        <div>
          <span>
            <Sparkles className="size-3.5" aria-hidden="true" />
            积分
          </span>
          <strong>{loading ? "加载中" : `${formatQuota(quota?.quota_units)} 分`}</strong>
        </div>
        <div>
          <span>
            <Crown className="size-3.5" aria-hidden="true" />
            当前套餐
          </span>
          <strong>暂无套餐</strong>
        </div>
        <div>
          <span>
            <CalendarCheck className="size-3.5" aria-hidden="true" />
            签到
          </span>
          <strong>连续签到 0 天</strong>
        </div>
      </div>

      <p className="account-popover-card__hint">
        {latestUsageCount ? `最近已有 ${formatQuota(latestUsageCount)} 条真实使用记录。` : "开始创作后，使用记录会自动出现在用户中心。"}
      </p>

      <div className="account-popover-card__actions">
        <button
          type="button"
          className="account-popover-card__primary"
          onClick={() => {
            if (preferredChannel) onCreateOrder(preferredChannel, preferredAmount);
          }}
          disabled={!canTopUp}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {preferredChannel ? "立即充值" : "充值暂未开放"}
        </button>
        {isAccountCenter ? (
          <button type="button" className="account-popover-card__secondary" disabled>
            当前位于用户中心
          </button>
        ) : (
          <button type="button" className="account-popover-card__secondary" onClick={onOpenCenter}>
            进入用户中心
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="account-popover-card__logout" onClick={onLogout} disabled={!user || loading || submitting}>
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </button>
      </div>
    </div>
  );
}
