import { join } from "node:path";

import {
  type EndpointType,
  type FrontendProvider,
  type ProviderConfig,
  type ProviderKind,
  type ProviderUpdate,
  type PublicProvider,
} from "./types";
import { dataRoot, readJsonFile, writeJsonFile } from "./paths";

const providersPath = join(dataRoot, "providers.json");
const virtualModelSeparator = "::model::";

const jimengVideoModels = [
  "seedance2.0-pro 720p-15s",
  "gu-seedance2.0-fast 720p-15s",
  "op-seedance2.0 720p-pro-特价-15s",
  "gu-seedance2.0-pro 720p-10s-nyp",
  "seedance2.0 720p-fast",
  "seedance2.0 720p-pro",
  "seedance2.0 720p-fast-sr",
  "seedance2.0 720p-mini-sr",
  "seedance2.0 720p-pro-sr",
];

const jimengVideoDisplayNames: Record<string, string> = {
  "seedance2.0-pro 720p-15s": "即梦 720P Pro 15 秒",
  "gu-seedance2.0-fast 720p-15s": "即梦 720P Fast 15 秒",
  "op-seedance2.0 720p-pro-特价-15s": "即梦 720P Pro 15 秒特价",
  "gu-seedance2.0-pro 720p-10s-nyp": "即梦 720P Pro 5/10 秒",
  "seedance2.0 720p-fast": "即梦 720P Fast",
  "seedance2.0 720p-pro": "即梦 720P Pro",
  "seedance2.0 720p-fast-sr": "即梦 720P Fast 超分",
  "seedance2.0 720p-mini-sr": "即梦 720P Mini 超分",
  "seedance2.0 720p-pro-sr": "即梦 720P Pro 超分",
};

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

function normalizeVideoOptions(value: unknown): ProviderConfig["videoOptions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const durations = Array.isArray(input.durations)
    ? Array.from(new Set(input.durations.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)))
    : undefined;
  const ratios = Array.isArray(input.ratios)
    ? Array.from(new Set(input.ratios.map((item) => String(item || "").trim()).filter(Boolean)))
    : undefined;
  const resolution = String(input.resolution || "").trim();
  const maxReferenceImages = Number(input.maxReferenceImages);
  const supportsVideoReference = typeof input.supportsVideoReference === "boolean" ? input.supportsVideoReference : undefined;
  const supportsAudioReference = typeof input.supportsAudioReference === "boolean" ? input.supportsAudioReference : undefined;
  const normalized: NonNullable<ProviderConfig["videoOptions"]> = {};
  if (durations?.length) normalized.durations = durations;
  if (ratios?.length) normalized.ratios = ratios;
  if (resolution) normalized.resolution = resolution;
  if (Number.isFinite(maxReferenceImages) && maxReferenceImages >= 0) normalized.maxReferenceImages = Math.floor(maxReferenceImages);
  if (supportsVideoReference !== undefined) normalized.supportsVideoReference = supportsVideoReference;
  if (supportsAudioReference !== undefined) normalized.supportsAudioReference = supportsAudioReference;
  return Object.keys(normalized).length ? normalized : undefined;
}

export function jimengVideoOptionsForModel(model: string): ProviderConfig["videoOptions"] {
  const normalized = model.trim().toLowerCase();
  if (!normalized.includes("seedance2.0")) return undefined;
  const fixed15s = normalized.includes("15s");
  const fixed5Or10s = normalized.includes("10s-nyp");
  const srModel = normalized.endsWith("-sr");
  return {
    durations: fixed15s ? [15] : fixed5Or10s ? [5, 10] : [5, 10, 15],
    ratios: ["16:9", "9:16", "1:1"],
    resolution: "720p",
    maxReferenceImages: fixed15s ? 4 : 9,
    supportsVideoReference: !srModel,
    supportsAudioReference: !fixed5Or10s,
  };
}

function providerVideoOptions(provider: ProviderConfig) {
  return jimengVideoOptionsForModel(provider.model) || normalizeVideoOptions(provider.videoOptions);
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
      displayName: env("IMAGE_DISPLAY_NAME", env("IMAGE_MODEL", "gpt-image-2")),
      apiKey: env("IMAGE_MODEL_API_KEY"),
      enabled: hasKey(env("IMAGE_MODEL_API_KEY")),
      endpointType: (env("IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
      custom: false,
    },
    {
      id: "image-img2-4k",
      kind: "image",
      title: "img2 图片生成",
      role: "支持 1K、2K、4K 图片生成",
      apiUrl: env("IMG2_IMAGE_API_URL", "https://api.nianhua.store/v1/images/generations"),
      model: env("IMG2_IMAGE_MODEL", "image4k"),
      displayName: env("IMG2_IMAGE_DISPLAY_NAME", "img2-4K"),
      apiKey: env("IMG2_IMAGE_API_KEY"),
      enabled: hasKey(env("IMG2_IMAGE_API_KEY")),
      endpointType: (env("IMG2_IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
      custom: false,
    },
    {
      id: "video-main",
      kind: "video",
      title: "视频生成",
      role: "文生视频与图生视频",
      apiUrl: env("VIDEO_API_URL", "https://clmm-mall.top/v1/videos/generations"),
      model: env("VIDEO_MODEL", "seedance2.0 720p-fast-sr"),
      models: jimengVideoModels,
      modelDisplayNames: jimengVideoDisplayNames,
      enabledModels: jimengVideoModels,
      displayName: env("VIDEO_DISPLAY_NAME", env("VIDEO_MODEL", "seedance2.0 720p-fast-sr")),
      apiKey: env("VIDEO_MODEL_API_KEY"),
      enabled: hasKey(env("VIDEO_MODEL_API_KEY")),
      endpointType: (env("VIDEO_ENDPOINT_TYPE", "videos-generations") as EndpointType),
      custom: false,
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
      custom: false,
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
      custom: false,
    },
    {
      id: "image-upscale",
      kind: "image-upscale",
      title: "图片高清",
      role: "使用 Upscayl 在本机进行图片放大",
      apiUrl: env("UPSCAYL_BIN"),
      model: env("UPSCAYL_MODEL", "upscayl-standard-4x"),
      displayName: env("UPSCAYL_DISPLAY_NAME", env("UPSCAYL_MODEL", "upscayl-standard-4x")),
      apiKey: "",
      enabled: true,
      endpointType: "upscayl-cli",
      custom: false,
    },
    {
      id: "video-upscale",
      kind: "video-upscale",
      title: "视频高清",
      role: "使用 Video2X 在本机进行视频放大",
      apiUrl: env("VIDEO2X_BIN"),
      model: env("VIDEO2X_MODEL", "realesr-animevideov3"),
      displayName: env("VIDEO2X_DISPLAY_NAME", env("VIDEO2X_MODEL", "realesr-animevideov3")),
      apiKey: "",
      enabled: true,
      endpointType: "video2x-cli",
      custom: false,
    },
  ];
}

function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  const models = normalizeModels(provider.models);
  const enabledModels = normalizeModels(provider.enabledModels);
  return {
    ...provider,
    apiUrl: String(provider.apiUrl || "").trim(),
    model: String(provider.model || "").trim(),
    models: models.length ? models : undefined,
    enabledModels: enabledModels.length
      ? enabledModels.filter((model) => !models.length || models.includes(model))
      : undefined,
    modelDisplayNames: normalizeModelDisplayNames(provider.modelDisplayNames),
    displayName: String(provider.displayName || provider.model || "").trim() || undefined,
    videoOptions: normalizeVideoOptions(provider.videoOptions),
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
    displayName: normalized.displayName || normalized.model,
    videoOptions: providerVideoOptions(normalized),
    enabled: normalized.enabled,
    endpointType: normalized.endpointType,
    custom: normalized.custom,
    configured: normalized.enabled && (localProvider || hasKey(normalized.apiKey)),
    keyPreview: maskedKeyPreview(normalized.apiKey),
  };
}

function capabilitiesFor(provider: Pick<ProviderConfig, "endpointType">) {
  if (provider.endpointType === "images-edits") return ["image", "image-edit"];
  if (provider.endpointType === "images-generations") return ["image"];
  if (provider.endpointType === "videos-generations" || provider.endpointType === "grok-videos") return ["video"];
  if (provider.endpointType === "upscayl-cli") return ["image-upscale"];
  if (provider.endpointType === "video2x-cli") return ["video-upscale"];
  return [];
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
  if (!hasMultipleModels) return provider.displayName || model;
  return `${provider.title} · ${model}`;
}

function expandProviderModels(provider: ProviderConfig) {
  const normalized = normalizeProvider(provider);
  if (!shouldExpandProvider(normalized)) return [sanitizeProvider(normalized)];
  const models = normalizeModels(normalized.models);
  if (!models.length) return [sanitizeProvider(normalized)];
  const enabledModels = normalizeModels(normalized.enabledModels);
  const visibleModels = enabledModels.length
    ? models.filter((model) => enabledModels.includes(model))
    : models;
  return visibleModels.map((model) => sanitizeProvider({
    ...normalized,
    id: virtualProviderId(normalized.id, model),
    model,
    displayName: publicDisplayName(normalized, model, visibleModels.length > 1),
    videoOptions: providerVideoOptions({ ...normalized, model }),
  }));
}

function mergeStoredProvider(fallback: ProviderConfig, stored: ProviderConfig | undefined) {
  if (!stored) return fallback;
  if (
    fallback.endpointType !== "upscale-placeholder"
    && stored.endpointType === "upscale-placeholder"
  ) {
    return {
      ...stored,
      apiUrl: stored.apiUrl || fallback.apiUrl,
      model: stored.model || fallback.model,
      displayName: stored.displayName || stored.model || fallback.displayName || fallback.model,
      enabled: true,
      endpointType: fallback.endpointType,
    };
  }
  return {
    ...fallback,
    ...stored,
    title: stored.title || fallback.title,
    role: stored.role || fallback.role,
  };
}

export async function readProviders(): Promise<ProviderConfig[]> {
  const stored = await readJsonFile<ProviderConfig[] | null>(providersPath, null);
  const defaults = defaultProviders();
  if (!stored) return defaults.map(normalizeProvider);

  const byId = new Map(stored.map((provider) => [provider.id, normalizeProvider(provider)]));
  const defaultIds = new Set(defaults.map((provider) => provider.id));
  const mergedDefaults = defaults.map((fallback) => normalizeProvider(mergeStoredProvider(
    fallback,
    byId.get(fallback.id),
  )));
  const extraProviders = stored
    .map(normalizeProvider)
    .filter((provider) => !defaultIds.has(provider.id));
  return [...mergedDefaults, ...extraProviders];
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

export async function readFrontendProviders(kind?: ProviderKind): Promise<FrontendProvider[]> {
  return (await readProviders())
    .filter((provider) => (
      (!kind || provider.kind === kind)
      && provider.enabled
      && (isLocalProvider(provider.endpointType) || hasKey(provider.apiKey))
    ))
    .flatMap(expandProviderModels)
    .map((provider) => ({
      id: provider.id,
      model: provider.model,
      displayName: provider.displayName || provider.model,
      capabilities: capabilitiesFor(provider),
      enabled: provider.enabled,
      endpointType: provider.endpointType,
      videoOptions: provider.videoOptions,
    }));
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
  if (knownModels.length && !knownModels.includes(virtual.model)) return null;
  return normalizeProvider({
    ...provider,
    id,
    model: virtual.model,
    displayName: publicDisplayName(provider, virtual.model, knownModels.length > 1),
    videoOptions: providerVideoOptions({ ...provider, model: virtual.model }),
  });
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
      videoOptions: undefined,
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
      videoOptions: update.videoOptions === undefined
        ? baseProvider.videoOptions
        : normalizeVideoOptions(update.videoOptions),
      enabled: update.enabled === undefined ? baseProvider.enabled : update.enabled,
      endpointType: update.endpointType === undefined ? baseProvider.endpointType : update.endpointType,
      custom: baseProvider.custom || Boolean(update.custom),
      apiKey: update.clearApiKey ? "" : update.apiKey?.trim() || baseProvider.apiKey,
    };
    validateProviderUpdate(next);
    byId.set(update.id, normalizeProvider(next));
  }

  const defaults = defaultProviders();
  const defaultIds = new Set(defaults.map((provider) => provider.id));
  const ordered = [
    ...defaults.map((provider) => byId.get(provider.id) || provider),
    ...Array.from(byId.values()).filter((provider) => !defaultIds.has(provider.id)),
  ];
  await writeJsonFile(providersPath, ordered);
  return ordered.map(sanitizeProvider);
}
