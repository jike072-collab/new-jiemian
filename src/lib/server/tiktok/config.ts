import "server-only";

export type ZernioConfiguration = {
  configured: boolean;
  apiKey: string;
  apiBaseUrl: string;
  redirectUri: string;
  workerSecret: string;
  profileIds: string[];
  credentials: ZernioCredential[];
  missing: string[];
};

export type ZernioCredential = {
  id: string;
  apiKey: string;
  profileIds: string[];
  displayName?: string;
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
  const extraCredentialsValue = String(process.env.ZERNIO_EXTRA_CREDENTIALS_JSON || "").trim();
  const extraCredentials = parseExtraCredentials(extraCredentialsValue);
  const missing = [
    ["ZERNIO_API_KEY", apiKey],
    ["ZERNIO_TIKTOK_REDIRECT_URI", redirectUri],
    ["TIKTOK_WORKER_SECRET", workerSecret],
    ["ZERNIO_PROFILE_IDS", profileIds.join(",")],
  ].flatMap(([name, value]) => value ? [] : [name]);
  if (extraCredentialsValue && !extraCredentials) missing.push("ZERNIO_EXTRA_CREDENTIALS_JSON");
  const credentials = [
    { id: "default", apiKey, profileIds },
    ...(extraCredentials || []),
  ];
  return { configured: missing.length === 0, apiKey, apiBaseUrl, redirectUri, workerSecret, profileIds, credentials, missing };
}

export function requireTikTokConfiguration() {
  const config = getTikTokConfiguration();
  if (!config.configured) throw new TikTokConfigurationError();
  try {
    const redirect = new URL(config.redirectUri);
    const apiBase = new URL(config.apiBaseUrl);
    if (!["http:", "https:"].includes(apiBase.protocol)) throw new Error("invalid API protocol");
    if (config.credentials.some((credential) => (
      !/^[A-Za-z0-9_-]{2,64}$/.test(credential.id)
      || !credential.apiKey
      || !credential.profileIds.length
      || credential.profileIds.some((id) => !/^[A-Za-z0-9_-]{4,255}$/.test(id))
    ))) throw new Error("invalid credential");
    if (process.env.NODE_ENV === "production" && redirect.protocol !== "https:") {
      throw new TikTokConfigurationError("TikTok 回调地址必须使用 HTTPS。");
    }
  } catch (error) {
    if (error instanceof TikTokConfigurationError) throw error;
    throw new TikTokConfigurationError("Zernio API 地址或 TikTok 回调地址配置无效。");
  }
  return config;
}

export function requireZernioCredential(credentialId: string) {
  const config = requireTikTokConfiguration();
  const credential = config.credentials.find((candidate) => candidate.id === credentialId);
  if (!credential) throw new TikTokConfigurationError("TikTok 账号所属的 Zernio 凭据未配置。");
  return { ...credential, apiBaseUrl: config.apiBaseUrl };
}

function parseExtraCredentials(value: string): ZernioCredential[] | null {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const credentials = parsed.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("invalid credential");
      const candidate = entry as Record<string, unknown>;
      const id = String(candidate.id || "").trim();
      const apiKey = String(candidate.apiKey || "").trim();
      const displayName = String(candidate.displayName || "").trim() || undefined;
      const profileIds = Array.from(new Set(Array.isArray(candidate.profileIds)
        ? candidate.profileIds.map((profileId) => String(profileId).trim()).filter(Boolean)
        : []));
      if (!id || !apiKey || !profileIds.length) throw new Error("invalid credential");
      return { id, apiKey, profileIds, displayName };
    });
    if (new Set(credentials.map((credential) => credential.id)).size !== credentials.length) return null;
    if (credentials.some((credential) => credential.id === "default")) return null;
    return credentials;
  } catch {
    return null;
  }
}
