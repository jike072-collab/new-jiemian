import { checkNewApiHealth } from "./health";

export type NewApiQuotaDisplayType = "USD" | "CNY" | "TOKENS" | "CUSTOM";

export type NewApiQuotaDisplayConfig = {
  quotaPerUnit: number;
  usdExchangeRate: number;
  quotaDisplayType: NewApiQuotaDisplayType;
  customCurrencySymbol: string;
  customCurrencyExchangeRate: number;
};

const STATUS_CACHE_TTL_MS = 15_000;
const APP_CREDITS_PER_CNY = 10;
const defaultQuotaDisplayConfig: NewApiQuotaDisplayConfig = {
  quotaPerUnit: 500_000,
  usdExchangeRate: 7.3,
  quotaDisplayType: "USD",
  customCurrencySymbol: "¤",
  customCurrencyExchangeRate: 1,
};

let cachedQuotaDisplayConfig:
  | {
      config: NewApiQuotaDisplayConfig;
      expiresAt: number;
    }
  | null = null;

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function displayType(value: unknown): NewApiQuotaDisplayType {
  return value === "CNY" || value === "TOKENS" || value === "CUSTOM" || value === "USD"
    ? value
    : defaultQuotaDisplayConfig.quotaDisplayType;
}

function extractStatusData(payload: unknown) {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as { data?: unknown };
  if (root.data && typeof root.data === "object") return root.data as Record<string, unknown>;
  return payload as Record<string, unknown>;
}

function displayCurrencyRate(config: NewApiQuotaDisplayConfig) {
  if (config.quotaDisplayType === "CNY") return config.usdExchangeRate;
  if (config.quotaDisplayType === "CUSTOM") return config.customCurrencyExchangeRate;
  return 1;
}

function creditsToCnyAmount(credits: number, config: NewApiQuotaDisplayConfig) {
  if (config.quotaDisplayType === "TOKENS") return credits;
  return credits / APP_CREDITS_PER_CNY;
}

export async function getNewApiQuotaDisplayConfig(options: { now?: Date } = {}): Promise<NewApiQuotaDisplayConfig> {
  const now = options.now || new Date();
  if (cachedQuotaDisplayConfig && cachedQuotaDisplayConfig.expiresAt > now.getTime()) {
    return cachedQuotaDisplayConfig.config;
  }

  try {
    const response = await checkNewApiHealth();
    const status = extractStatusData(response.data);
    const nextConfig: NewApiQuotaDisplayConfig = {
      quotaPerUnit: positiveNumber(status.quota_per_unit, defaultQuotaDisplayConfig.quotaPerUnit),
      usdExchangeRate: positiveNumber(status.usd_exchange_rate, defaultQuotaDisplayConfig.usdExchangeRate),
      quotaDisplayType: displayType(status.quota_display_type),
      customCurrencySymbol: String(status.custom_currency_symbol || defaultQuotaDisplayConfig.customCurrencySymbol),
      customCurrencyExchangeRate: positiveNumber(
        status.custom_currency_exchange_rate,
        defaultQuotaDisplayConfig.customCurrencyExchangeRate,
      ),
    };
    cachedQuotaDisplayConfig = {
      config: nextConfig,
      expiresAt: now.getTime() + STATUS_CACHE_TTL_MS,
    };
    return nextConfig;
  } catch {
    return cachedQuotaDisplayConfig?.config || defaultQuotaDisplayConfig;
  }
}

export function newApiQuotaToDisplayAmount(rawQuota: number, config: NewApiQuotaDisplayConfig) {
  const quota = finiteNumber(rawQuota, 0);
  if (config.quotaDisplayType === "TOKENS") return quota;
  const usdAmount = quota / positiveNumber(config.quotaPerUnit, defaultQuotaDisplayConfig.quotaPerUnit);
  return usdAmount * displayCurrencyRate(config);
}

export function newApiQuotaToCredits(rawQuota: number, config: NewApiQuotaDisplayConfig) {
  const quota = finiteNumber(rawQuota, 0);
  if (config.quotaDisplayType === "TOKENS") return Math.round(quota);

  const displayAmount = newApiQuotaToDisplayAmount(quota, config);
  const cnyAmount = config.quotaDisplayType === "USD"
    ? displayAmount * config.usdExchangeRate
    : displayAmount;
  return Math.round(cnyAmount * APP_CREDITS_PER_CNY);
}

export function creditsToNewApiQuota(credits: number, config: NewApiQuotaDisplayConfig) {
  const normalizedCredits = finiteNumber(credits, 0);
  if (config.quotaDisplayType === "TOKENS") return Math.round(normalizedCredits);

  const cnyAmount = creditsToCnyAmount(normalizedCredits, config);
  const displayAmount = config.quotaDisplayType === "USD"
    ? cnyAmount / positiveNumber(config.usdExchangeRate, defaultQuotaDisplayConfig.usdExchangeRate)
    : cnyAmount;
  const usdAmount = displayAmount / displayCurrencyRate(config);
  return Math.round(usdAmount * positiveNumber(config.quotaPerUnit, defaultQuotaDisplayConfig.quotaPerUnit));
}
