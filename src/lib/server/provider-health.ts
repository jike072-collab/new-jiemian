import { modelsEndpointFor } from "./providers";
import { getNewApiConfig } from "./integrations/new-api/config";
import { type EndpointType, type ProviderConfig, type ProviderKind } from "./types";

export type ProviderHealthMode = "static" | "connectivity" | "models";
export type ProviderHealthStatus = "ok" | "warning" | "error" | "unknown";
export type ProviderHealthSeverity = "info" | "warning" | "error";
export type ProviderModelAvailability = "unknown" | "yes" | "no";
export type ProviderModelKind = "image" | "imageEdit" | "video" | "imageUpscale" | "videoUpscale";
export type ProviderReachability = "unchecked" | "reachable" | "unreachable" | "skipped";
export type NewApiReachability = "unchecked" | "reachable" | "unreachable" | "skipped";

export type ProviderHealthIssueCode =
  | "PROVIDER_MISSING_ENDPOINT"
  | "PROVIDER_INVALID_ENDPOINT"
  | "PROVIDER_MISSING_API_KEY"
  | "PROVIDER_DISABLED"
  | "PROVIDER_DUPLICATE_ID"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_ERROR"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_FORBIDDEN"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_BAD_RESPONSE"
  | "PROVIDER_NON_JSON_RESPONSE"
  | "MODEL_LIST_UNAVAILABLE"
  | "MODEL_LIST_SKIPPED"
  | "MODEL_LIST_EMPTY"
  | "MODEL_MISSING_IMAGE"
  | "MODEL_MISSING_IMAGE_EDIT"
  | "MODEL_MISSING_VIDEO"
  | "MODEL_MISSING_IMAGE_UPSCALE"
  | "MODEL_MISSING_VIDEO_UPSCALE"
  | "MODEL_NOT_FOUND"
  | "PROVIDER_EMPTY_VALUE"
  | "PROVIDER_TRIMMED_VALUE"
  | "PROVIDER_ENVIRONMENT_MIXED"
  | "NEW_API_NOT_CONFIGURED"
  | "NEW_API_CONNECTIVITY_SKIPPED"
  | "NEW_API_CONFIG_INVALID"
  | "LIVE_GENERATION_DISABLED"
  | "UNKNOWN_ERROR";

export type ProviderHealthIssue = {
  severity: ProviderHealthSeverity;
  code: ProviderHealthIssueCode;
  message: string;
  details?: string;
};

export type ProviderHealthEndpoint = {
  configured: boolean;
  maskedHost: string;
  validUrl: boolean;
};

export type ProviderHealthApiKey = {
  configured: boolean;
  masked: string;
};

export type ProviderHealthModel = {
  configured: boolean;
  model: string;
  available: ProviderModelAvailability;
};

export type ProviderHealthResult = {
  providerId: string;
  providerName: string;
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  configured: boolean;
  reachable: ProviderReachability;
  authConfigured: boolean;
  modelsConfigured: boolean;
  supportedTools: string[];
  endpointType: EndpointType;
  endpoint: ProviderHealthEndpoint;
  apiKey: ProviderHealthApiKey;
  models: Record<ProviderModelKind, ProviderHealthModel>;
  status: ProviderHealthStatus;
  issues: ProviderHealthIssue[];
  warnings: ProviderHealthIssue[];
  errors: ProviderHealthIssue[];
  checkedAt: string;
  lastCheck: {
    status: ProviderHealthStatus;
    durationMs: number;
  };
};

export type ProviderModelKindSummary = {
  configured: number;
  missing: number;
  unavailable: number;
  unknown: number;
  providerIds: string[];
  missingProviderIds: string[];
  unavailableProviderIds: string[];
};

export type NewApiHealthSummary = {
  configured: boolean;
  baseUrlConfigured: boolean;
  adminConfigured: boolean;
  reachable: NewApiReachability;
  checked: boolean;
  skippedReason: string;
  warnings: ProviderHealthIssue[];
  errors: ProviderHealthIssue[];
};

export type ProviderHealthReport = {
  ok: boolean;
  checkedAt: string;
  mode: ProviderHealthMode;
  providers: ProviderHealthResult[];
  modelHealth: Record<ProviderModelKind, ProviderModelKindSummary>;
  newApi: NewApiHealthSummary;
  summary: {
    total: number;
    ok: number;
    warning: number;
    error: number;
    unknown: number;
  };
  liveGenerationEnabled: false;
};

export type ProviderHealthOptions = {
  mode?: ProviderHealthMode;
  providers: ProviderConfig[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: Date;
  allowLiveGeneration?: boolean;
  allowExternalProviderModelList?: boolean;
};

type ModelIdsResult = {
  ids: string[];
  itemCount: number;
};

type ModelListResult = {
  ok: boolean;
  status: ProviderHealthStatus;
  issues: ProviderHealthIssue[];
  availableModelIds: Set<string>;
  responseEmpty?: boolean;
};

const providerModelKinds: ProviderModelKind[] = ["image", "imageEdit", "video", "imageUpscale", "videoUpscale"];
const connectivityTimeoutMs = 2500;
const modelListTimeoutMs = 3500;
const defaultMaxResponseBytes = 256 * 1024;

export const providerHealthIssueMessages: Record<ProviderHealthIssueCode, string> = {
  PROVIDER_MISSING_ENDPOINT: "供应商缺少 endpoint。",
  PROVIDER_INVALID_ENDPOINT: "供应商 endpoint 不是有效的 http/https URL。",
  PROVIDER_MISSING_API_KEY: "供应商缺少 API Key。",
  PROVIDER_DISABLED: "供应商已停用。",
  PROVIDER_DUPLICATE_ID: "供应商 ID 重复。",
  PROVIDER_TIMEOUT: "供应商连接超时。",
  PROVIDER_NETWORK_ERROR: "供应商网络不可达。",
  PROVIDER_AUTH_FAILED: "供应商认证失败。",
  PROVIDER_FORBIDDEN: "供应商权限不足。",
  PROVIDER_RATE_LIMITED: "供应商返回限流。",
  PROVIDER_BAD_RESPONSE: "供应商返回异常响应。",
  PROVIDER_NON_JSON_RESPONSE: "供应商返回非 JSON 响应。",
  MODEL_LIST_UNAVAILABLE: "模型列表接口不可用。",
  MODEL_LIST_SKIPPED: "模型列表外部探测已跳过。",
  MODEL_LIST_EMPTY: "模型列表为空。",
  MODEL_MISSING_IMAGE: "图片生成模型未配置。",
  MODEL_MISSING_IMAGE_EDIT: "图片编辑模型未配置。",
  MODEL_MISSING_VIDEO: "视频生成模型未配置。",
  MODEL_MISSING_IMAGE_UPSCALE: "图片高清配置未配置。",
  MODEL_MISSING_VIDEO_UPSCALE: "视频高清配置未配置。",
  MODEL_NOT_FOUND: "所需模型未在模型列表中找到。",
  PROVIDER_EMPTY_VALUE: "供应商配置存在空字符串。",
  PROVIDER_TRIMMED_VALUE: "供应商配置存在前后空格。",
  PROVIDER_ENVIRONMENT_MIXED: "供应商配置可能混用 staging/production。",
  NEW_API_NOT_CONFIGURED: "NewAPI 未配置。",
  NEW_API_CONNECTIVITY_SKIPPED: "NewAPI 连接探测已跳过。",
  NEW_API_CONFIG_INVALID: "NewAPI 配置无效。",
  LIVE_GENERATION_DISABLED: "真实生成检测在本阶段默认关闭。",
  UNKNOWN_ERROR: "未知错误。",
};

export function providerHealthIssueMessage(code: ProviderHealthIssueCode) {
  return providerHealthIssueMessages[code] || providerHealthIssueMessages.UNKNOWN_ERROR;
}

function issue(
  code: ProviderHealthIssueCode,
  severity: ProviderHealthSeverity = "error",
  details = "",
): ProviderHealthIssue {
  return {
    severity,
    code,
    message: providerHealthIssueMessage(code),
    ...(details ? { details: redact(details) } : {}),
  };
}

function redact(value: unknown) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key|signature|apiKey|api_key)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s,}]+/gi, "postgresql://[REDACTED]")
    .slice(0, 300);
}

function hasValue(value: unknown) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "replace_me");
}

function envValue(name: string) {
  return process.env[name]?.trim() || "";
}

function hasVolcengineEnvPair() {
  return (hasValue(envValue("VOLCENGINE_ACCESS_KEY_ID")) && hasValue(envValue("VOLCENGINE_SECRET_ACCESS_KEY")))
    || (hasValue(envValue("VOLC_ACCESSKEY")) && hasValue(envValue("VOLC_SECRETKEY")));
}

function usesVolcengineKeyPair(provider: ProviderConfig) {
  return provider.endpointType === "volcengine-imagex-upscale" || provider.endpointType === "volcengine-vod-upscale";
}

function apiKeyConfigured(provider: ProviderConfig) {
  return hasValue(provider.apiKey) || (usesVolcengineKeyPair(provider) && hasVolcengineEnvPair());
}

function maskApiKey(provider: ProviderConfig) {
  const text = String(provider.apiKey || "").trim();
  if (!hasValue(text)) return apiKeyConfigured(provider) ? "configured" : "";
  if (text.length <= 4) return "****";
  const suffix = text.slice(-4);
  return `****${suffix}`;
}

function trimText(value: unknown) {
  return String(value || "").trim();
}

function endpointHost(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    return parsed.host;
  } catch {
    return "";
  }
}

function endpointOriginUrl(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function connectivityUrlFor(provider: ProviderConfig) {
  if (
    provider.endpointType === "images-generations"
    || provider.endpointType === "images-edits"
    || provider.endpointType === "videos-generations"
    || provider.endpointType === "grok-videos"
    || provider.endpointType === "chat-completions"
  ) {
    return modelsEndpointFor(provider.apiUrl) || endpointOriginUrl(provider.apiUrl);
  }
  return endpointOriginUrl(provider.apiUrl);
}

function supportsModelList(provider: ProviderConfig) {
  return provider.endpointType === "images-generations"
    || provider.endpointType === "images-edits"
    || provider.endpointType === "videos-generations"
    || provider.endpointType === "grok-videos"
    || provider.endpointType === "chat-completions";
}

function validateHttpUrl(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function modelKindsFor(provider: ProviderConfig): ProviderModelKind[] {
  if (provider.endpointType === "images-edits") return ["imageEdit"];
  if (provider.endpointType === "images-generations") return ["image", "imageEdit"];
  if (provider.endpointType === "videos-generations" || provider.endpointType === "grok-videos") return ["video"];
  if (provider.endpointType === "volcengine-imagex-upscale") return ["imageUpscale"];
  if (provider.endpointType === "volcengine-vod-upscale") return ["videoUpscale"];
  if (provider.kind === "image") return ["image"];
  if (provider.kind === "video") return ["video"];
  if (provider.kind === "image-upscale") return ["imageUpscale"];
  if (provider.kind === "video-upscale") return ["videoUpscale"];
  return [];
}

function toolForModelKind(kind: ProviderModelKind) {
  if (kind === "image") return "image";
  if (kind === "imageEdit") return "image-edit";
  if (kind === "video") return "video";
  if (kind === "imageUpscale") return "image-upscale";
  return "video-upscale";
}

function missingModelCode(kind: ProviderModelKind): ProviderHealthIssueCode {
  if (kind === "image") return "MODEL_MISSING_IMAGE";
  if (kind === "imageEdit") return "MODEL_MISSING_IMAGE_EDIT";
  if (kind === "video") return "MODEL_MISSING_VIDEO";
  if (kind === "imageUpscale") return "MODEL_MISSING_IMAGE_UPSCALE";
  return "MODEL_MISSING_VIDEO_UPSCALE";
}

function emptyModels(): Record<ProviderModelKind, ProviderHealthModel> {
  return {
    image: { configured: false, model: "", available: "unknown" },
    imageEdit: { configured: false, model: "", available: "unknown" },
    video: { configured: false, model: "", available: "unknown" },
    imageUpscale: { configured: false, model: "", available: "unknown" },
    videoUpscale: { configured: false, model: "", available: "unknown" },
  };
}

function modelsForProvider(provider: ProviderConfig) {
  const models = emptyModels();
  for (const kind of modelKindsFor(provider)) {
    const model = trimText(provider.model);
    models[kind] = {
      configured: hasValue(model),
      model,
      available: "unknown",
    };
  }
  return models;
}

function statusFromIssues(issues: ProviderHealthIssue[]): ProviderHealthStatus {
  if (issues.some((item) => item.severity === "error")) return "error";
  if (issues.some((item) => item.severity === "warning")) return "warning";
  return "ok";
}

function warningsFromIssues(issues: ProviderHealthIssue[]) {
  return issues.filter((item) => item.severity === "warning");
}

function errorsFromIssues(issues: ProviderHealthIssue[]) {
  return issues.filter((item) => item.severity === "error");
}

function finalizeProviderResult(result: ProviderHealthResult): ProviderHealthResult {
  const status = statusFromIssues(result.issues);
  return {
    ...result,
    status,
    warnings: warningsFromIssues(result.issues),
    errors: errorsFromIssues(result.issues),
    lastCheck: {
      ...result.lastCheck,
      status,
    },
  };
}

function summarize(providers: ProviderHealthResult[]) {
  return {
    total: providers.length,
    ok: providers.filter((provider) => provider.status === "ok").length,
    warning: providers.filter((provider) => provider.status === "warning").length,
    error: providers.filter((provider) => provider.status === "error").length,
    unknown: providers.filter((provider) => provider.status === "unknown").length,
  };
}

function summarizeModelKind(providers: ProviderHealthResult[], kind: ProviderModelKind): ProviderModelKindSummary {
  const relevant = providers.filter((provider) => provider.supportedTools.includes(toolForModelKind(kind)));
  const configuredProviders = relevant.filter((provider) => provider.models[kind].configured);
  const unavailableProviders = configuredProviders.filter((provider) => provider.models[kind].available === "no");
  const unknownProviders = configuredProviders.filter((provider) => provider.models[kind].available === "unknown");
  const missingProviders = relevant.filter((provider) => !provider.models[kind].configured);
  return {
    configured: configuredProviders.length,
    missing: missingProviders.length,
    unavailable: unavailableProviders.length,
    unknown: unknownProviders.length,
    providerIds: relevant.map((provider) => provider.providerId),
    missingProviderIds: missingProviders.map((provider) => provider.providerId),
    unavailableProviderIds: unavailableProviders.map((provider) => provider.providerId),
  };
}

function summarizeModelHealth(providers: ProviderHealthResult[]): Record<ProviderModelKind, ProviderModelKindSummary> {
  return {
    image: summarizeModelKind(providers, "image"),
    imageEdit: summarizeModelKind(providers, "imageEdit"),
    video: summarizeModelKind(providers, "video"),
    imageUpscale: summarizeModelKind(providers, "imageUpscale"),
    videoUpscale: summarizeModelKind(providers, "videoUpscale"),
  };
}

function inspectNewApiConfig(): NewApiHealthSummary {
  try {
    const config = getNewApiConfig();
    const configured = Boolean(config.enabled && config.baseUrl);
    return {
      configured,
      baseUrlConfigured: Boolean(config.baseUrl),
      adminConfigured: Boolean(config.adminAccessToken && config.adminUserId),
      reachable: "skipped",
      checked: false,
      skippedReason: "Stage 8A 仅做只读配置检查；NewAPI 外部连接探测需单独授权。",
      warnings: configured ? [issue("NEW_API_CONNECTIVITY_SKIPPED", "warning")] : [issue("NEW_API_NOT_CONFIGURED", "warning")],
      errors: [],
    };
  } catch (error) {
    return {
      configured: false,
      baseUrlConfigured: false,
      adminConfigured: false,
      reachable: "skipped",
      checked: false,
      skippedReason: "NewAPI 配置解析失败，已跳过外部连接探测。",
      warnings: [issue("NEW_API_CONNECTIVITY_SKIPPED", "warning")],
      errors: [issue("NEW_API_CONFIG_INVALID", "error", error instanceof Error ? error.message : String(error))],
    };
  }
}

function hasTrimRisk(value: unknown) {
  const text = String(value ?? "");
  return Boolean(text && text !== text.trim());
}

function staticIssues(provider: ProviderConfig, duplicateIds: Set<string>) {
  const issues: ProviderHealthIssue[] = [];
  const endpoint = trimText(provider.apiUrl);

  if (duplicateIds.has(trimText(provider.id))) issues.push(issue("PROVIDER_DUPLICATE_ID"));
  if (!hasValue(provider.id)) issues.push(issue("PROVIDER_EMPTY_VALUE", "warning"));
  if (!provider.enabled) issues.push(issue("PROVIDER_DISABLED", "warning"));
  if (!hasValue(endpoint)) issues.push(issue("PROVIDER_MISSING_ENDPOINT"));
  else if (!validateHttpUrl(endpoint)) issues.push(issue("PROVIDER_INVALID_ENDPOINT"));
  if (!apiKeyConfigured(provider)) issues.push(issue("PROVIDER_MISSING_API_KEY"));
  if (!hasValue(provider.title) || !hasValue(provider.role)) issues.push(issue("PROVIDER_EMPTY_VALUE", "warning"));
  if (hasTrimRisk(provider.id) || hasTrimRisk(provider.title) || hasTrimRisk(provider.role) || hasTrimRisk(provider.apiUrl) || hasTrimRisk(provider.model)) {
    issues.push(issue("PROVIDER_TRIMMED_VALUE", "warning"));
  }
  if (/staging|preview|test/i.test(endpoint) && /production|prod/i.test(endpoint)) {
    issues.push(issue("PROVIDER_ENVIRONMENT_MIXED", "warning"));
  }

  const models = modelsForProvider(provider);
  for (const kind of providerModelKinds) {
    if (modelKindsFor(provider).includes(kind) && !models[kind].configured) {
      issues.push(issue(missingModelCode(kind)));
    }
  }
  return { issues, models };
}

function duplicateProviderIds(providers: ProviderConfig[]) {
  const counts = new Map<string, number>();
  for (const provider of providers) {
    const id = trimText(provider.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

function baseResult(provider: ProviderConfig, duplicateIds: Set<string>, checkedAt: string): ProviderHealthResult {
  const endpoint = trimText(provider.apiUrl);
  const validUrl = validateHttpUrl(endpoint);
  const { issues, models } = staticIssues(provider, duplicateIds);
  const supportedModelKinds = modelKindsFor(provider);
  const supportedTools = supportedModelKinds.map(toolForModelKind);
  const authConfigured = apiKeyConfigured(provider);
  const modelsConfigured = supportedModelKinds.length > 0
    && supportedModelKinds.every((kind) => models[kind].configured);
  const status = statusFromIssues(issues);
  return finalizeProviderResult({
    providerId: trimText(provider.id),
    providerName: trimText(provider.title) || trimText(provider.id),
    id: trimText(provider.id),
    name: trimText(provider.title) || trimText(provider.id),
    kind: provider.kind,
    enabled: Boolean(provider.enabled),
    configured: Boolean(validUrl && authConfigured && modelsConfigured),
    reachable: "unchecked",
    authConfigured,
    modelsConfigured,
    supportedTools,
    endpointType: provider.endpointType,
    endpoint: {
      configured: hasValue(endpoint),
      maskedHost: validUrl ? endpointHost(endpoint) : "",
      validUrl,
    },
    apiKey: {
      configured: authConfigured,
      masked: maskApiKey(provider),
    },
    models,
    status,
    issues,
    warnings: [],
    errors: [],
    checkedAt,
    lastCheck: {
      status,
      durationMs: 0,
    },
  });
}

async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function mapStatusIssue(status: number, context: "connectivity" | "models"): ProviderHealthIssue {
  if (status === 401) return issue("PROVIDER_AUTH_FAILED");
  if (status === 403) return issue("PROVIDER_FORBIDDEN");
  if (status === 404 && context === "models") return issue("MODEL_LIST_UNAVAILABLE");
  if (status === 429) return issue("PROVIDER_RATE_LIMITED", "warning");
  if (status >= 400) return issue("PROVIDER_BAD_RESPONSE", "warning", `HTTP ${status}`);
  return issue("UNKNOWN_ERROR", "warning", `HTTP ${status}`);
}

function isTimeoutError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

async function checkConnectivity(provider: ProviderConfig, fetchImpl: typeof fetch, timeoutMs: number) {
  const startedAt = Date.now();
  try {
    const targetUrl = connectivityUrlFor(provider) || provider.apiUrl;
    const response = await safeFetch(fetchImpl, targetUrl, {
      method: "HEAD",
      headers: { Accept: "application/json" },
    }, timeoutMs);
    const durationMs = Date.now() - startedAt;
    if (response.ok || response.status === 405) {
      return { status: "ok" as const, issues: [] as ProviderHealthIssue[], durationMs };
    }
    const mapped = mapStatusIssue(response.status, "connectivity");
    return { status: statusFromIssues([mapped]), issues: [mapped], durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const mapped = isTimeoutError(error)
      ? issue("PROVIDER_TIMEOUT")
      : issue("PROVIDER_NETWORK_ERROR", "error", error instanceof Error ? error.message : String(error));
    return { status: "error" as const, issues: [mapped], durationMs };
  }
}

async function readLimitedText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function extractModelIds(payload: unknown): ModelIdsResult {
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const data = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(payload)
        ? payload
        : [];
  return {
    itemCount: data.length,
    ids: data
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const record = item as Record<string, unknown>;
      return String(record.id || record.model || record.name || "").trim();
    })
      .filter(Boolean),
  };
}

function contentTypeIsJson(response: Response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("application/json");
}

async function checkModelList(
  provider: ProviderConfig,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<ModelListResult> {
  if (!supportsModelList(provider)) {
    return {
      ok: false,
      status: "warning",
      issues: [issue("MODEL_LIST_UNAVAILABLE", "warning")],
      availableModelIds: new Set(),
    };
  }
  const targetUrl = modelsEndpointFor(provider.apiUrl);
  if (!targetUrl) {
    return {
      ok: false,
      status: "warning",
      issues: [issue("MODEL_LIST_UNAVAILABLE", "warning")],
      availableModelIds: new Set(),
    };
  }
  try {
    const response = await safeFetch(fetchImpl, targetUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
    }, timeoutMs);
    if (!response.ok) {
      const mapped = mapStatusIssue(response.status, "models");
      return { ok: false, status: statusFromIssues([mapped]), issues: [mapped], availableModelIds: new Set() };
    }
    if (!contentTypeIsJson(response)) {
      return {
        ok: false,
        status: "warning",
        issues: [issue("PROVIDER_NON_JSON_RESPONSE", "warning")],
        availableModelIds: new Set(),
      };
    }
    const text = await readLimitedText(response, maxResponseBytes);
    const payload = JSON.parse(text || "{}") as unknown;
    const modelIds = extractModelIds(payload);
    if (!modelIds.ids.length && modelIds.itemCount > 0) {
      return {
        ok: false,
        status: "warning",
        issues: [issue("PROVIDER_BAD_RESPONSE", "warning")],
        availableModelIds: new Set(),
      };
    }
    if (!modelIds.ids.length) {
      return {
        ok: false,
        status: "warning",
        issues: [issue("MODEL_LIST_EMPTY", "warning")],
        availableModelIds: new Set(),
        responseEmpty: true,
      };
    }
    return {
      ok: true,
      status: "ok",
      issues: [],
      availableModelIds: new Set(modelIds.ids),
    };
  } catch (error) {
    const mapped = isTimeoutError(error)
      ? issue("PROVIDER_TIMEOUT")
      : error instanceof SyntaxError
        ? issue("PROVIDER_BAD_RESPONSE", "warning")
        : String(error instanceof Error ? error.message : error) === "response_too_large"
          ? issue("PROVIDER_BAD_RESPONSE", "warning", "response_too_large")
          : issue("PROVIDER_NETWORK_ERROR", "error", error instanceof Error ? error.message : String(error));
    return { ok: false, status: statusFromIssues([mapped]), issues: [mapped], availableModelIds: new Set() };
  }
}

function mergeIssues(left: ProviderHealthIssue[], right: ProviderHealthIssue[]) {
  const seen = new Set(left.map((item) => `${item.code}:${item.details || ""}`));
  const merged = [...left];
  for (const item of right) {
    const key = `${item.code}:${item.details || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function applyModelList(result: ProviderHealthResult, modelList: ModelListResult) {
  const next = { ...result, models: { ...result.models } };
  for (const kind of providerModelKinds) {
    const model = next.models[kind];
    if (!model.configured) continue;
    if (modelList.ok) {
      const available = modelList.availableModelIds.has(model.model) ? "yes" : "no";
      next.models[kind] = { ...model, available };
      if (available === "no") {
        next.issues = mergeIssues(next.issues, [issue("MODEL_NOT_FOUND", "warning", `${kind}:${model.model}`)]);
      }
    } else {
      next.models[kind] = { ...model, available: "unknown" };
    }
  }
  next.issues = mergeIssues(next.issues, modelList.issues);
  return finalizeProviderResult(next);
}

function skipExternalModelList(result: ProviderHealthResult) {
  return finalizeProviderResult({
    ...result,
    reachable: "skipped",
    issues: mergeIssues(result.issues, [issue("MODEL_LIST_SKIPPED", "warning")]),
    lastCheck: {
      ...result.lastCheck,
      status: "warning",
    },
  });
}

async function checkProvider(
  provider: ProviderConfig,
  duplicateIds: Set<string>,
  options: Required<Pick<ProviderHealthOptions, "mode" | "fetchImpl" | "timeoutMs" | "maxResponseBytes">> & { checkedAt: string; allowExternalProviderModelList: boolean },
) {
  const startedAt = Date.now();
  let result = baseResult(provider, duplicateIds, options.checkedAt);

  if (options.mode === "connectivity" && result.endpoint.validUrl) {
    const connectivity = await checkConnectivity(provider, options.fetchImpl, options.timeoutMs);
    result = {
      ...result,
      reachable: connectivity.status === "ok" ? "reachable" : "unreachable",
      issues: mergeIssues(result.issues, connectivity.issues),
      lastCheck: {
        status: connectivity.status,
        durationMs: connectivity.durationMs,
      },
    };
    result.status = statusFromIssues(result.issues);
    result.lastCheck.status = result.status;
  }

  if (options.mode === "models" && result.endpoint.validUrl && result.apiKey.configured) {
    if (!options.allowExternalProviderModelList) {
      result = skipExternalModelList(result);
    } else {
      const modelList = await checkModelList(provider, options.fetchImpl, options.timeoutMs, options.maxResponseBytes);
      result = applyModelList({
        ...result,
        reachable: modelList.ok ? "reachable" : "unreachable",
      }, modelList);
    }
  }

  result.lastCheck.durationMs = Math.max(result.lastCheck.durationMs, Date.now() - startedAt);
  return finalizeProviderResult(result);
}

export async function checkProviderHealth(input: ProviderHealthOptions): Promise<ProviderHealthReport> {
  const mode = input.mode || "static";
  if (input.allowLiveGeneration) {
    throw new Error("Stage 4 does not support live generation checks.");
  }
  const fetchImpl = input.fetchImpl || fetch;
  const timeoutMs = input.timeoutMs || (mode === "models" ? modelListTimeoutMs : connectivityTimeoutMs);
  const maxResponseBytes = input.maxResponseBytes || defaultMaxResponseBytes;
  const duplicateIds = duplicateProviderIds(input.providers);
  const checkedAt = (input.now || new Date()).toISOString();
  const providers = await Promise.all(input.providers.map((provider) => checkProvider(provider, duplicateIds, {
    mode,
    fetchImpl,
    timeoutMs,
    maxResponseBytes,
    allowExternalProviderModelList: Boolean(input.allowExternalProviderModelList),
    checkedAt,
  })));
  const summary = summarize(providers);
  const newApi = inspectNewApiConfig();
  return {
    ok: summary.error === 0 && newApi.errors.length === 0,
    checkedAt,
    mode,
    providers,
    modelHealth: summarizeModelHealth(providers),
    newApi,
    summary,
    liveGenerationEnabled: false,
  };
}
