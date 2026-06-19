"use client";

import { ChevronRight, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";

import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder, BillingOrderStatus, PublicPaymentChannelConfig } from "@/lib/server/billing";
import type { QuotaSnapshot, UsageLogEntry, UsagePage } from "@/lib/server/quota";

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
};

const statusLabels: Record<BillingOrderStatus, string> = {
  pending: "待支付",
  processing: "处理中",
  paid: "已支付",
  failed: "失败",
  cancelled: "已关闭",
  review: "人工审核",
  refunded: "已退款",
};

function formatQuota(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function usageSummary(entry: UsageLogEntry) {
  return `${entry.task_id} · ${formatQuota(entry.actual_quota_units ?? entry.estimated_quota_units)} credits`;
}

export function WorkspaceAccountPanel({
  user,
  mappingStatus,
  quota,
  usage,
  billingChannels,
  billingOrders,
  selectedOrderId,
  selectedOrder,
  loading,
  loadingOrders,
  submitting,
  onSelectOrder,
  onCreateOrder,
  onRefresh,
  onLogout,
}: WorkspaceAccountPanelProps) {
  return (
    <div className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-[#0f0f13] p-4 text-sm text-white/72 shadow-[0_24px_72px_rgba(0,0,0,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-white/92">
            <ShieldCheck className="size-4 text-emerald-300" />
            <strong className="truncate">{user?.display_name || user?.username || "账户"}</strong>
          </div>
          <p className="mt-1 truncate text-xs text-white/46">{user?.email || "未登录"}</p>
          <p className="mt-1 text-xs text-white/38">映射状态: {mappingStatus || "unknown"}</p>
        </div>
        <button type="button" className="shell-icon-button" onClick={onRefresh} aria-label="刷新账户信息" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-white/48">可用额度</span>
          <strong className="text-white">{quota ? formatQuota(quota.available_quota_units) : "—"}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-white/48">总额度 / 已用</span>
          <span className="text-white/80">
            {quota ? `${formatQuota(quota.quota_units)} / ${formatQuota(quota.used_quota_units)}` : "—"}
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-white/88">充值渠道</strong>
          <span className="text-xs text-white/42">沙箱已启用，生产默认关闭</span>
        </div>
        <div className="grid gap-2">
          {billingChannels.length ? billingChannels.map((channel) => {
            const amount = channel.fixed_amounts[0] || channel.min_amount;
            return (
              <button
                key={channel.channel}
                type="button"
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm transition hover:border-fuchsia-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onCreateOrder(channel, amount)}
                disabled={submitting || !user}
              >
                <span className="min-w-0">
                  <span className="block truncate text-white/88">{channel.name}</span>
                  <span className="block text-xs text-white/42">{channel.channel}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-white/82">
                  ¥{(amount / 100).toFixed(2)}
                  <ChevronRight className="size-4" />
                </span>
              </button>
            );
          }) : (
            <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/42">
              暂无可用充值渠道。
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-white/88">订单</strong>
          <span className="text-xs text-white/42">{loadingOrders ? "加载中..." : `${billingOrders.length} 条`}</span>
        </div>
        <div className="grid gap-2">
          {billingOrders.length ? billingOrders.slice(0, 4).map((order) => (
            <button
              key={order.order_id}
              type="button"
              className={`grid gap-1 rounded-2xl border px-3 py-2 text-left transition ${
                selectedOrderId === order.order_id
                  ? "border-fuchsia-400/50 bg-fuchsia-500/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/72 hover:border-white/20 hover:text-white"
              }`}
              onClick={() => onSelectOrder(order.order_id)}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="truncate">{order.order_id}</span>
                <span className="text-xs text-white/48">{statusLabels[order.status]}</span>
              </span>
              <span className="text-xs text-white/42">
                ¥{(order.requested_amount / 100).toFixed(2)} · {formatQuota(order.credited_quota)} credits
              </span>
            </button>
          )) : (
            <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/42">
              还没有充值订单。
            </p>
          )}
        </div>

        {selectedOrder ? (
          <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm text-white/90">订单详情</strong>
              <span className="rounded-full border border-white/10 px-2 py-1 text-white/72">{statusLabels[selectedOrder.status]}</span>
            </div>
            <div className="grid gap-1">
              <span>渠道: {selectedOrder.channel}</span>
              <span>请求金额: ¥{(selectedOrder.requested_amount / 100).toFixed(2)}</span>
              <span>到账额度: {formatQuota(selectedOrder.credited_quota)}</span>
              <span>支付金额: ¥{(selectedOrder.paid_amount / 100).toFixed(2)}</span>
              <span>Provider 订单: {selectedOrder.provider_order_id}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <strong className="text-white/88">最近用量</strong>
        <div className="grid gap-2">
          {usage?.entries?.slice(0, 3).map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/56">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-white/80">{usageSummary(entry)}</span>
                <span>{entry.status}</span>
              </div>
              <div className="mt-1 text-white/38">
                预估 {formatQuota(entry.estimated_quota_units)} · 实际 {formatQuota(entry.actual_quota_units)} · {entry.operation}
              </div>
            </div>
          ))}
          {!usage?.entries?.length ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/42">
              暂无可用用量记录。
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="studio-secondary-button" onClick={onRefresh} disabled={loading || submitting}>
          <RefreshCw className="size-4" />
          刷新
        </button>
        <button type="button" className="studio-secondary-button" onClick={onLogout} disabled={!user || loading || submitting}>
          <LogOut className="size-4" />
          退出登录
        </button>
      </div>
    </div>
  );
}
