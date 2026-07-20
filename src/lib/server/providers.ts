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
import {
  clmmSeedanceVideoDisplayName,
  clmmSeedanceVideoDisplayNames,
  isDynamicClmmSeedance20Model,
  seedanceVideoDisplayNames,
} from "../seedance-model-display";

const providersPath = join(dataRoot, "providers.json");
const virtualModelSeparator = "::model::";
const activeGrokVideoModel = "grok-video-1.5";
const endpointTypes = [
  "images-generations",
  "images-edits",
  "gettoken-banana",
  "gettoken-veo",
  "chat-completions",
  "videos-generations",
  "grok-videos",
  "volcengine-imagex-upscale",
  "volcengine-vod-upscale",
] as const satisfies readonly EndpointType[];

const seedanceVideoModels = [
  "video-2.0-fast-720P",
  "quanneng2.0-9tu",
  "quanneng2.0",
  "sdquan-2-miao",
  "Doubao-Seedance-2-0-260128-grid",
];

const clmmSeedanceVideoModels = [
  "bb-seedance2.0 1080p-pro-gz-15s",
  "bb-seedance2.0 720p-fast-gz-15s",
  "bb-seedance2.0 720p-pro-gz-15s",
  "mg-seedance2.0 -720p fast",
  "mg-seedance2.0 -720p mini",
  "mg-seedance2.0 -720p pro",
  "oe-seedance-2.0-pro-720p-14s-gz",
];
const clmmFlexibleVideoDurations = Array.from({ length: 11 }, (_, index) => index + 5);

const clmmSeedanceVideoOptionsByModel: Record<string, NonNullable<ProviderConfig["videoOptions"]>> = {
  "mg-seedance2.0 -720p fast": { durations: clmmFlexibleVideoDurations, ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "mg-seedance2.0 -720p mini": { durations: clmmFlexibleVideoDurations, ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "mg-seedance2.0 -720p pro": { durations: clmmFlexibleVideoDurations, ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "seedance2.0 720p-933-pro-gz-15s": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "seedance2.0 720p-fast-gz-15s": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 1, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "seedance2.0 720p-pro-gz-15s": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
};

const seedanceVideoOptionsByModel: Record<string, NonNullable<ProviderConfig["videoOptions"]>> = {
  "video-2.0-fast-720p": { durations: [10, 15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, requiredReferenceMedia: ["image"], supportsVideoReference: true, supportsAudioReference: true },
  "quanneng2.0-9tu": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 0, maxReferenceDurationSeconds: 15 },
  "b-quannengship2.0": { durations: [5, 10, 15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 0, maxReferenceDurationSeconds: 15 },
  "quanneng2.0": { durations: [10, 15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, maxReferenceDurationSeconds: 15, maxPromptCharacters: 80, supportsVideoReference: true, supportsAudioReference: true },
  "sdquan-2-miao": { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 3, maxReferenceDurationSeconds: 15, requiredReferenceMedia: ["image"], supportsAudioReference: true },
  "doubao-seedance-2.0-fast-260128-grid": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
  "doubao-seedance-2-0-260128-grid": { durations: [15], ratios: ["16:9", "9:16"], resolution: "720p", maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceDurationSeconds: 15, supportsVideoReference: true, supportsAudioReference: true },
};

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function hasKey(value: string) {
  return Boolean(value && value.trim() && value.trim() !== "replace_me");
}

function isRetiredNianhuaImageProvider(provider: Pick<ProviderConfig, "kind" | "apiUrl">) {
  if (provider.kind !== "image") return false;
  try {
    return new URL(String(provider.apiUrl || "").trim()).hostname.toLowerCase() === "nianhuaapi.com";
  } catch {
    return false;
  }
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
  const resolutions = Array.isArray(input.resolutions)
    ? Array.from(new Set(input.resolutions.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)))
    : undefined;
  const maxReferenceImages = Number(input.maxReferenceImages);
  const maxReferenceVideos = Number(input.maxReferenceVideos);
  const maxReferenceAudios = Number(input.maxReferenceAudios);
  const maxReferenceDurationSeconds = Number(input.maxReferenceDurationSeconds);
  const maxPromptCharacters = Number(input.maxPromptCharacters);
  const requiredReferenceMedia = Array.isArray(input.requiredReferenceMedia)
    ? Array.from(new Set(input.requiredReferenceMedia.filter((item): item is "image" | "video" | "audio" => item === "image" || item === "video" || item === "audio")))
    : undefined;
  const supportsVideoReference = typeof input.supportsVideoReference === "boolean" ? input.supportsVideoReference : undefined;
  const supportsAudioReference = typeof input.supportsAudioReference === "boolean" ? input.supportsAudioReference : undefined;
  const normalized: NonNullable<ProviderConfig["videoOptions"]> = {};
  if (durations?.length) normalized.durations = durations;
  if (ratios?.length) normalized.ratios = ratios;
  if (resolution) normalized.resolution = resolution;
  if (resolutions?.length) normalized.resolutions = resolutions;
  if (Number.isFinite(maxReferenceImages) && maxReferenceImages >= 0) normalized.maxReferenceImages = Math.floor(maxReferenceImages);
  if (Number.isFinite(maxReferenceVideos) && maxReferenceVideos >= 0) normalized.maxReferenceVideos = Math.floor(maxReferenceVideos);
  if (Number.isFinite(maxReferenceAudios) && maxReferenceAudios >= 0) normalized.maxReferenceAudios = Math.floor(maxReferenceAudios);
  if (Number.isFinite(maxReferenceDurationSeconds) && maxReferenceDurationSeconds > 0) normalized.maxReferenceDurationSeconds = maxReferenceDurationSeconds;
  if (Number.isFinite(maxPromptCharacters) && maxPromptCharacters > 0) normalized.maxPromptCharacters = Math.floor(maxPromptCharacters);
  if (requiredReferenceMedia?.length) normalized.requiredReferenceMedia = requiredReferenceMedia;
  if (supportsVideoReference !== undefined) normalized.supportsVideoReference = supportsVideoReference;
  if (supportsAudioReference !== undefined) normalized.supportsAudioReference = supportsAudioReference;
  return Object.keys(normalized).length ? normalized : undefined;
}

export function seedanceVideoOptionsForModel(model: string): ProviderConfig["videoOptions"] {
  return seedanceVideoOptionsByModel[model.trim().toLowerCase()];
}

export function seedanceVideoRequestSecondsForModel(_model: string, duration: number) {
  return duration;
}

export function clmmSeedanceVideoOptionsForModel(model: string): ProviderConfig["videoOptions"] {
  const normalized = model.trim().toLowerCase();
  const known = clmmSeedanceVideoOptionsByModel[normalized];
  if (known || !isDynamicClmmSeedance20Model(model)) return known;
  const fixedSeconds = Number(normalized.match(/(?:^|[-_ ])(\d+)s(?:$|[-_ ])/i)?.[1] || 0);
  const fixedDuration = fixedSeconds > 0;
  const is933 = normalized.includes("933");
  const is1080 = normalized.includes("1080");
  const isBb = normalized.startsWith("bb-");
  const isFast = normalized.includes("fast");
  const isMini = normalized.includes("mini");
  return {
    durations: fixedDuration ? [fixedSeconds] : clmmFlexibleVideoDurations,
    ratios: isBb ? ["9:16"] : ["16:9", "9:16"],
    resolution: is1080 ? "1080p" : "720p",
    maxReferenceImages: is933 || (is1080 && isBb) ? 9 : 4,
    maxReferenceVideos: isFast && fixedDuration ? 1 : 3,
    maxReferenceAudios: is933 || !isMini ? 3 : 1,
    maxReferenceDurationSeconds: 15,
    supportsVideoReference: true,
    supportsAudioReference: true,
  };
}

export function clmmSeedanceVideoRequestSecondsForModel(model: string, duration: number) {
  return /(?:^|-)\d+s(?:-|$)/.test(model.trim().toLowerCase()) ? 1 : duration;
}

export function clmmSeedanceVideoMySecondsForModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!/(?:^|-)gz(?:-|$)/.test(normalized)) return undefined;
  const durationMatch = normalized.match(/(?:^|-)\d+s(?:-|$)/)?.[0].match(/(\d+)s/);
  return durationMatch ? Number(durationMatch[1]) : undefined;
}

function grokVideoOptionsForModel(model: string): ProviderConfig["videoOptions"] {
  const normalized = model.trim().toLowerCase();
  if (!normalized.startsWith("grok-video-")) return undefined;
  if (normalized === "grok-video-1.5") {
    return {
      durations: [6, 8, 10, 12, 15],
      ratios: ["16:9", "9:16"],
      resolution: "720p",
      maxReferenceImages: 1,
      requiredReferenceMedia: ["image"],
    };
  }
  return {
    durations: [6, 8, 10, 12, 15],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    resolution: "720p",
    maxReferenceImages: 7,
  };
}

function getTokenVeoOptionsForModel(model: string): ProviderConfig["videoOptions"] {
  const normalizedModel = model.trim().toLowerCase();
  if (!normalizedModel.startsWith("veo-3.1-")) return undefined;
  return {
    durations: [8],
    ratios: ["16:9", "9:16"],
    resolution: "720p",
    resolutions: ["720p", "1080p", "4k"],
    maxReferenceImages: normalizedModel === "veo-3.1-pro" ? 2 : 1,
  };
}

function providerVideoOptions(provider: ProviderConfig) {
  return grokVideoOptionsForModel(provider.model)
    || getTokenVeoOptionsForModel(provider.model)
    || seedanceVideoOptionsForModel(provider.model)
    || clmmSeedanceVideoOptionsForModel(provider.model)
    || normalizeVideoOptions(provider.videoOptions);
}

function legacyUpscaleEndpointForKind(kind: ProviderKind) {
  if (kind === "image-upscale") return "volcengine-imagex-upscale";
  if (kind === "video-upscale") return "volcengine-vod-upscale";
  return null;
}

function currentUpscaleDefaults(endpointType: EndpointType) {
  if (endpointType === "volcengine-imagex-upscale") {
    return {
      title: "图片高清增强",
      role: "使用火山引擎 ImageX 进行图片高清增强",
      apiUrl: env("VOLCENGINE_IMAGEX_ENDPOINT", "https://imagex.volcengineapi.com"),
      model: env("VOLCENGINE_IMAGEX_SERVICE_ID"),
      displayName: env("VOLCENGINE_IMAGEX_DISPLAY_NAME", "火山 ImageX 图片高清增强"),
    };
  }
  if (endpointType === "volcengine-vod-upscale") {
    return {
      title: "视频高清增强",
      role: "使用火山引擎 VOD 进行视频高清增强",
      apiUrl: env("VOLCENGINE_VOD_ENDPOINT", "https://vod.volcengineapi.com"),
      model: env("VOLCENGINE_VOD_SPACE_NAME"),
      displayName: env("VOLCENGINE_VOD_DISPLAY_NAME", "火山 VOD 视频高清增强"),
    };
  }
  return null;
}

export function normalizeLegacyUpscaleProvider(provider: ProviderConfig | (Omit<ProviderConfig, "endpointType"> & { endpointType?: unknown })): ProviderConfig {
  const rawEndpoint = String(provider.endpointType || "").trim();
  const mapped = rawEndpoint === "upscayl-cli"
    ? "volcengine-imagex-upscale"
    : rawEndpoint === "video2x-cli"
      ? "volcengine-vod-upscale"
      : rawEndpoint === "upscale-placeholder"
      ? legacyUpscaleEndpointForKind(provider.kind)
      : null;
  if (!mapped) return provider as ProviderConfig;
  if (mapped === "volcengine-imagex-upscale" && provider.kind !== "image-upscale") {
    throw new Error(`Legacy image upscale endpoint cannot be used for ${provider.kind}.`);
  }
  if (mapped === "volcengine-vod-upscale" && provider.kind !== "video-upscale") {
    throw new Error(`Legacy video upscale endpoint cannot be used for ${provider.kind}.`);
  }
  const current = currentUpscaleDefaults(mapped);
  return {
    ...(provider as ProviderConfig),
    ...(current || {}),
    endpointType: mapped,
  };
}

function normalizeEndpointType(value: unknown, kind: ProviderKind): EndpointType {
  const legacy = normalizeLegacyUpscaleProvider({
    id: "",
    kind,
    title: "",
    role: "",
    apiUrl: "",
    model: "",
    apiKey: "",
    enabled: false,
    endpointType: value,
  }).endpointType;
  if (endpointTypes.includes(legacy)) return legacy;
  throw new Error(`Unsupported provider endpoint type for ${kind}.`);
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
      fallbackApiKey: env("IMAGE_MODEL_FALLBACK_API_KEY"),
      fallbackProviderId: env("IMAGE_MODEL_FALLBACK_PROVIDER_ID"),
      enabled: hasKey(env("IMAGE_MODEL_API_KEY")),
      endpointType: (env("IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
      custom: false,
    },
    {
      id: "image-img2-4k",
      kind: "image",
      title: "img2 图片生成",
      role: "支持 1K、2K、4K 图片生成",
      apiUrl: env("IMG2_IMAGE_API_URL"),
      model: env("IMG2_IMAGE_MODEL", "gpt-image-2"),
      displayName: env("IMG2_IMAGE_DISPLAY_NAME", "img"),
      apiKey: env("IMG2_IMAGE_API_KEY"),
      fallbackApiKey: env("IMG2_IMAGE_FALLBACK_API_KEY"),
      fallbackProviderId: env("IMG2_IMAGE_FALLBACK_PROVIDER_ID", "custom-image-1"),
      enabled: hasKey(env("IMG2_IMAGE_API_KEY")),
      endpointType: (env("IMG2_IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
      custom: false,
    },
    {
      id: "image-nanobanana2-pro",
      kind: "image",
      title: "Nanobanana2pro image generation",
      role: "Supports Nanobanana2pro text-to-image, image-to-image, and 4K image generation",
      apiUrl: env("NANOBANANA_IMAGE_API_URL", "https://image.codesonline.dev/v1/images/generations"),
      model: env("NANOBANANA_IMAGE_MODEL", "gemini-banana-2.0-pro"),
      models: ["gemini-banana-2.0-pro"],
      modelDisplayNames: {
        "gemini-banana-2.0-pro": "Nanobanana2pro",
      },
      enabledModels: ["gemini-banana-2.0-pro"],
      displayName: env("NANOBANANA_IMAGE_DISPLAY_NAME", "Nanobanana2pro"),
      apiKey: env("NANOBANANA_IMAGE_API_KEY"),
      enabled: hasKey(env("NANOBANANA_IMAGE_API_KEY")),
      endpointType: (env("NANOBANANA_IMAGE_ENDPOINT_TYPE", "images-generations") as EndpointType),
      custom: false,
    },
    {
      id: "image-gettoken-banana",
      kind: "image",
      title: "GetToken Banana 图片生成",
      role: "支持 Banana2 与 Banana Pro 文生图、图生图和 4K 图片生成",
      apiUrl: env("GETTOKEN_BANANA_API_URL", "https://nb.gettoken.cn/openapi/v1"),
      model: env("GETTOKEN_BANANA_MODEL", "banana-pro"),
      models: ["banana2", "banana-pro"],
      modelDisplayNames: {
        banana2: "banana2",
        "banana-pro": "banana pro",
      },
      enabledModels: ["banana2", "banana-pro"],
      displayName: env("GETTOKEN_BANANA_DISPLAY_NAME", "banana pro"),
      apiKey: env("GETTOKEN_BANANA_API_KEY"),
      enabled: hasKey(env("GETTOKEN_BANANA_API_KEY")),
      endpointType: "gettoken-banana",
      custom: false,
    },
    {
      id: "video-gettoken-veo",
      kind: "video",
      title: "GetToken Veo 视频生成",
      role: "支持 Veo 3.1 Pro 与 Veo 3.1 Fast 文生视频和图生视频",
      apiUrl: env("GETTOKEN_VEO_API_URL", env("GETTOKEN_BANANA_API_URL", "https://nb.gettoken.cn/openapi/v1")),
      model: "veo-3.1-pro",
      models: ["veo-3.1-pro", "veo-3.1-fast"],
      modelDisplayNames: {
        "veo-3.1-pro": "Veo 3.1 Pro",
        "veo-3.1-fast": "Veo 3.1 Fast",
      },
      enabledModels: ["veo-3.1-pro", "veo-3.1-fast"],
      displayName: "Veo 3.1 Pro",
      apiKey: env("GETTOKEN_VEO_API_KEY", env("GETTOKEN_BANANA_API_KEY")),
      enabled: hasKey(env("GETTOKEN_VEO_API_KEY", env("GETTOKEN_BANANA_API_KEY"))),
      endpointType: "gettoken-veo",
      custom: false,
    },
    {
      id: "video-main",
      kind: "video",
      title: "Seedance 视频生成",
      role: "红鸟 Seedance 2.0 满血与快速模型，统一输出 720P",
      apiUrl: env("REDBIRD_SEEDANCE_VIDEO_API_URL", "https://open.hongniaoai.com/api/v1/videos"),
      model: env("REDBIRD_SEEDANCE_VIDEO_MODEL", "video-2.0-fast-720P"),
      models: seedanceVideoModels,
      modelDisplayNames: seedanceVideoDisplayNames,
      enabledModels: seedanceVideoModels,
      displayName: env("REDBIRD_SEEDANCE_VIDEO_DISPLAY_NAME", env("REDBIRD_SEEDANCE_VIDEO_MODEL", "video-2.0-fast-720P")),
      apiKey: env("REDBIRD_SEEDANCE_VIDEO_API_KEY"),
      enabled: hasKey(env("REDBIRD_SEEDANCE_VIDEO_API_KEY")),
      endpointType: (env("REDBIRD_SEEDANCE_VIDEO_ENDPOINT_TYPE", "videos-generations") as EndpointType),
      custom: false,
    },
    {
      id: "video-grok",
      kind: "video",
      title: "Grok 视频",
      role: "Grok 文生视频与图生视频",
      apiUrl: env("GROK_VIDEO_API_URL", "https://api.manxiaobai.online/v1/videos"),
      model: activeGrokVideoModel,
      models: [activeGrokVideoModel],
      enabledModels: [activeGrokVideoModel],
      displayName: env("GROK_VIDEO_DISPLAY_NAME", "grok"),
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
      apiUrl: env("PROMPT_OPTIMIZER_API_URL", "https://api.qianyi.win/v1/chat/completions"),
      model: env("PROMPT_OPTIMIZER_MODEL", "gpt-5.5"),
      displayName: env("PROMPT_OPTIMIZER_DISPLAY_NAME", "GPT-5.5"),
      apiKey: env("PROMPT_OPTIMIZER_API_KEY"),
      enabled: hasKey(env("PROMPT_OPTIMIZER_API_KEY")),
      endpointType: "chat-completions",
      custom: false,
    },
    {
      id: "video-seedance-new",
      kind: "video",
      title: "Seedance 2.0 新视频生成",
      role: "CLMM Seedance 2.0 六个 720P 模型",
      apiUrl: env("VIDEO_API_URL", "https://clmm-mall.top/v1/videos"),
      model: env("VIDEO_MODEL", clmmSeedanceVideoModels[0]),
      models: clmmSeedanceVideoModels,
      modelDisplayNames: clmmSeedanceVideoDisplayNames,
      enabledModels: clmmSeedanceVideoModels,
      displayName: env("VIDEO_DISPLAY_NAME", clmmSeedanceVideoDisplayNames[clmmSeedanceVideoModels[0]]),
      apiKey: env("VIDEO_MODEL_API_KEY"),
      enabled: hasKey(env("VIDEO_MODEL_API_KEY")),
      endpointType: (env("VIDEO_ENDPOINT_TYPE", "videos-generations") as EndpointType),
      custom: false,
    },
    {
      id: "image-upscale",
      kind: "image-upscale",
      title: "图片高清增强",
      role: "使用火山引擎 ImageX 进行图片高清增强",
      apiUrl: env("VOLCENGINE_IMAGEX_ENDPOINT", "https://imagex.volcengineapi.com"),
      model: env("VOLCENGINE_IMAGEX_SERVICE_ID"),
      displayName: env("VOLCENGINE_IMAGEX_DISPLAY_NAME", "火山 ImageX 图片高清增强"),
      apiKey: env("VOLCENGINE_ACCESS_KEY_PAIR"),
      enabled: hasKey(env("VOLCENGINE_ACCESS_KEY_PAIR")) || (hasKey(env("VOLCENGINE_ACCESS_KEY_ID")) && hasKey(env("VOLCENGINE_SECRET_ACCESS_KEY"))),
      endpointType: "volcengine-imagex-upscale",
      custom: false,
    },
    {
      id: "video-upscale",
      kind: "video-upscale",
      title: "视频高清增强",
      role: "使用火山引擎 VOD 进行视频高清增强",
      apiUrl: env("VOLCENGINE_VOD_ENDPOINT", "https://vod.volcengineapi.com"),
      model: env("VOLCENGINE_VOD_SPACE_NAME"),
      displayName: env("VOLCENGINE_VOD_DISPLAY_NAME", "火山 VOD 视频高清增强"),
      apiKey: env("VOLCENGINE_ACCESS_KEY_PAIR"),
      enabled: hasKey(env("VOLCENGINE_ACCESS_KEY_PAIR")) || (hasKey(env("VOLCENGINE_ACCESS_KEY_ID")) && hasKey(env("VOLCENGINE_SECRET_ACCESS_KEY"))),
      endpointType: "volcengine-vod-upscale",
      custom: false,
    },
  ];
}

function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  const legacyNormalized = normalizeLegacyUpscaleProvider(provider);
  const apiUrl = String(legacyNormalized.apiUrl || "").trim();
  const endpointType = normalizeEndpointType(legacyNormalized.endpointType, legacyNormalized.kind);
  const onlyActiveGrokModel = endpointType === "grok-videos";
  const models = normalizeModels(legacyNormalized.models)
    .filter((model) => !onlyActiveGrokModel || model === activeGrokVideoModel);
  const enabledModels = normalizeModels(legacyNormalized.enabledModels)
    .filter((model) => !onlyActiveGrokModel || model === activeGrokVideoModel);
  const retired = isRetiredNianhuaImageProvider({
    kind: legacyNormalized.kind,
    apiUrl,
  });
  return {
    ...legacyNormalized,
    apiUrl,
    model: onlyActiveGrokModel ? activeGrokVideoModel : String(legacyNormalized.model || "").trim(),
    models: models.length ? models : undefined,
    enabledModels: enabledModels.length
      ? enabledModels.filter((model) => !models.length || models.includes(model))
      : undefined,
    modelDisplayNames: normalizeModelDisplayNames(legacyNormalized.modelDisplayNames),
    displayName: String(legacyNormalized.displayName || legacyNormalized.model || "").trim() || undefined,
    videoOptions: normalizeVideoOptions(legacyNormalized.videoOptions),
    apiKey: String(legacyNormalized.apiKey || "").trim(),
    fallbackApiKey: fallbackApiKeyForProvider(legacyNormalized),
    fallbackProviderId: fallbackProviderIdForProvider(legacyNormalized),
    enabled: retired ? false : Boolean(legacyNormalized.enabled),
    endpointType,
    custom: Boolean(legacyNormalized.custom),
  };
}

function fallbackApiKeyForProvider(provider: ProviderConfig) {
  const configured = String(provider.fallbackApiKey || "").trim();
  if (configured) return configured;
  if (provider.id === "image-img2-4k") return env("IMG2_IMAGE_FALLBACK_API_KEY");
  if (provider.id === "image-main") return env("IMAGE_MODEL_FALLBACK_API_KEY");
  return "";
}

function fallbackProviderIdForProvider(provider: ProviderConfig) {
  const configured = String(provider.fallbackProviderId || "").trim();
  if (configured) return configured;
  if (provider.id === "image-img2-4k") return env("IMG2_IMAGE_FALLBACK_PROVIDER_ID", "custom-image-1");
  if (provider.id === "image-main") return env("IMAGE_MODEL_FALLBACK_PROVIDER_ID");
  return "";
}

export function sanitizeProvider(provider: ProviderConfig): PublicProvider {
  const normalized = normalizeProvider(provider);
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
    configured: normalized.enabled && hasKey(normalized.apiKey),
    keyPreview: maskedKeyPreview(normalized.apiKey),
  };
}

function capabilitiesFor(provider: Pick<ProviderConfig, "endpointType">) {
  if (provider.endpointType === "images-edits") return ["image", "image-edit"];
  if (provider.endpointType === "images-generations") return ["image"];
  if (provider.endpointType === "gettoken-banana") return ["image", "image-edit"];
  if (provider.endpointType === "gettoken-veo" || provider.endpointType === "videos-generations" || provider.endpointType === "grok-videos") return ["video"];
  if (provider.endpointType === "volcengine-imagex-upscale") return ["image-upscale"];
  if (provider.endpointType === "volcengine-vod-upscale") return ["video-upscale"];
  return [];
}

function shouldExpandProvider(provider: ProviderConfig) {
  return provider.kind === "image" || provider.kind === "video";
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
  if (provider.endpointType === "grok-videos" && model.trim().toLowerCase() === "grok-video-1.5") return "grok";
  const modelDisplayName = normalizeModelDisplayNames(provider.modelDisplayNames)?.[model]
    || (provider.id.startsWith("video-seedance-new") && isDynamicClmmSeedance20Model(model)
      ? clmmSeedanceVideoDisplayName(model)
      : undefined);
  if (modelDisplayName) return modelDisplayName;
  if (!hasMultipleModels) return provider.displayName || model;
  return `${provider.title} · ${model}`;
}

function isRetiredGrokVideoModel(model: string) {
  return model.trim().toLowerCase() === "grok-video-1.0";
}

function expandProviderModels(provider: ProviderConfig) {
  const normalized = normalizeProvider(provider);
  if (!shouldExpandProvider(normalized)) {
    return isRetiredGrokVideoModel(normalized.model) ? [] : [sanitizeProvider(normalized)];
  }
  const models = normalizeModels(normalized.models);
  if (!models.length) return isRetiredGrokVideoModel(normalized.model) ? [] : [sanitizeProvider(normalized)];
  const enabledModels = normalizeModels(normalized.enabledModels);
  const visibleModels = enabledModels.length
    ? models.filter((model) => enabledModels.includes(model))
    : models;
  const activeModels = visibleModels.filter((model) => !isRetiredGrokVideoModel(model));
  return activeModels.map((model) => sanitizeProvider({
    ...normalized,
    id: virtualProviderId(normalized.id, model),
    model,
    displayName: publicDisplayName(normalized, model, activeModels.length > 1),
    videoOptions: providerVideoOptions({ ...normalized, model }),
  }));
}

function mergeStoredProvider(fallback: ProviderConfig, stored: ProviderConfig | undefined) {
  if (!stored) return fallback;
  const storedEndpoint = String(stored.endpointType || "").trim();
  const legacyStored = normalizeLegacyUpscaleProvider(stored);
  if (legacyStored.endpointType !== storedEndpoint) {
    return {
      ...legacyStored,
      apiUrl: fallback.apiUrl,
      model: fallback.model,
      displayName: fallback.displayName,
      apiKey: legacyStored.apiKey || fallback.apiKey,
      endpointType: fallback.endpointType,
    };
  }
  if (fallback.id === "video-main" || fallback.id === "video-seedance-new") {
    const isDynamicClmm = fallback.id === "video-seedance-new";
    const storedModels = normalizeModels(legacyStored.models);
    const storedDisplayNames = normalizeModelDisplayNames(legacyStored.modelDisplayNames);
    const models = isDynamicClmm && storedModels.length ? storedModels : fallback.models;
    const modelDisplayNames = isDynamicClmm
      ? { ...(fallback.modelDisplayNames || {}), ...(storedDisplayNames || {}) }
      : fallback.modelDisplayNames;
    const storedEnabledModels = normalizeModels(legacyStored.enabledModels);
    const enabledModels = isDynamicClmm && storedEnabledModels.length
      ? storedEnabledModels
      : fallback.enabledModels;
    const selectedModel = models?.includes(legacyStored.model) ? legacyStored.model : models?.[0] || fallback.model;
    return {
      ...fallback,
      ...legacyStored,
      model: selectedModel,
      models,
      modelDisplayNames,
      enabledModels,
      title: legacyStored.title || fallback.title,
      role: fallback.role,
      displayName: modelDisplayNames?.[selectedModel] || (isDynamicClmm ? clmmSeedanceVideoDisplayName(selectedModel) : selectedModel),
    };
  }
  if (fallback.id === "prompt-optimizer") {
    return {
      ...fallback,
      ...legacyStored,
      apiUrl: fallback.apiUrl,
      model: fallback.model,
      displayName: fallback.displayName,
      apiKey: fallback.apiKey || legacyStored.apiKey,
      enabled: hasKey(fallback.apiKey || legacyStored.apiKey),
      endpointType: fallback.endpointType,
      title: legacyStored.title || fallback.title,
      role: fallback.role,
    };
  }
  return {
    ...fallback,
    ...legacyStored,
    title: legacyStored.title || fallback.title,
    role: legacyStored.role || fallback.role,
    displayName: legacyStored.displayName,
  };
}

export async function readProviders(): Promise<ProviderConfig[]> {
  const stored = await readJsonFile<ProviderConfig[] | null>(providersPath, null);
  const defaults = defaultProviders();
  if (!stored) return defaults.map(normalizeProvider);

  const byId = new Map(stored.map((provider) => [provider.id, provider]));
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
      && hasKey(provider.apiKey)
    ))
    .flatMap(expandProviderModels);
}

export async function readFrontendProviders(kind?: ProviderKind): Promise<FrontendProvider[]> {
  return (await readProviders())
    .filter((provider) => (
      (!kind || provider.kind === kind)
      && provider.enabled
      && hasKey(provider.apiKey)
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
  if (direct) {
    const normalized = normalizeProvider(direct);
    if (isRetiredGrokVideoModel(normalized.model)) return null;
    if (!normalized.enabled) return null;
    const knownModels = normalizeModels(normalized.models);
    const enabledModels = normalizeModels(normalized.enabledModels);
    if (knownModels.length && enabledModels.length && !enabledModels.includes(normalized.model)) return null;
    return normalized;
  }
  const virtual = parseVirtualProviderId(id);
  if (!virtual) return null;
  if (isRetiredGrokVideoModel(virtual.model)) return null;
  const provider = providers.find((item) => item.id === virtual.providerId);
  if (!provider || !shouldExpandProvider(provider)) return null;
  if (!normalizeProvider(provider).enabled) return null;
  const knownModels = normalizeModels(provider.models);
  if (knownModels.length && !knownModels.includes(virtual.model)) return null;
  const enabledModels = normalizeModels(provider.enabledModels);
  if (enabledModels.length && !enabledModels.includes(virtual.model)) return null;
  const visibleModels = enabledModels.length
    ? knownModels.filter((model) => enabledModels.includes(model))
    : knownModels;
  return normalizeProvider({
    ...provider,
    id,
    model: virtual.model,
    displayName: publicDisplayName(provider, virtual.model, visibleModels.length > 1),
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
  normalizeEndpointType(provider.endpointType, provider.kind);
  if (provider.enabled) {
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
      endpointType: normalizeEndpointType(
        update.endpointType === undefined ? baseProvider.endpointType : update.endpointType,
        update.kind === undefined ? baseProvider.kind : update.kind,
      ),
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
