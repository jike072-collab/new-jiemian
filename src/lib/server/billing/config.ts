import { type PaymentChannelConfig, type PublicPaymentChannelConfig } from "./types";

const sandboxChannels: PaymentChannelConfig[] = [
  {
    channel: "sandbox_alipay",
    name: "Sandbox Alipay",
    display_color: "#1677ff",
    min_amount: 500,
    fixed_amounts: [500, 1000, 3000, 5000, 10000],
    custom_amount_range: {
      min_amount: 500,
      max_amount: 200000,
    },
    discounts: [
      { threshold_amount: 3000, multiplier_basis_points: 10500 },
      { threshold_amount: 10000, multiplier_basis_points: 11200 },
    ],
    currency: "CNY",
    enabled: true,
    sort_order: 10,
    quota_units_per_minor_unit: 10,
  },
  {
    channel: "sandbox_wechat",
    name: "Sandbox WeChat Pay",
    display_color: "#07c160",
    min_amount: 500,
    fixed_amounts: [500, 1000, 3000, 5000, 10000],
    custom_amount_range: {
      min_amount: 500,
      max_amount: 200000,
    },
    discounts: [
      { threshold_amount: 5000, multiplier_basis_points: 10600 },
      { threshold_amount: 20000, multiplier_basis_points: 11500 },
    ],
    currency: "CNY",
    enabled: true,
    sort_order: 20,
    quota_units_per_minor_unit: 10,
  },
];

export const BILLING_WEBHOOK_TOLERANCE_SECONDS = 300;

export function listPaymentChannels() {
  return sandboxChannels
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((channel) => ({ ...channel, fixed_amounts: channel.fixed_amounts.slice(), discounts: channel.discounts.slice() }));
}

export function publicPaymentChannels(): PublicPaymentChannelConfig[] {
  return listPaymentChannels().map(({ quota_units_per_minor_unit: quotaUnits, ...channel }) => ({
    ...channel,
    estimated_quota_units_per_minor_unit: quotaUnits,
  }));
}

export function getPaymentChannel(channel: string) {
  return listPaymentChannels().find((entry) => entry.channel === channel) || null;
}

export function sandboxWebhookSecret() {
  return process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET || "";
}

export function assertSandboxWebhookEnabled() {
  const secret = sandboxWebhookSecret();
  if (!secret.trim()) {
    throw new Error("PAYMENT_SANDBOX_WEBHOOK_SECRET is required for sandbox webhooks.");
  }
  return secret;
}

export function calculateCreditedQuota(channel: PaymentChannelConfig, amount: number) {
  const bestDiscount = channel.discounts
    .filter((discount) => amount >= discount.threshold_amount)
    .sort((a, b) => b.threshold_amount - a.threshold_amount)[0];
  const multiplier = bestDiscount?.multiplier_basis_points || 10000;
  return Math.floor((amount * channel.quota_units_per_minor_unit * multiplier) / 10000);
}

export function amountAllowed(channel: PaymentChannelConfig, amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (amount < channel.min_amount) return false;
  if (channel.fixed_amounts.includes(amount)) return true;
  return amount >= channel.custom_amount_range.min_amount && amount <= channel.custom_amount_range.max_amount;
}
