import "server-only";

export type ZernioConfiguration = {
  configured: boolean;
  apiKey: string;
  apiBaseUrl: string;
  redirectUri: string;
  workerSecret: string;
  profileIds: string[];
  missing: string[];
};

export class TikTokConfigurationError extends Error {
  code = "TIKTOK_NOT_CONFIGURED";
  status = 503;

  constructor(message = "TikTok 发布尚未配置。") {
    super(message);
    this.name = "TikTokConfigurationError";
  }
}

export function getTikTokConfiguration(): ZernioConfiguration {
  const apiKey = String(process.env.ZERNIO_API_KEY || "").trim();
  const redirectUri = String(process.env.ZERNIO_TIKTOK_REDIRECT_URI || "").trim();
  const apiBaseUrl = String(process.env.ZERNIO_API_BASE_URL || "https://zernio.com/api").trim().replace(/\/+$/, "");
  const workerSecret = String(process.env.TIKTOK_WORKER_SECRET || "").trim();
  const profileIds = Array.from(new Set(String(process.env.ZERNIO_PROFILE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean)));
  const missing = [
    ["ZERNIO_API_KEY", apiKey],
    ["ZERNIO_TIKTOK_REDIRECT_URI", redirectUri],
    ["TIKTOK_WORKER_SECRET", workerSecret],
    ["ZERNIO_PROFILE_IDS", profileIds.join(",")],
  ].flatMap(([name, value]) => value ? [] : [name]);
  return { configured: missing.length === 0, apiKey, apiBaseUrl, redirectUri, workerSecret, profileIds, missing };
}

export function requireTikTokConfiguration() {
  const config = getTikTokConfiguration();
  if (!config.configured) throw new TikTokConfigurationError();
  try {
    const redirect = new URL(config.redirectUri);
    const apiBase = new URL(config.apiBaseUrl);
    if (!["http:", "https:"].includes(apiBase.protocol)) throw new Error("invalid API protocol");
    if (config.profileIds.some((id) => !/^[A-Za-z0-9_-]{4,255}$/.test(id))) throw new Error("invalid profile id");
    if (process.env.NODE_ENV === "production" && redirect.protocol !== "https:") {
      throw new TikTokConfigurationError("TikTok 回调地址必须使用 HTTPS。");
    }
  } catch (error) {
    if (error instanceof TikTokConfigurationError) throw error;
    throw new TikTokConfigurationError("Zernio API 地址或 TikTok 回调地址配置无效。");
  }
  return config;
}
