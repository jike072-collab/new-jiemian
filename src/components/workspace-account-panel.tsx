"use client";

import { ArrowRight, Loader2, LogOut, RefreshCw, UserRound, WalletCards } from "lucide-react";

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
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
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
}: WorkspaceAccountPanelProps) {
  const displayName = user?.display_name || user?.username || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();
  const preferredChannel = billingChannels[0] || null;
  const preferredAmount = preferredChannel ? preferredChannel.fixed_amounts[0] || preferredChannel.min_amount : 0;
  const canTopUp = Boolean(user && preferredChannel && !submitting);
  const usedThisMonth = quota?.used_quota_units;
  const latestUsage = usage?.entries?.[0];

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

      <div className="account-popover-card__badge">
        <WalletCards className="size-3.5" aria-hidden="true" />
        <span>{user?.role === "admin" ? "管理员" : "普通用户"}</span>
      </div>

      <div className="account-popover-card__stats">
        <div>
          <span>可用额度</span>
          <strong>{formatQuota(quota?.available_quota_units)}</strong>
        </div>
        <div>
          <span>积分</span>
          <strong>{formatQuota(quota?.quota_units)}</strong>
        </div>
        <div>
          <span>本月已用</span>
          <strong>{formatQuota(usedThisMonth)}</strong>
        </div>
      </div>

      {latestUsage ? (
        <p className="account-popover-card__hint">
          最近使用：{formatQuota(latestUsage.actual_quota_units ?? latestUsage.estimated_quota_units)} 点额度
        </p>
      ) : (
        <p className="account-popover-card__hint">额度和积分会在使用工具后自动更新。</p>
      )}

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
          立即充值
        </button>
        <button type="button" className="account-popover-card__secondary" onClick={onOpenCenter}>
          进入用户中心
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
        <button type="button" className="account-popover-card__logout" onClick={onLogout} disabled={!user || loading || submitting}>
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </button>
      </div>
    </div>
  );
}
