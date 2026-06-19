import { join } from "node:path";

import {
  type EndpointType,
  type ProviderConfig,
  type ProviderKind,
  type ProviderUpdate,
  type PublicProvider,
} from "./types";
import { dataRoot, readJsonFile, writeJsonFile } from "./paths";

const providersPath = join(dataRoot, "providers.json");
const virtualModelSeparator = "::model::";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function hasKey(value: string) {
  return Boolean(value && value.trim() && value.trim() !== "replace_me");
}

function normalizeModels(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

function normalizeModelDisplayNames(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([model, displayName]) => [
      String(model || "").trim(),
      String(displayName || "").trim(),
    ] as const)
    .filter(([model, displayName]) => model && displayName);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function isLocalProvider(endpointType: EndpointType) {
  return endpointType === "upscayl-cli" || endpointType === "video2x-cli";
}

export function maskedKeyPreview(value: string) {
  if (!hasKey(value)) return "";
  const suffix = value.trim().slice(-4);
  return `•••• ${suffix}`;
}

export function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: "image-main",
      kind: "image",
      title: "图片生成",
      role: "文生图与图生图/图片编辑",
      apiUrl: env("IMAGE_API_URL", "https://www.right.codes/draw/v1/images/generations"),
      model: env("IMAGE_MODEL", "gpt-image-2"),
      apiKey: env("IMAGE_MODEL_API_KEY"),
      enabled: hasKey(env("IMAGE_MODEL_API_KEY")),
      endpointType: (env("IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
    },
    {
      id: "video-main",
      kind: "video",
      title: "视频生成",
      role: "文生视频与图生视频",
      apiUrl: env("VIDEO_API_URL", "https://clmm-mall.top/v1/videos/generations"),
      model: env("VIDEO_MODEL", "seedance2.0 720p-fast-sr"),
      apiKey: env("VIDEO_MODEL_API_KEY"),
      enabled: hasKey(env("VIDEO_MODEL_API_KEY")),
      endpointType: (env("VIDEO_ENDPOINT_TYPE", "videos-generations") as EndpointType),
    },
    {
      id: "video-grok",
      kind: "video",
      title: "Grok 视频",
      role: "Grok 文生视频与图生视频",
      apiUrl: env("GROK_VIDEO_API_URL", "https://api.manxiaobai.online/v1/videos"),
      model: env("GROK_VIDEO_MODEL", "grok-video-1.0"),
      displayName: env("GROK_VIDEO_DISPLAY_NAME", "Grok 视频 1.0"),
      apiKey: env("GROK_VIDEO_API_KEY"),
      enabled: hasKey(env("GROK_VIDEO_API_KEY")),
      endpointType: "grok-videos",
    },
    {
      id: "prompt-optimizer",
      kind: "prompt",
      title: "文生识别优化",
      role: "用于图片和视频文生识别优化",
      apiUrl: env("PROMPT_OPTIMIZER_API_URL", "https://api.deepseek.com/chat/completions"),
      model: env("PROMPT_OPTIMIZER_MODEL", "deepseek-v4-flash"),
      displayName: env("PROMPT_OPTIMIZER_DISPLAY_NAME", "DeepSeek V4 Flash"),
      apiKey: env("PROMPT_OPTIMIZER_API_KEY", env("DEEPSEEK_API_KEY")),
      enabled: hasKey(env("PROMPT_OPTIMIZER_API_KEY", env("DEEPSEEK_API_KEY"))),
      endpointType: "chat-completions",
    },
    {
      id: "image-upscale",
      kind: "image-upscale",
      title: "图片高清",
      role: "使用 Upscayl 在本机进行图片放大",
      apiUrl: env("UPSCAYL_BIN"),
      model: env("UPSCAYL_MODEL", "upscayl-standard-4x"),
      apiKey: "",
      enabled: true,
      endpointType: "upscayl-cli",
    },
    {
      id: "video-upscale",
      kind: "video-upscale",
      title: "视频高清",
      role: "使用 Video2X 在本机进行视频放大",
      apiUrl: env("VIDEO2X_BIN"),
      model: env("VIDEO2X_MODEL", "realesr-animevideov3"),
      apiKey: "",
      enabled: true,
      endpointType: "video2x-cli",
    },
  ];
}

function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  const models = normalizeModels(provider.models);
  const enabledModels = normalizeModels(provider.enabledModels);
  const modelDisplayNames = normalizeModelDisplayNames(provider.modelDisplayNames);
  return {
    ...provider,
    apiUrl: String(provider.apiUrl || "").trim(),
    model: String(provider.model || "").trim(),
    models: models.length ? models : undefined,
    enabledModels: enabledModels.length ? enabledModels.filter((model) => models.includes(model)) : undefined,
    modelDisplayNames,
    displayName: String(provider.displayName || "").trim() || undefined,
    apiKey: String(provider.apiKey || "").trim(),
    enabled: Boolean(provider.enabled),
    custom: Boolean(provider.custom),
  };
}

export function sanitizeProvider(provider: ProviderConfig): PublicProvider {
  const normalized = normalizeProvider(provider);
  const localProvider = isLocalProvider(normalized.endpointType);
  return {
    id: normalized.id,
    kind: normalized.kind,
    title: normalized.title,
    role: normalized.role,
    apiUrl: normalized.apiUrl,
    model: normalized.model,
    models: normalized.models,
    modelDisplayNames: normalized.modelDisplayNames,
    enabledModels: normalized.enabledModels,
    displayName: normalized.displayName,
    enabled: normalized.enabled,
    endpointType: normalized.endpointType,
    custom: normalized.custom,
    configured: normalized.enabled && (localProvider || hasKey(normalized.apiKey)),
    keyPreview: maskedKeyPreview(normalized.apiKey),
  };
}

function shouldExpandProvider(provider: ProviderConfig) {
  return (provider.kind === "image" || provider.kind === "video") && !isLocalProvider(provider.endpointType);
}

function virtualProviderId(providerId: string, model: string) {
  return `${providerId}${virtualModelSeparator}${encodeURIComponent(model)}`;
}

function parseVirtualProviderId(id: string) {
  const index = id.indexOf(virtualModelSeparator);
  if (index === -1) return null;
  const providerId = id.slice(0, index);
  const encodedModel = id.slice(index + virtualModelSeparator.length);
  try {
    const model = decodeURIComponent(encodedModel);
    return providerId && model ? { providerId, model } : null;
  } catch {
    return null;
  }
}

function publicDisplayName(provider: ProviderConfig, model: string, hasMultipleModels: boolean) {
  const modelDisplayName = normalizeModelDisplayNames(provider.modelDisplayNames)?.[model];
  if (modelDisplayName) return modelDisplayName;
  if (!hasMultipleModels) return provider.displayName;
  return `${provider.title} · ${model}`;
}

function expandProviderModels(provider: ProviderConfig) {
  if (!shouldExpandProvider(provider)) return [sanitizeProvider(provider)];
  const models = normalizeModels(provider.models);
  if (!models.length) return [sanitizeProvider(provider)];
  const enabledModels = normalizeModels(provider.enabledModels);
  const visibleModels = enabledModels.length
    ? models.filter((model) => enabledModels.includes(model))
    : models;
  return visibleModels.map((model) => sanitizeProvider({
    ...provider,
    id: virtualProviderId(provider.id, model),
    model,
    displayName: publicDisplayName(provider, model, visibleModels.length > 1),
  }));
}

export async function readProviders(): Promise<ProviderConfig[]> {
  const stored = await readJsonFile<ProviderConfig[] | null>(providersPath, null);
  const defaults = defaultProviders();
  if (!stored) return defaults;

  const byId = new Map(stored.map((provider) => [provider.id, normalizeProvider(provider)]));
  const defaultIds = new Set(defaults.map((provider) => provider.id));
  const mergedDefaults = defaults.map((fallback) => ({
    ...fallback,
    ...(() => {
      const saved = byId.get(fallback.id);
      if (!saved) return {};
      if (
        fallback.endpointType !== "upscale-placeholder"
        && saved.endpointType === "upscale-placeholder"
      ) {
        return {
          ...saved,
          apiUrl: saved.apiUrl || fallback.apiUrl,
          model: saved.model || fallback.model,
          enabled: true,
          endpointType: fallback.endpointType,
        };
      }
      return {
        ...saved,
        title: fallback.title,
        role: fallback.role,
      };
    })(),
  }));
  const customProviders = stored
    .map(normalizeProvider)
    .filter((provider) => provider.custom && !defaultIds.has(provider.id));
  return [...mergedDefaults, ...customProviders];
}

export async function readPublicProviders() {
  return (await readProviders()).map(sanitizeProvider);
}

export async function readEnabledProviders(kind?: ProviderKind) {
  return (await readProviders())
    .filter((provider) => (
      (!kind || provider.kind === kind)
      && provider.enabled
      && (isLocalProvider(provider.endpointType) || hasKey(provider.apiKey))
    ))
    .flatMap(expandProviderModels);
}

export async function providerById(id: string) {
  const providers = await readProviders();
  const direct = providers.find((provider) => provider.id === id);
  if (direct) return direct;
  const virtual = parseVirtualProviderId(id);
  if (!virtual) return null;
  const provider = providers.find((item) => item.id === virtual.providerId);
  if (!provider || !shouldExpandProvider(provider)) return null;
  const knownModels = normalizeModels(provider.models);
  if (!knownModels.includes(virtual.model)) return null;
  return {
    ...provider,
    id,
    model: virtual.model,
    displayName: publicDisplayName(provider, virtual.model, knownModels.length > 1),
  };
}

export function modelsEndpointFor(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (/\/models$/i.test(pathname)) {
      parsed.pathname = pathname;
    } else if (/\/v1(?:\/.*)?$/i.test(pathname)) {
      parsed.pathname = pathname.replace(/\/v1(?:\/.*)?$/i, "/v1/models");
    } else if (/\/(?:chat\/completions|videos|video-reference-images|images\/(?:generations|edits))$/i.test(pathname)) {
      parsed.pathname = pathname.replace(/\/(?:chat\/completions|videos|video-reference-images|images\/(?:generations|edits))$/i, "/models");
    } else {
      parsed.pathname = `${pathname === "" ? "" : pathname}/models`;
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function validateProviderUpdate(provider: ProviderConfig) {
  if (provider.enabled && isLocalProvider(provider.endpointType)) {
    if (!provider.model) throw new Error(`${provider.title} 缺少模型。`);
    return;
  }
  if (provider.enabled && provider.endpointType !== "upscale-placeholder") {
    if (!provider.apiUrl) throw new Error(`${provider.title} 缺少接口地址。`);
    if (!provider.model) throw new Error(`${provider.title} 缺少模型。`);
    try {
      const parsed = new URL(provider.apiUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new Error(`${provider.title} 接口地址必须是 http 或 https URL。`);
    }
  }
}

export async function updateProviders(updates: ProviderUpdate[]) {
  const providers = await readProviders();
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  for (const update of updates) {
    const current = byId.get(update.id);
    if (update.delete) {
      if (!current) continue;
      if (!current.custom) throw new Error("内置供应商不能删除，只能停用。");
      byId.delete(update.id);
      continue;
    }

    if (!current && !update.custom) throw new Error(`不支持的供应商：${update.id}`);
    const baseProvider = current || {
      id: update.id,
      kind: update.kind || "video",
      title: update.title || "自定义模型",
      role: update.role || "自定义模型配置",
      apiUrl: "",
      model: "",
      models: [],
      modelDisplayNames: {},
      enabledModels: [],
      displayName: "",
      apiKey: "",
      enabled: false,
      endpointType: update.endpointType || "videos-generations",
      custom: true,
    } satisfies ProviderConfig;

    const next: ProviderConfig = {
      ...baseProvider,
      kind: update.kind === undefined ? baseProvider.kind : update.kind,
      title: update.title === undefined ? baseProvider.title : update.title,
      role: update.role === undefined ? baseProvider.role : update.role,
      apiUrl: update.apiUrl === undefined ? baseProvider.apiUrl : update.apiUrl,
      model: update.model === undefined ? baseProvider.model : update.model,
      models: update.models === undefined ? baseProvider.models : normalizeModels(update.models),
      modelDisplayNames: update.modelDisplayNames === undefined
        ? baseProvider.modelDisplayNames
        : normalizeModelDisplayNames(update.modelDisplayNames),
      enabledModels: update.enabledModels === undefined
        ? baseProvider.enabledModels
        : normalizeModels(update.enabledModels),
      displayName: update.displayName === undefined ? baseProvider.displayName : update.displayName,
      enabled: update.enabled === undefined ? baseProvider.enabled : update.enabled,
      endpointType: update.endpointType === undefined ? baseProvider.endpointType : update.endpointType,
      custom: baseProvider.custom || Boolean(update.custom),
      apiKey: update.clearApiKey ? "" : update.apiKey?.trim() || baseProvider.apiKey,
    };
    validateProviderUpdate(next);
    byId.set(update.id, normalizeProvider(next));
  }

  const ordered = [
    ...defaultProviders().map((provider) => byId.get(provider.id) || provider),
    ...Array.from(byId.values()).filter((provider) => provider.custom),
  ];
  await writeJsonFile(providersPath, ordered);
  return ordered.map(sanitizeProvider);
}
