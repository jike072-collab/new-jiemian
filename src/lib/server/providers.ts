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

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function hasKey(value: string) {
  return Boolean(value && value.trim() && value.trim() !== "replace_me");
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
  return {
    ...provider,
    apiUrl: String(provider.apiUrl || "").trim(),
    model: String(provider.model || "").trim(),
    apiKey: String(provider.apiKey || "").trim(),
    enabled: Boolean(provider.enabled),
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
    enabled: normalized.enabled,
    endpointType: normalized.endpointType,
    configured: normalized.enabled && (localProvider || hasKey(normalized.apiKey)),
    keyPreview: maskedKeyPreview(normalized.apiKey),
  };
}

export async function readProviders(): Promise<ProviderConfig[]> {
  const stored = await readJsonFile<ProviderConfig[] | null>(providersPath, null);
  const defaults = defaultProviders();
  if (!stored) return defaults;

  const byId = new Map(stored.map((provider) => [provider.id, normalizeProvider(provider)]));
  return defaults.map((fallback) => ({
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
      return saved;
    })(),
  }));
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
    .map(sanitizeProvider);
}

export async function providerById(id: string) {
  return (await readProviders()).find((provider) => provider.id === id) || null;
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
    if (!current) throw new Error(`不支持的供应商：${update.id}`);

    const next: ProviderConfig = {
      ...current,
      apiUrl: update.apiUrl === undefined ? current.apiUrl : update.apiUrl,
      model: update.model === undefined ? current.model : update.model,
      enabled: update.enabled === undefined ? current.enabled : update.enabled,
      endpointType: update.endpointType === undefined ? current.endpointType : update.endpointType,
      apiKey: update.clearApiKey ? "" : update.apiKey?.trim() || current.apiKey,
    };
    validateProviderUpdate(next);
    byId.set(update.id, normalizeProvider(next));
  }

  const ordered = providers.map((provider) => byId.get(provider.id) || provider);
  await writeJsonFile(providersPath, ordered);
  return ordered.map(sanitizeProvider);
}
