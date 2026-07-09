"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CalendarCheck, Check, Crown, CreditCard, History, LogOut, Sparkles, WalletCards, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import { FormPanelLoadingFallback, LibraryWorkspaceLoadingFallback, PreviewPanelLoadingFallback } from "@/components/workbench-loading";
import { WorkbenchShell } from "@/components/workbench-shell";
import { ImageGenerator } from "@/components/studio/image-generator";
import { jsonFetch } from "@/components/studio/json-fetch";
import {
  ImageGenerationProgressToast,
  ImagePreviewPanel,
  ImageUpscalePreviewPanel,
  OutputPanel,
  Toast,
  VideoPreviewPanel,
  VideoUpscalePreviewPanel,
} from "@/components/studio/result-preview";
import { MobileActionBar } from "@/components/studio/shared";
import {
  allowedReferenceImageTypes,
  allowedUpscaleVideoTypes,
  defaultVideoDurations,
  defaultUploadLimits,
  formatQuotaSymbolLabel,
  formatQuotaUnits,
  grokVideo10Durations,
  grokVideo10Ratios,
  grokVideo15Durations,
  grokVideo15Ratios,
  jimengVideoRatios,
  maxReferenceImageCount,
  maxReferenceImageSize,
  maxVideoFirstFrameCount,
  promptOptimizationCostLabel,
  promptOptimizationTargetPlatform,
  ratios,
  upscaleUnavailableMessage,
  videoModelReferenceMessage,
} from "@/components/studio/constants";
import type {
  BusinessToolId,
  EnabledProviders,
  ImageGenerationProgressState,
  ImageUpscaleWorkspaceFile,
  ImageUpscaleWorkspaceState,
  ImageWorkspaceFile,
  ImageWorkspaceState,
  LibraryFilter,
  LibrarySort,
  MobileActionState,
  OutputItemState,
  OutputState,
  UpscaleStatusResponse,
  VideoUpscaleWorkspaceFile,
  VideoUpscaleWorkspaceState,
  VideoWorkspaceFile,
  VideoWorkspaceState,
  WorkspacePublicProvider,
  StudioErrorDiagnostic,
} from "@/components/studio/types";
import {
  getPlanStatusDisplay,
  getPlanTone,
  type CheckInStatus,
  type PlanStatus,
} from "@/lib/account-status";
import {
  clearCachedAccountSnapshot,
  readCachedAccountSnapshot,
  writeCachedAccountSnapshot,
} from "@/lib/client/account-snapshot-cache";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import {
  estimateUpscaleQuota,
  estimateImageGenerationTotalQuota,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
  upscaleBillingFingerprint,
} from "@/lib/generation-quota";
import {
  templateById,
  templateTabHref,
} from "@/lib/template-catalog";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder, PublicPaymentChannelConfig } from "@/lib/server/billing";
import type { PublicDailyCheckInRecord, PublicDailyCheckInStatus } from "@/lib/server/check-in";
import type { UsageLogEntry, QuotaSnapshot, UsagePage } from "@/lib/server/quota";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { JobRecord, LibraryItem } from "@/lib/server/types";
import {
  type WorkspaceAction,
  type WorkspaceImageMode,
  type WorkspaceToolId,
  type WorkspaceVideoMode,
  workspaceToolById,
  workspaceToolEntries,
} from "@/lib/workspace-registry";
import type { PublicUploadLimit } from "@/lib/upload-limits";

type BillingOrdersResponse = {
  ok: true;
  orders: BillingOrder[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

type BillingConfigResponse = {
  ok: true;
  channels: PublicPaymentChannelConfig[];
};

type MembershipStatusResponse = {
  ok: true;
  plans: Array<{
    id: string;
    name: string;
    prices: Record<PlanCycle, number>;
    monthly_credits: number;
    recharge_bonus_basis_points: number;
    monthly_entitlements: {
      prompt_optimize: number;
      image_generation: number;
      video_generation: number;
      image_edit: number;
      image_upscale: number;
      video_upscale: number;
    };
  }>;
  membership: {
    active: { plan_id: string; ends_at: string } | null;
    queued: { plan_id: string; starts_at: string; ends_at: string } | null;
    recharge_bonus_basis_points: number;
    entitlements: Record<"prompt_optimize" | "image_generation" | "video_generation" | "image_edit" | "image_upscale" | "video_upscale", {
      remaining: number;
      granted: number;
      used: number;
    }>;
  };
};
type MembershipEntitlements = MembershipStatusResponse["membership"]["entitlements"];
type ImageBillingOperation = "cloud_image_generation" | "cloud_image_edit";

type CheckInResponse = {
  ok: true;
  checkIn: PublicDailyCheckInStatus;
  records: PublicDailyCheckInRecord[];
};

type AccountSummaryResponse = {
  ok: true;
  user: PublicAuthUser;
  quota: QuotaSnapshot | null;
  membership: MembershipStatusResponse;
  checkIn: CheckInResponse;
};

type ClaimCheckInResponse = CheckInResponse & {
  action: "credited" | "already_checked";
  quota_delta: number;
};

type BillingPaymentDescriptor = {
  channel: string;
  provider_order_id: string;
  provider: "sandbox" | "production";
  webhook_path: string;
  sandbox_webhook_path?: string;
  checkout_url?: string;
  qrcode_url?: string;
  qrcode_image_url?: string;
  provider_trade_no?: string;
};

type CreateBillingOrderResponse = {
  ok: true;
  order: BillingOrder;
  payment: BillingPaymentDescriptor;
};

type BillingOrderResponse = {
  ok: true;
  order: BillingOrder;
};

type PaymentDisplay = {
  qrImageUrl: string;
  paymentUrl: string;
  gatewayLabel: string;
};

type AccountView = "center" | "recharge" | "usage" | "orders";
type RechargeTab = "plans" | "credits";
type AccountRecordKind = "spend" | "recharge" | "checkin";
type AccountUsageFilter = "all" | AccountRecordKind;

type PlanOption = {
  id: string;
  name: string;
  rank: number;
  price: number;
  cyclePrices: Record<PlanCycle, number>;
  monthlyCredits: number;
  description: string;
  highlight: string;
  bonusLabel: string;
  perks: string[];
  cyclePriceLabels?: Partial<Record<PlanCycle, string>>;
  recommended?: boolean;
};

type PlanCycle = "monthly" | "quarterly" | "yearly";

type CreditTopUpOption = {
  amount: number;
  credits: number;
  label?: string;
};

type AccountRecord = {
  id: string;
  createdAt: string;
  kind: AccountRecordKind;
  typeLabel: string;
  quotaDelta: number;
  balanceAfterQuotaUnits?: number | null;
  description: string;
};

const planOptions: PlanOption[] = [
  {
    id: "basic",
    name: "基础会员",
    rank: 1,
    price: 29.9,
    cyclePrices: { monthly: 29.9, quarterly: 79, yearly: 299 },
    monthlyCredits: 3600,
    description: "适合电商日常出图与首批客户试用",
    highlight: "新客友好",
    bonusLabel: "此后每月发放 3,600 积分",
    perks: ["会员有效期内，积分充值额外加赠 5%", "送 10 次提示词优化", "送 10 张生图额度", "首屏生成与模板优先体验"],
    cyclePriceLabels: { monthly: "¥29.9 / 月", quarterly: "¥79 / 季", yearly: "¥299 / 年" },
  },
  {
    id: "advanced",
    name: "进阶会员",
    rank: 2,
    price: 59.9,
    cyclePrices: { monthly: 59.9, quarterly: 159, yearly: 599 },
    monthlyCredits: 9000,
    description: "面向持续产出商品图、海报与短视频素材",
    highlight: "创作者常用",
    bonusLabel: "此后每月发放 9,000 积分",
    perks: ["会员有效期内，积分充值额外加赠 10%", "送 30 次提示词优化", "送 30 张生图额度", "送 1 次视频生成"],
    cyclePriceLabels: { monthly: "¥59.9 / 月", quarterly: "¥159 / 季", yearly: "¥599 / 年" },
    recommended: true,
  },
  {
    id: "pro",
    name: "专业会员",
    rank: 3,
    price: 99.9,
    cyclePrices: { monthly: 99.9, quarterly: 279, yearly: 999 },
    monthlyCredits: 16000,
    description: "适合高频商用创作与图片视频混合生产",
    highlight: "商用高频",
    bonusLabel: "此后每月发放 16,000 积分",
    perks: ["会员有效期内，积分充值额外加赠 15%", "送 80 次提示词优化", "送 60 张生图额度", "送 3 次视频生成"],
    cyclePriceLabels: { monthly: "¥99.9 / 月", quarterly: "¥279 / 季", yearly: "¥999 / 年" },
  },
  {
    id: "enterprise",
    name: "企业会员",
    rank: 4,
    price: 199,
    cyclePrices: { monthly: 199, quarterly: 549, yearly: 1999 },
    monthlyCredits: 36000,
    description: "适合团队协作、批量出图和持续视频投放",
    highlight: "团队定向",
    bonusLabel: "此后每月发放 36,000 积分",
    perks: ["会员有效期内，积分充值额外加赠 20%", "送 200 次提示词优化", "送 150 张生图额度", "送 8 次视频生成", "适合团队协作", "支持批量出图", "更高积分额度", "更多视频生成次数", "适合中视频投放"],
    cyclePriceLabels: { monthly: "¥199 / 月", quarterly: "¥549 / 季", yearly: "¥1,999 / 年" },
  },
];

const creditTopUpOptions: CreditTopUpOption[] = [
  { amount: 9.9, credits: 1089, label: "新人首充" },
  { amount: 29.9, credits: 3438, label: "常用" },
  { amount: 59.9, credits: 7188, label: "推荐" },
  { amount: 99.9, credits: 12487, label: "高频" },
  { amount: 199, credits: 25870, label: "最划算" },
  { amount: 299, credits: 40365, label: "商用" },
];

const CREDIT_TOP_UP_BASE_RATE = 100;
const CUSTOM_RECHARGE_MIN_AMOUNT = 1;
const planCycleOptions: Array<{ id: PlanCycle; label: string; badge?: string }> = [
  { id: "monthly", label: "月付优先" },
  { id: "quarterly", label: "季度更省", badge: "赠送更多" },
  { id: "yearly", label: "年度尊享", badge: "价值最高" },
];
const planCycleMonths: Record<PlanCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};
const membershipFaqItems = [
  { title: "有效期怎么算", description: "会员从开通日开始按自然月顺延，续费同套餐会接在当前到期时间之后。" },
  { title: "会不会自动续费", description: "当前不自动续费，也不需要取消自动续费；到期前可手动续费。" },
  { title: "赠送权益有效期", description: "提示词优化次数、生图额度和视频生成次数仅在会员有效期内使用，过期后失效。" },
  { title: "已有积分是否保留", description: "充值或已到账积分在会员到期后仍保留，继续按积分消耗规则使用。" },
  { title: "升级与低等级套餐", description: "升级立即生效；当前不支持降级，高等级会员购买低等级套餐会被禁用。" },
  { title: "支付未到账", description: "支付成功后页面会重新同步积分、会员和订单；若仍未到账，请带订单号联系管理员。" },
];
const CLIENT_VIDEO_SUBMISSION_LIMIT = 1;
const LIBRARY_THUMB_CACHE_WARMUP_CONCURRENCY = 4;
const LIBRARY_FULL_MEDIA_CACHE_WARMUP_DELAY_MS = 5000;
const LIBRARY_FULL_MEDIA_CACHE_WARMUP_CONCURRENCY = 1;

const LibraryPane = dynamic(
  () => import("@/components/studio/library-pane").then((module) => ({ default: module.LibraryPane })),
  { loading: () => <LibraryWorkspaceLoadingFallback /> },
);

const VideoGenerator = dynamic(
  () => import("@/components/studio/video-generator").then((module) => ({ default: module.VideoGenerator })),
  { loading: () => <FormPanelLoadingFallback compact /> },
);

const ImageUpscaleForm = dynamic(
  () => import("@/components/studio/upscale-form").then((module) => ({ default: module.ImageUpscaleForm })),
  { loading: () => <FormPanelLoadingFallback compact /> },
);

const VideoUpscaleForm = dynamic(
  () => import("@/components/studio/upscale-form").then((module) => ({ default: module.VideoUpscaleForm })),
  { loading: () => <FormPanelLoadingFallback compact /> },
);

const WorkspaceAccountPanel = dynamic(
  () => import("@/components/workspace-account-panel").then((module) => ({ default: module.WorkspaceAccountPanel })),
  { loading: () => <PreviewPanelLoadingFallback title="账户概览" /> },
);

function accountViewTitle(view: AccountView) {
  if (view === "recharge") return "会员订阅";
  if (view === "usage") return "积分明细";
  if (view === "orders") return "订单记录";
  return "用户中心";
}

function createTaskId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

type ImageWorkspaceScope = "image" | "image-editor";

function createInitialImageWorkspaceState(): ImageWorkspaceState {
  return {
    providerId: "",
    ratio: "1:1",
    quality: "1k",
    count: 1,
    templateId: "",
    prompt: "",
    promptOptimizing: false,
    promptOptimizeError: "",
    promptOptimizeUndo: "",
    files: [],
    fileError: "",
    submitError: "",
    submitDiagnostic: null,
    inFlightCount: 0,
    loading: false,
  };
}

function withPreviewParam(href: string, previewMode: boolean) {
  if (!previewMode || href.includes("preview=1")) return href;
  return `${href}${href.includes("?") ? "&" : "?"}preview=1`;
}

function fileExtensionFromName(name: string) {
  const baseName = name.split(/[\\/]/).pop() || "";
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : "";
}

function ensureImageFileName(file: File, message = "图像仅支持 PNG、JPEG 和 WebP。") {
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(fileExtensionFromName(file.name))) {
    throw new Error(message);
  }
}

function ensureVideoFileName(file: File, message = "视频高清增强仅支持 MP4、WebM 和 MOV。") {
  if (![".mp4", ".webm", ".mov"].includes(fileExtensionFromName(file.name))) {
    throw new Error(message);
  }
}

function createImageWorkspaceFiles(files: File[]) {
  const nextFiles = files.slice(0, maxReferenceImageCount);
  if (files.length > maxReferenceImageCount) {
    throw new Error(`最多上传 ${maxReferenceImageCount} 张图像。`);
  }
  for (const file of nextFiles) {
    if (!allowedReferenceImageTypes.has(file.type)) {
      throw new Error("图像仅支持 PNG、JPEG 和 WebP。");
    }
    ensureImageFileName(file);
    if (file.size > maxReferenceImageSize) {
      throw new Error(`单张图像不能超过 ${defaultUploadLimits.referenceImage.label}。`);
    }
  }
  return nextFiles.map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

function createVideoWorkspaceFiles(files: File[]) {
  if (files.length > maxVideoFirstFrameCount) {
    throw new Error("图像只能上传 1 张。");
  }
  const nextFiles = files.slice(0, maxVideoFirstFrameCount);
  if (!nextFiles.length) return [];
  const [file] = nextFiles;
  if (!allowedReferenceImageTypes.has(file.type)) {
    throw new Error("图像仅支持 PNG、JPEG 和 WebP。");
  }
  ensureImageFileName(file);
  if (file.size > maxReferenceImageSize) {
    throw new Error(`图像不能超过 ${defaultUploadLimits.referenceImage.label}。`);
  }
  return [{
    file,
    previewUrl: URL.createObjectURL(file),
  }];
}

function createImageUpscaleFile(files: File[], limit: PublicUploadLimit = defaultUploadLimits.imageUpscale) {
  if (files.length > 1) {
    throw new Error("图片高清增强一次只能上传 1 张图片。");
  }
  const [file] = files;
  if (!file) return null;
  if (!allowedReferenceImageTypes.has(file.type)) {
    throw new Error("图片高清增强仅支持 PNG、JPEG 和 WebP。");
  }
  ensureImageFileName(file, "图片高清增强仅支持 PNG、JPEG 和 WebP。");
  if (file.size > limit.bytes) {
    throw new Error(`图片高清增强文件不能超过 ${limit.label}。`);
  }
  return {
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function createVideoUpscaleFile(files: File[], limit: PublicUploadLimit = defaultUploadLimits.videoUpscale) {
  if (files.length > 1) {
    throw new Error("视频高清增强一次只能上传 1 个视频。");
  }
  const [file] = files;
  if (!file) return null;
  if (!allowedUpscaleVideoTypes.has(file.type)) {
    throw new Error("视频高清增强仅支持 MP4、WebM 和 MOV。");
  }
  ensureVideoFileName(file);
  if (file.size > limit.bytes) {
    throw new Error(`视频高清增强文件不能超过 ${limit.label}。`);
  }
  return {
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function extensionFromMimeType(mimeType: string, fallback: string) {
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("mp4")) return ".mp4";
  return fallback;
}

async function fileFromLibraryOutput(item: LibraryItem, fallbackExtension: string, limit: PublicUploadLimit) {
  const output = item.output;
  if (!output?.url) throw new Error("结果文件暂不可用。");
  if (output.size && output.size > limit.bytes) {
    throw new Error(`结果文件不能超过 ${limit.label}。`);
  }

  const response = await fetch(output.url);
  if (!response.ok) throw new Error("结果文件读取失败。");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > limit.bytes) {
    throw new Error(`结果文件不能超过 ${limit.label}。`);
  }

  const blob = await response.blob();
  if (blob.size > limit.bytes) {
    throw new Error(`结果文件不能超过 ${limit.label}。`);
  }
  const mimeType = blob.type || output.mimeType;
  const extension = extensionFromMimeType(mimeType, fallbackExtension);
  const rawName = output.storedName || `${item.id}${extension}`;
  const safeName = (rawName.split(/[\\/]/).pop() || `result${extension}`).replace(/[^\w.-]+/g, "-");
  return new File([blob], safeName, { type: mimeType });
}

function appendQueryParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function warmLibraryMediaCache(items: LibraryItem[]) {
  if (typeof window === "undefined") return;

  const thumbnailUrls: string[] = [];
  const fullMediaUrls: string[] = [];
  for (const item of items) {
    if (item.status !== "done" || item.expired || !item.output?.url?.startsWith("/api/files/")) continue;
    if (item.type === "image") {
      thumbnailUrls.push(appendQueryParam(item.output.url, "view", "thumb"));
    }
    fullMediaUrls.push(item.output.url);
  }

  const uniqueThumbnailUrls = Array.from(new Set(thumbnailUrls));
  const uniqueFullMediaUrls = Array.from(new Set(fullMediaUrls));
  if (!uniqueThumbnailUrls.length && !uniqueFullMediaUrls.length) return;

  const warmUrls = (urls: string[], concurrency: number) => {
    let nextIndex = 0;
    let activeCount = 0;

    const runNext = () => {
      while (activeCount < concurrency && nextIndex < urls.length) {
        const url = urls[nextIndex];
        nextIndex += 1;
        activeCount += 1;
        void fetch(url, {
          credentials: "same-origin",
          cache: "force-cache",
        }).catch(() => undefined).finally(() => {
          activeCount -= 1;
          runNext();
        });
      }
    };

    runNext();
  };

  const warm = () => {
    warmUrls(uniqueThumbnailUrls, LIBRARY_THUMB_CACHE_WARMUP_CONCURRENCY);
    window.setTimeout(() => {
      warmUrls(uniqueFullMediaUrls, LIBRARY_FULL_MEDIA_CACHE_WARMUP_CONCURRENCY);
    }, LIBRARY_FULL_MEDIA_CACHE_WARMUP_DELAY_MS);
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(warm, { timeout: 1500 });
  } else {
    window.setTimeout(warm, 500);
  }
}

function isGrokVideoProvider(provider: WorkspacePublicProvider | null | undefined) {
  return provider?.endpointType === "grok-videos" || Boolean(provider?.model.startsWith("grok-video-"));
}

function jimengVideoOptions(provider: WorkspacePublicProvider | null | undefined) {
  const model = provider?.model.trim().toLowerCase() || "";
  if (!model.includes("seedance2.0")) return null;
  if (model.includes("15s")) return { durations: [15], ratios: jimengVideoRatios };
  if (model.includes("10s-nyp")) return { durations: [5, 10], ratios: jimengVideoRatios };
  return { durations: [5, 10, 15], ratios: jimengVideoRatios };
}

function videoDurationOptions(provider: WorkspacePublicProvider | null | undefined) {
  if (provider?.videoOptions?.durations?.length) return provider.videoOptions.durations;
  const jimengOptions = jimengVideoOptions(provider);
  if (jimengOptions) return jimengOptions.durations;
  if (!isGrokVideoProvider(provider)) return defaultVideoDurations;
  return provider?.model === "grok-video-1.5" ? grokVideo15Durations : grokVideo10Durations;
}

function videoRatioOptions(provider: WorkspacePublicProvider | null | undefined) {
  if (provider?.videoOptions?.ratios?.length) return provider.videoOptions.ratios;
  const jimengOptions = jimengVideoOptions(provider);
  if (jimengOptions) return jimengOptions.ratios;
  if (!isGrokVideoProvider(provider)) return ratios;
  return provider?.model === "grok-video-1.5" ? grokVideo15Ratios : grokVideo10Ratios;
}

function videoProviderRequiresReferenceImage(provider: WorkspacePublicProvider | null | undefined) {
  return provider?.model === "grok-video-1.5";
}

function diagnosticFromError(error: unknown): StudioErrorDiagnostic | null {
  return error instanceof ApiError ? error.diagnostic || null : null;
}

export function StudioApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const toolParam = searchParams.get("tool");
  const accountParam = searchParams.get("account");
  const previewMode = searchParams.get("preview") === "1";
  const initialWorkspaceToolId = useMemo<WorkspaceToolId>(() => {
    if (toolParam) {
      const tool = workspaceToolById(toolParam as WorkspaceToolId);
      if (tool) return tool.id;
    }
    return "image";
  }, [toolParam]);
  const [activeWorkspaceToolId, setActiveWorkspaceToolId] = useState<WorkspaceToolId>(initialWorkspaceToolId);
  const [providers, setProviders] = useState<EnabledProviders>({ image: [], video: [] });
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryNeedsRefresh, setLibraryNeedsRefresh] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [sessionUser, setSessionUser] = useState<PublicAuthUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [quotaSnapshot, setQuotaSnapshot] = useState<QuotaSnapshot | null>(null);
  const [checkInSnapshot, setCheckInSnapshot] = useState<PublicDailyCheckInStatus | null>(null);
  const [checkInRecords, setCheckInRecords] = useState<PublicDailyCheckInRecord[]>([]);
  const [usagePage, setUsagePage] = useState<UsagePage | null>(null);
  const [billingOrders, setBillingOrders] = useState<BillingOrder[]>([]);
  const [membershipSnapshot, setMembershipSnapshot] = useState<MembershipStatusResponse | null>(null);
  const [accountSummaryLoading, setAccountSummaryLoading] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [accountUsageLoading, setAccountUsageLoading] = useState(false);
  const [accountOrdersLoading, setAccountOrdersLoading] = useState(false);
  const [accountSummaryLoaded, setAccountSummaryLoaded] = useState(false);
  const [checkInLoaded, setCheckInLoaded] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [accountUsageLoaded, setAccountUsageLoaded] = useState(false);
  const [accountOrdersLoaded, setAccountOrdersLoaded] = useState(false);
  const [accountDataError, setAccountDataError] = useState("");
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView>("center");
  const [accountCloseSignal, setAccountCloseSignal] = useState(0);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [imageGenerationProgress, setImageGenerationProgress] = useState<ImageGenerationProgressState>([]);
  const [generationProgressTick, setGenerationProgressTick] = useState(() => Date.now());
  const [outputs, setOutputs] = useState<Partial<Record<BusinessToolId, OutputState>>>({});
  const [imageOutputs, setImageOutputs] = useState<OutputItemState[]>([]);
  const [imageRequestScope, setImageRequestScope] = useState<ImageWorkspaceScope | null>(null);
  const [imageResultScope, setImageResultScope] = useState<ImageWorkspaceScope | null>(null);
  const [mobileAction, setMobileAction] = useState<MobileActionState>(null);
  const [mobilePreviewSignal, setMobilePreviewSignal] = useState(0);
  const [uploadLimits, setUploadLimits] = useState(defaultUploadLimits);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("image");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("created-desc");
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryDeleteConfirmItemId, setLibraryDeleteConfirmItemId] = useState<string | null>(null);
  const [deletingLibraryItemId, setDeletingLibraryItemId] = useState<string | null>(null);
  const [bulkDeletingLibrary, setBulkDeletingLibrary] = useState(false);
  const [removingLibraryItemId, setRemovingLibraryItemId] = useState<string | null>(null);
  const [missingLibraryMediaIds, setMissingLibraryMediaIds] = useState<Set<string>>(() => new Set());
  const [imageWorkspace, setImageWorkspace] = useState<ImageWorkspaceState>(() => createInitialImageWorkspaceState());
  const [imageEditorWorkspace, setImageEditorWorkspace] = useState<ImageWorkspaceState>(() => createInitialImageWorkspaceState());
  const [videoWorkspace, setVideoWorkspace] = useState<VideoWorkspaceState>({
    providerId: "",
    ratio: "16:9",
    duration: 5,
    templateId: "",
    prompt: "",
    promptOptimizing: false,
    promptOptimizeError: "",
    promptOptimizeUndo: "",
    files: [],
    fileError: "",
    submitError: "",
    submitDiagnostic: null,
    inFlightCount: 0,
    loading: false,
    job: null,
  });
  const [imageUpscaleWorkspace, setImageUpscaleWorkspace] = useState<ImageUpscaleWorkspaceState>({
    scale: "2",
    file: null,
    fileError: "",
    submitError: "",
    submitDiagnostic: null,
    loading: false,
    statusLoading: true,
    checked: false,
    availability: null,
    statusError: "",
  });
  const [videoUpscaleWorkspace, setVideoUpscaleWorkspace] = useState<VideoUpscaleWorkspaceState>({
    scale: "1",
    file: null,
    fileError: "",
    submitError: "",
    submitDiagnostic: null,
    loading: false,
    statusLoading: true,
    checked: false,
    availability: null,
    statusError: "",
    job: null,
  });
  const imageWorkspaceFilesRef = useRef<ImageWorkspaceFile[]>([]);
  const imageEditorWorkspaceFilesRef = useRef<ImageWorkspaceFile[]>([]);
  const videoWorkspaceFilesRef = useRef<VideoWorkspaceFile[]>([]);
  const imageUpscaleFileRef = useRef<ImageUpscaleWorkspaceFile | null>(null);
  const videoUpscaleFileRef = useRef<VideoUpscaleWorkspaceFile | null>(null);
  const appliedTemplateIdRef = useRef<string | null>(null);
  const imageInFlightCountRef = useRef(0);
  const imageEditorInFlightCountRef = useRef(0);
  const videoInFlightCountRef = useRef(0);
  const imageUpscaleInFlightRef = useRef(false);
  const videoUpscaleInFlightRef = useRef(false);
  const accountPlanStatus = useMemo<PlanStatus>(() => {
    if ((sessionLoading || accountSummaryLoading) && !membershipSnapshot) return { status: "loading" };
    const activePlanId = membershipSnapshot?.membership.active?.plan_id;
    const activePlan = activePlanId ? planOptions.find((plan) => plan.id === activePlanId) : null;
    if (activePlan) return { status: "active", name: activePlan.name };
    return sessionUser ? { status: "none" } : { status: "unavailable" };
  }, [accountSummaryLoading, membershipSnapshot, sessionLoading, sessionUser]);
  const accountCheckInStatus = useMemo<CheckInStatus>(() => {
    if (!sessionUser) return "unavailable";
    if ((sessionLoading || checkInLoading) && !checkInLoaded && !checkInSnapshot) return "loading";
    if (checkInSubmitting) return "submitting";
    if (checkInError) return "error";
    if (!checkInLoaded && !checkInSnapshot) return "loading";
    return checkInSnapshot?.status === "checked" ? "checked" : "available";
  }, [checkInError, checkInLoaded, checkInLoading, checkInSnapshot, checkInSubmitting, sessionLoading, sessionUser]);
  const applyCachedAccountSnapshot = useCallback((userId: string | null | undefined) => {
    const cached = readCachedAccountSnapshot(userId);
    if (!cached) return false;

    setQuotaSnapshot(cached.quota);
    setMembershipSnapshot(cached.membership as MembershipStatusResponse | null);
    setAccountSummaryLoaded(Boolean(cached.quota || cached.membership));
    if (cached.checkInStatus === "available") {
      setCheckInLoaded(true);
    }
    return true;
  }, []);

  useEffect(() => {
    const userId = sessionUser?.local_user_id || null;
    if (!userId || !accountSummaryLoaded) return;

    writeCachedAccountSnapshot({
      userId,
      user: sessionUser,
      quota: quotaSnapshot,
      membership: membershipSnapshot,
      checkInStatus: accountCheckInStatus,
    });
  }, [accountCheckInStatus, accountSummaryLoaded, membershipSnapshot, quotaSnapshot, sessionUser, sessionUser?.local_user_id]);
  const resetLibraryState = useCallback(() => {
    setLibrary([]);
    setLibraryLoading(false);
    setLibraryLoaded(false);
    setLibraryNeedsRefresh(false);
    setLibraryError("");
    setMissingLibraryMediaIds(new Set());
  }, []);
  const resetAccountState = useCallback(() => {
    setQuotaSnapshot(null);
    setCheckInSnapshot(null);
    setCheckInRecords([]);
    setUsagePage(null);
    setBillingOrders([]);
    setMembershipSnapshot(null);
    setAccountDataError("");
    setCheckInError("");
    setAccountSummaryLoading(false);
    setCheckInLoading(false);
    setCheckInSubmitting(false);
    setAccountUsageLoading(false);
    setAccountOrdersLoading(false);
    setAccountSummaryLoaded(false);
    setCheckInLoaded(false);
    setAccountUsageLoaded(false);
    setAccountOrdersLoaded(false);
  }, []);

  const applyAccountSummary = useCallback((summary: AccountSummaryResponse) => {
    setSessionUser(summary.user);
    setQuotaSnapshot(summary.quota);
    setMembershipSnapshot(summary.membership);
    setCheckInSnapshot(summary.checkIn.checkIn);
    setCheckInRecords(summary.checkIn.records || []);
    setAccountSummaryLoaded(Boolean(summary.quota || summary.membership));
    setCheckInLoaded(true);
    setAccountDataError(summary.quota ? "" : "account-data-unavailable");
    setCheckInError("");
  }, []);

  const refreshQuotaSnapshot = useCallback(async (userId?: string | null) => {
    if (!userId) {
      resetAccountState();
      return;
    }

    setAccountSummaryLoading(true);
    setCheckInLoading(true);
    try {
      const summary = await fetchJson<AccountSummaryResponse>("/api/account/summary");
      applyAccountSummary(summary);
    } catch (error) {
      setQuotaSnapshot(null);
      setMembershipSnapshot(null);
      setCheckInSnapshot(null);
      setCheckInRecords([]);
      setAccountDataError("account-data-unavailable");
      setCheckInError("check-in-unavailable");
      if (process.env.NODE_ENV !== "production") {
        console.debug("[account] Failed to load account summary", error);
      }
    } finally {
      setAccountSummaryLoading(false);
      setCheckInLoading(false);
    }
  }, [applyAccountSummary, resetAccountState]);

  const refreshUsageSnapshot = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setUsagePage(null);
      setAccountUsageLoaded(false);
      return;
    }

    setAccountUsageLoading(true);
    try {
      const usageResult = await fetchJson<{ ok: true; usage: UsagePage }>("/api/usage?page=1&pageSize=10");
      setUsagePage(usageResult.usage);
      setAccountUsageLoaded(true);
    } catch (error) {
      setUsagePage(null);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[account] Failed to load usage snapshot", error);
      }
    } finally {
      setAccountUsageLoading(false);
    }
  }, []);

  const refreshBillingOrdersSnapshot = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setBillingOrders([]);
      setAccountOrdersLoaded(false);
      return;
    }

    setAccountOrdersLoading(true);
    try {
      const ordersResult = await fetchJson<BillingOrdersResponse>("/api/billing/orders?page=1&pageSize=20");
      setBillingOrders(ordersResult.orders);
      setAccountOrdersLoaded(true);
    } catch (error) {
      setBillingOrders([]);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[account] Failed to load billing orders", error);
      }
    } finally {
      setAccountOrdersLoading(false);
    }
  }, []);

  const ensureAccountViewData = useCallback(async (
    view: AccountView,
    userId?: string | null,
    options?: { force?: boolean },
  ) => {
    if (!userId) {
      resetAccountState();
      return;
    }

    const tasks: Array<Promise<void>> = [];
    const needsSummary = options?.force || !accountSummaryLoaded || !checkInLoaded;
    if (needsSummary) {
      tasks.push(refreshQuotaSnapshot(userId));
    }
    if (view !== "recharge" && (options?.force || !accountUsageLoaded)) {
      tasks.push(refreshUsageSnapshot(userId));
    }
    if ((view === "center" || view === "usage" || view === "orders") && (options?.force || !accountOrdersLoaded)) {
      tasks.push(refreshBillingOrdersSnapshot(userId));
    }
    if (tasks.length) {
      await Promise.all(tasks);
    }
  }, [
    accountOrdersLoaded,
    accountSummaryLoaded,
    accountUsageLoaded,
    checkInLoaded,
    refreshBillingOrdersSnapshot,
    refreshQuotaSnapshot,
    refreshUsageSnapshot,
    resetAccountState,
  ]);

  const handleLogout = useCallback(async () => {
    if (!sessionUser) return;
    try {
      await fetchJsonWithCsrf("/api/auth/logout", { method: "POST" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败。");
    } finally {
      setSessionUser(null);
      clearCachedAccountSnapshot();
      resetAccountState();
      resetLibraryState();
      imageInFlightCountRef.current = 0;
      imageEditorInFlightCountRef.current = 0;
      videoInFlightCountRef.current = 0;
      setImageGenerationProgress([]);
      setLogoutConfirmOpen(false);
      router.replace("/login");
    }
  }, [resetAccountState, resetLibraryState, router, sessionUser]);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError("");
    try {
      const result = await fetchJson<AccountSummaryResponse>("/api/account/summary");
      if ("ok" in result && result.ok) {
        applyCachedAccountSnapshot(result.user.local_user_id);
        applyAccountSummary(result);
        return;
      }
      setSessionUser(null);
      clearCachedAccountSnapshot();
      resetAccountState();
      resetLibraryState();
      setImageGenerationProgress([]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSessionUser(null);
        clearCachedAccountSnapshot();
        resetAccountState();
        resetLibraryState();
        setImageGenerationProgress([]);
      } else {
        const text = error instanceof Error ? error.message : "会话加载失败。";
        setSessionError(text);
        setMessage(text);
      }
    } finally {
      setSessionLoading(false);
    }
  }, [applyAccountSummary, applyCachedAccountSnapshot, resetAccountState, resetLibraryState]);

  const refreshAccountSnapshot = useCallback(async () => {
    await ensureAccountViewData(accountView, sessionUser?.local_user_id || null, { force: true });
  }, [accountView, ensureAccountViewData, sessionUser?.local_user_id]);

  useEffect(() => {
    if (sessionLoading) return;
    const userId = sessionUser?.local_user_id || null;
    if (!userId) {
      clearCachedAccountSnapshot();
      resetAccountState();
      return;
    }
    applyCachedAccountSnapshot(userId);
    if (!accountSummaryLoaded || !checkInLoaded) void refreshQuotaSnapshot(userId);
  }, [
    accountSummaryLoaded,
    applyCachedAccountSnapshot,
    checkInLoaded,
    refreshQuotaSnapshot,
    resetAccountState,
    sessionLoading,
    sessionUser?.local_user_id,
  ]);

  const refreshLibrary = useCallback(async (options?: { force?: boolean }) => {
    if (!sessionUser?.local_user_id) {
      resetLibraryState();
      return;
    }
    if (!options?.force && libraryLoaded && !libraryNeedsRefresh) return;

    setLibraryLoading(true);
    setLibraryError("");
    try {
      const data = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
      setLibrary(data.items);
      setMissingLibraryMediaIds(new Set());
      setLibraryLoaded(true);
      setLibraryNeedsRefresh(false);
      warmLibraryMediaCache(data.items);
    } catch (error) {
      const text = error instanceof Error ? error.message : "作品库加载失败。";
      setLibraryError(text);
      throw error;
    } finally {
      setLibraryLoading(false);
    }
  }, [libraryLoaded, libraryNeedsRefresh, resetLibraryState, sessionUser?.local_user_id]);

  const refreshLibraryAfterMutation = useCallback(async () => {
    if (!sessionUser?.local_user_id) return;
    if (libraryLoaded) {
      await refreshLibrary({ force: true });
      return;
    }
    setLibraryNeedsRefresh(true);
  }, [libraryLoaded, refreshLibrary, sessionUser?.local_user_id]);

  const refreshAccountAfterGeneration = useCallback(async () => {
    const userId = sessionUser?.local_user_id || null;
    await refreshQuotaSnapshot(userId);
    if (accountCenterOpen || accountUsageLoaded) {
      await refreshUsageSnapshot(userId);
    }
    if (accountView === "usage" && accountOrdersLoaded) {
      await refreshBillingOrdersSnapshot(userId);
    }
  }, [
    accountCenterOpen,
    accountOrdersLoaded,
    accountUsageLoaded,
    accountView,
    refreshBillingOrdersSnapshot,
    refreshQuotaSnapshot,
    refreshUsageSnapshot,
    sessionUser?.local_user_id,
  ]);

  const refreshAccountAfterPrecheck = useCallback(async () => {
    const userId = sessionUser?.local_user_id || null;
    await refreshQuotaSnapshot(userId);
    if (accountCenterOpen || accountUsageLoaded) {
      await refreshUsageSnapshot(userId);
    }
  }, [
    accountCenterOpen,
    accountUsageLoaded,
    refreshQuotaSnapshot,
    refreshUsageSnapshot,
    sessionUser?.local_user_id,
  ]);

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError("");
    try {
      const data = await jsonFetch<{ providers: EnabledProviders }>("/api/providers/enabled");
      setProviders(data.providers);
    } catch (error) {
      const text = error instanceof Error ? error.message : "模型加载失败。";
      setProvidersError(text);
      setMessage(text);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setProvidersLoading(true);
        const providersData = await jsonFetch<{ providers: EnabledProviders }>("/api/providers/enabled");
        if (cancelled) return;
        setProviders(providersData.providers);
        setProvidersError("");
      } catch (error) {
        if (!cancelled) {
          const text = error instanceof Error ? error.message : "加载失败。";
          setProvidersError(text);
          setMessage(text);
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    })();

    void refreshSession();

    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => () => {
    imageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    imageEditorWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    videoWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    if (imageUpscaleFileRef.current) URL.revokeObjectURL(imageUpscaleFileRef.current.previewUrl);
    if (videoUpscaleFileRef.current) URL.revokeObjectURL(videoUpscaleFileRef.current.previewUrl);
  }, []);

  useEffect(() => {
    setImageWorkspace((prev) => {
      const nextProviders = providers.image;
      if (!nextProviders.length) {
        return prev.providerId ? { ...prev, providerId: "" } : prev;
      }
      if (nextProviders.some((provider) => provider.id === prev.providerId)) return prev;
      return { ...prev, providerId: nextProviders[0].id };
    });
    setImageEditorWorkspace((prev) => {
      const nextProviders = providers.image;
      if (!nextProviders.length) {
        return prev.providerId ? { ...prev, providerId: "" } : prev;
      }
      if (nextProviders.some((provider) => provider.id === prev.providerId)) return prev;
      return { ...prev, providerId: nextProviders[0].id };
    });
  }, [providers.image]);

  useEffect(() => {
    setVideoWorkspace((prev) => {
      const nextProviders = providers.video;
      if (!nextProviders.length) {
        return prev.providerId ? { ...prev, providerId: "" } : prev;
      }
      if (nextProviders.some((provider) => provider.id === prev.providerId)) return prev;
      return { ...prev, providerId: nextProviders[0].id, submitError: "", submitDiagnostic: null };
    });
  }, [providers.video]);

  const handleToolAction = useCallback((action: WorkspaceAction, tool: WorkspaceToolId) => {
    setAccountCenterOpen(false);
    if (action.kind === "route") {
      router.push(action.href);
      return;
    }

    const nextImageMode = action.mode === "text-to-image" || action.mode === "image-to-image" ? action.mode : null;
    if (action.toolId === "image" && nextImageMode) {
      if (tool === "image-editor") {
        setImageEditorWorkspace((prev) => ({ ...prev, submitError: "", submitDiagnostic: null, fileError: "" }));
      } else {
        setImageWorkspace((prev) => ({ ...prev, submitError: "", submitDiagnostic: null, fileError: "" }));
      }
    }

    const nextVideoMode = action.mode === "text-to-video" || action.mode === "image-to-video" ? action.mode : null;
    if (action.toolId === "video" && nextVideoMode) {
      setVideoWorkspace((prev) => ({ ...prev, fileError: "", submitError: "", submitDiagnostic: null }));
    }

    setActiveWorkspaceToolId(tool);
  }, [router]);

  const activeWorkspaceTool = workspaceToolById(activeWorkspaceToolId) || workspaceToolEntries[0];
  const activeAction = activeWorkspaceTool.action.kind === "workspace" ? activeWorkspaceTool.action : null;
  const activeBusinessTool = activeAction?.toolId || "library";
  const activeOutput = outputs[activeBusinessTool] || null;
  const activeImageWorkspaceScope: ImageWorkspaceScope = activeWorkspaceToolId === "image-editor" ? "image-editor" : "image";
  const activeImageWorkspace = activeImageWorkspaceScope === "image-editor" ? imageEditorWorkspace : imageWorkspace;
  const activeImageWorkspaceFilesRef = activeImageWorkspaceScope === "image-editor" ? imageEditorWorkspaceFilesRef : imageWorkspaceFilesRef;
  const activeImageWorkspaceSetter = activeImageWorkspaceScope === "image-editor" ? setImageEditorWorkspace : setImageWorkspace;
  const activeImageInFlightCountRef = activeImageWorkspaceScope === "image-editor" ? imageEditorInFlightCountRef : imageInFlightCountRef;
  const activeImageMode: WorkspaceImageMode = activeImageWorkspaceScope === "image-editor" || activeImageWorkspace.files.length
    ? "image-to-image"
    : "text-to-image";
  const activeVideoMode: WorkspaceVideoMode = videoWorkspace.files.length ? "image-to-video" : "text-to-video";
  const templateParam = searchParams.get("template") || "";
  const activeImageTemplate = useMemo(() => templateById(activeImageWorkspace.templateId), [activeImageWorkspace.templateId]);
  const activeVideoTemplate = useMemo(() => templateById(videoWorkspace.templateId), [videoWorkspace.templateId]);
  const imageTemplateCenterHref = useMemo(
    () => withPreviewParam(templateTabHref("image"), previewMode),
    [previewMode],
  );
  const videoTemplateCenterHref = useMemo(
    () => withPreviewParam(templateTabHref("video"), previewMode),
    [previewMode],
  );

  useEffect(() => {
    if (activeBusinessTool !== "library") return;
    if (sessionLoading) return;
    if (!sessionUser?.local_user_id) {
      resetLibraryState();
      return;
    }
    if (libraryLoaded && !libraryNeedsRefresh) return;
    void refreshLibrary({ force: libraryNeedsRefresh });
  }, [
    activeBusinessTool,
    libraryLoaded,
    libraryNeedsRefresh,
    refreshLibrary,
    resetLibraryState,
    sessionLoading,
    sessionUser?.local_user_id,
  ]);

  useEffect(() => {
    if (!accountCenterOpen) return;
    if (sessionLoading) return;
    if (!sessionUser?.local_user_id) {
      resetAccountState();
      return;
    }
    void ensureAccountViewData(accountView, sessionUser.local_user_id);
  }, [
    accountCenterOpen,
    accountView,
    ensureAccountViewData,
    resetAccountState,
    sessionLoading,
    sessionUser?.local_user_id,
  ]);

  const applyTemplatePreset = useCallback((templateId: string) => {
    const template = templateById(templateId);
    if (!template) return;

    setMessage("");

    if (template.scope === "image") {
      setActiveWorkspaceToolId(template.targetToolId);
      const setWorkspace = template.targetToolId === "image-editor" ? setImageEditorWorkspace : setImageWorkspace;
      setWorkspace((prev) => ({
        ...prev,
        templateId: template.id,
        prompt: template.prompt,
        ratio: template.aspectRatio,
        quality: template.quality,
        count: 1,
        fileError: template.requiresImage && !prev.files.length ? "请先上传图像。" : "",
        promptOptimizeError: "",
        promptOptimizeUndo: "",
        submitError: "",
        submitDiagnostic: null,
      }));
      return;
    }

    setActiveWorkspaceToolId("video");
    setVideoWorkspace((prev) => ({
      ...prev,
      templateId: template.id,
      prompt: template.prompt,
      ratio: template.aspectRatio,
      duration: template.duration,
      fileError: template.requiresImage && !prev.files.length ? "请先上传图像。" : "",
      promptOptimizeError: "",
      promptOptimizeUndo: "",
      submitError: "",
      submitDiagnostic: null,
    }));
  }, []);

  useEffect(() => {
    if (!templateParam || appliedTemplateIdRef.current === templateParam) return;
    const template = templateById(templateParam);
    if (!template) return;
    appliedTemplateIdRef.current = templateParam;
    applyTemplatePreset(templateParam);
  }, [applyTemplatePreset, templateParam]);

  useEffect(() => {
    if (accountParam !== "center" && accountParam !== "recharge" && accountParam !== "usage" && accountParam !== "orders") return;
    setAccountCenterOpen(true);
    setAccountView(accountParam);
    setAccountCloseSignal((value) => value + 1);
  }, [accountParam]);

  const currentLibraryItems = useMemo(() => {
    const filtered = library.filter((item) => item.type === libraryFilter);
    const sorted = [...filtered];
    if (librarySort === "created-desc") {
      sorted.sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
    } else if (librarySort === "created-asc") {
      sorted.sort((a, b) => Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)));
    } else if (librarySort === "size-desc") {
      sorted.sort((a, b) => (b.output?.size || 0) - (a.output?.size || 0));
    } else {
      sorted.sort((a, b) => (a.output?.size || 0) - (b.output?.size || 0));
    }
    return sorted;
  }, [library, libraryFilter, librarySort]);

  const selectedLibraryItem = useMemo(
    () => currentLibraryItems.find((item) => item.id === selectedLibraryItemId) || null,
    [currentLibraryItems, selectedLibraryItemId],
  );
  const handleOpenAccountCenter = useCallback(() => {
    setAccountCenterOpen(true);
    setAccountView("center");
    setAccountCloseSignal((value) => value + 1);
  }, []);

  const handleOpenRechargeCenter = useCallback(() => {
    setAccountCenterOpen(true);
    setAccountView("recharge");
    setAccountCloseSignal((value) => value + 1);
  }, []);

  const handleOpenUsageRecords = useCallback(() => {
    setAccountCenterOpen(true);
    setAccountView("usage");
    setAccountCloseSignal((value) => value + 1);
  }, []);

  const handleOpenOrderRecords = useCallback(() => {
    setAccountCenterOpen(true);
    setAccountView("orders");
    setAccountCloseSignal((value) => value + 1);
  }, []);

  const handleCheckIn = useCallback(async () => {
    const userId = sessionUser?.local_user_id || null;
    if (!userId || checkInSubmitting) return;
    setCheckInSubmitting(true);
    setCheckInError("");
    try {
      const result = await fetchJsonWithCsrf<ClaimCheckInResponse>("/api/check-in", { method: "POST" });
      setCheckInSnapshot(result.checkIn);
      setCheckInRecords(result.records || []);
      setCheckInLoaded(true);
      await Promise.all([
        refreshQuotaSnapshot(userId),
        refreshUsageSnapshot(userId),
      ]);
      if ((accountView === "usage" || accountView === "orders") && accountOrdersLoaded) {
        await refreshBillingOrdersSnapshot(userId);
      }
      setMessage(result.action === "credited" ? `签到成功，已领取 ${result.quota_delta} 积分。` : "今日已签到。");
    } catch (error) {
      setCheckInError("check-in-unavailable");
      setMessage(error instanceof Error ? error.message : "签到失败，请稍后重试。");
    } finally {
      setCheckInSubmitting(false);
    }
  }, [
    accountOrdersLoaded,
    accountView,
    checkInSubmitting,
    refreshBillingOrdersSnapshot,
    refreshQuotaSnapshot,
    refreshUsageSnapshot,
    sessionUser?.local_user_id,
  ]);

  const markLibraryMediaMissing = useCallback((id: string) => {
    setMissingLibraryMediaIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const handleRequestDeleteLibraryItem = useCallback(async (id: string) => {
    if (deletingLibraryItemId) return;
    setLibraryDeleteConfirmItemId(id);
  }, [deletingLibraryItemId]);

  const handleCancelDeleteLibraryItem = useCallback(() => {
    if (deletingLibraryItemId) return;
    setLibraryDeleteConfirmItemId(null);
  }, [deletingLibraryItemId]);

  useEffect(() => {
    if (!selectedLibraryItemId && !libraryDeleteConfirmItemId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deletingLibraryItemId) return;
      if (libraryDeleteConfirmItemId) {
        setLibraryDeleteConfirmItemId(null);
        return;
      }
      setSelectedLibraryItemId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deletingLibraryItemId, libraryDeleteConfirmItemId, selectedLibraryItemId]);

  const handleConfirmDeleteLibraryItem = useCallback(async () => {
    if (!libraryDeleteConfirmItemId || deletingLibraryItemId) return;
    const id = libraryDeleteConfirmItemId;

    setDeletingLibraryItemId(id);
    setLibraryError("");
    try {
      await jsonFetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setRemovingLibraryItemId(id);
      setSelectedLibraryItemId((current) => (current === id ? null : current));
      setLibraryDeleteConfirmItemId(null);
      if (!prefersReducedMotion) {
        await new Promise((resolve) => window.setTimeout(resolve, 220));
      }
      setLibrary((current) => current.filter((item) => item.id !== id));
      setMissingLibraryMediaIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除失败。";
      setLibraryError(text);
      setMessage(text);
    } finally {
      setDeletingLibraryItemId(null);
      setRemovingLibraryItemId(null);
    }
  }, [deletingLibraryItemId, libraryDeleteConfirmItemId, prefersReducedMotion]);

  const handleDeleteManyLibraryItems = useCallback(async (ids: string[]) => {
    const deleteIds = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)));
    if (!deleteIds.length || bulkDeletingLibrary) return;

    setBulkDeletingLibrary(true);
    setLibraryError("");
    try {
      const result = await jsonFetch<{ deletedIds?: string[] }>("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deleteIds }),
      });
      const deletedIds = Array.isArray(result.deletedIds) && result.deletedIds.length ? result.deletedIds : deleteIds;
      setSelectedLibraryItemId((current) => (current && deletedIds.includes(current) ? null : current));
      setLibrary((current) => current.filter((item) => !deletedIds.includes(item.id)));
      setMissingLibraryMediaIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "批量删除失败。";
      setLibraryError(text);
      setMessage(text);
    } finally {
      setBulkDeletingLibrary(false);
    }
  }, [bulkDeletingLibrary]);

  const libraryCounts = useMemo(() => ({
    all: library.length,
    image: library.filter((item) => item.type === "image").length,
    video: library.filter((item) => item.type === "video").length,
  }), [library]);
  const libraryDeleteConfirmItem = useMemo(
    () => library.find((item) => item.id === libraryDeleteConfirmItemId) || null,
    [library, libraryDeleteConfirmItemId],
  );
  const accountSummaryBusy = sessionLoading || (accountSummaryLoading && !quotaSnapshot && !membershipSnapshot);
  const accountViewLoading = sessionLoading
    || (accountView === "usage" || accountView === "orders"
      ? accountSummaryLoading || checkInLoading || accountUsageLoading || accountOrdersLoading
      : accountView === "center"
        ? accountSummaryLoading || checkInLoading || accountUsageLoading || accountOrdersLoading
        : accountSummaryLoading);
  const libraryPanelLoading = activeBusinessTool === "library"
    && (sessionLoading || (Boolean(sessionUser) && !libraryLoaded))
    ? true
    : libraryLoading;

  const accountHeaderSlot = (
    <div className="workspace-account-chip hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/68 md:flex">
      <span>{sessionUser ? sessionUser.display_name : "未登录"}</span>
      <span className="text-white/38">/</span>
      <strong className="text-white">{accountSummaryBusy ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} ✦` : "—"}</strong>
    </div>
  );
  const membershipEntitlements = membershipSnapshot?.membership.entitlements ?? null;

  const handleImageResult = useCallback((item: LibraryItem, options?: { append?: boolean; scope?: ImageWorkspaceScope | null }) => {
    const nextOutput: OutputItemState = { item, title: "图片结果", tool: "image" };
    setOutputs((prev) => ({ ...prev, image: nextOutput }));
    setImageResultScope(options?.scope || null);
    setImageOutputs((prev) => {
      if (!options?.append) return [nextOutput];
      const withoutDuplicate = prev.filter((output) => output.item.id !== item.id);
      return [...withoutDuplicate, nextOutput];
    });
  }, []);

  useEffect(() => {
    if (!imageGenerationProgress.some((progress) => progress.status === "running")) return undefined;

    const timer = window.setInterval(() => setGenerationProgressTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [imageGenerationProgress]);

  const selectedImageProvider = useMemo(() => {
    if (!providers.image.length) return null;
    return providers.image.find((provider) => provider.id === activeImageWorkspace.providerId) || providers.image[0];
  }, [activeImageWorkspace.providerId, providers.image]);

  const imageWorkspaceFiles = activeImageWorkspace.files;
  const imageWorkspaceHasFiles = imageWorkspaceFiles.length > 0;
  const imageWorkspacePrompt = activeImageWorkspace.prompt.trim();
  const imageWorkspaceRequiresFile = activeImageTemplate?.scope === "image" && activeImageTemplate.requiresImage;
  const imageGenerationCount = Math.min(Math.max(Math.round(Number(activeImageWorkspace.count) || 1), 1), 4);
  const imageEstimatedQuotaUnits = estimateImageGenerationTotalQuota({
    quality: activeImageWorkspace.quality,
    count: imageGenerationCount,
  });
  const activeImageBillingOperation: ImageBillingOperation = activeImageWorkspaceScope === "image-editor"
    ? "cloud_image_edit"
    : "cloud_image_generation";
  const imageGenerationCostLabel = membershipEntitlementLabel(
    membershipEntitlements,
    activeImageWorkspaceScope === "image-editor" ? "image_edit" : "image_generation",
    "张",
    formatQuotaSymbolLabel(imageEstimatedQuotaUnits),
  );
  const imageWorkspaceCanSubmit = Boolean(selectedImageProvider)
    && !providersLoading
    && !activeImageWorkspace.loading
    && Boolean(imageWorkspacePrompt)
    && (!imageWorkspaceRequiresFile || imageWorkspaceHasFiles);
  const scopedImageLoading = activeImageWorkspace.loading && imageRequestScope === activeImageWorkspaceScope;
  const scopedImageSubmitError = imageRequestScope === activeImageWorkspaceScope ? activeImageWorkspace.submitError : "";
  const scopedImageSubmitDiagnostic = imageRequestScope === activeImageWorkspaceScope ? activeImageWorkspace.submitDiagnostic : null;
  const scopedImageOutputs = imageResultScope === activeImageWorkspaceScope ? imageOutputs : [];
  const scopedActiveImageOutput = imageResultScope === activeImageWorkspaceScope ? activeOutput : null;

  const updateImageWorkspace = useCallback((patch: Partial<ImageWorkspaceState>) => {
    activeImageWorkspaceSetter((prev) => ({
      ...prev,
      ...patch,
      ...("submitError" in patch && !("submitDiagnostic" in patch) ? { submitDiagnostic: null } : {}),
    }));
  }, [activeImageWorkspaceSetter]);

  const updateImageInFlightState = useCallback((nextCount: number, scope: ImageWorkspaceScope = activeImageWorkspaceScope) => {
    const countRef = scope === "image-editor" ? imageEditorInFlightCountRef : imageInFlightCountRef;
    const setWorkspace = scope === "image-editor" ? setImageEditorWorkspace : setImageWorkspace;
    countRef.current = Math.max(0, nextCount);
    setWorkspace((prev) => ({
      ...prev,
      inFlightCount: countRef.current,
      loading: countRef.current > 0,
    }));
  }, [activeImageWorkspaceScope]);

  const updateVideoInFlightState = useCallback((nextCount: number) => {
    videoInFlightCountRef.current = Math.max(0, nextCount);
    setVideoWorkspace((prev) => ({
      ...prev,
      inFlightCount: videoInFlightCountRef.current,
    }));
  }, []);

  const updateImageGenerationProgress = useCallback((
    progressId: string,
    updater: (current: ImageGenerationProgressState[number]) => ImageGenerationProgressState[number],
  ) => {
    setImageGenerationProgress((prev) => prev.map((progress) => (
      progress.id === progressId ? updater(progress) : progress
    )));
  }, []);

  const closeImageGenerationProgress = useCallback((progressId: string) => {
    setImageGenerationProgress((prev) => prev.filter((progress) => progress.id !== progressId));
  }, []);

  const applyImagePromptTemplate = useCallback((templateId: string) => {
    applyTemplatePreset(templateId);
  }, [applyTemplatePreset]);

  const optimizeImagePrompt = useCallback(async () => {
    const prompt = activeImageWorkspace.prompt.trim();
    if (!prompt) {
      const text = "请先填写提示词。";
      updateImageWorkspace({
        promptOptimizeError: text,
        promptOptimizeUndo: "",
      });
      setMessage(text);
      return;
    }
    if (activeImageWorkspace.promptOptimizing) return;

    const originalPrompt = activeImageWorkspace.prompt;
    updateImageWorkspace({
      promptOptimizing: true,
      promptOptimizeError: "",
      promptOptimizeUndo: "",
    });
    try {
      const taskId = createTaskId("prompt-image");
      const data = await fetchJsonWithCsrf<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        body: JSON.stringify({
          taskId,
          idempotencyKey: taskId,
          tool: activeWorkspaceToolId === "image-editor" ? "image-editor" : "image-generator",
          templateId: activeImageWorkspace.templateId,
          prompt: originalPrompt,
          hasImage: imageWorkspaceHasFiles,
          aspectRatio: activeImageWorkspace.ratio,
          quality: activeImageWorkspace.quality,
          targetPlatform: promptOptimizationTargetPlatform,
        }),
      });
      const optimizedPrompt = String(data.optimizedPrompt || data.prompt || "").trim();
      if (!optimizedPrompt) throw new Error("优化失败，请稍后重试");
      updateImageWorkspace({
        prompt: optimizedPrompt,
        promptOptimizing: false,
        promptOptimizeUndo: originalPrompt,
        promptOptimizeError: "",
        submitError: "",
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "优化失败，请稍后重试";
      updateImageWorkspace({
        promptOptimizing: false,
        promptOptimizeUndo: "",
        promptOptimizeError: text,
      });
      setMessage(text);
    }
  }, [
    activeWorkspaceToolId,
    activeImageWorkspace.prompt,
    activeImageWorkspace.promptOptimizing,
    activeImageWorkspace.quality,
    activeImageWorkspace.ratio,
    activeImageWorkspace.templateId,
    imageWorkspaceHasFiles,
    updateImageWorkspace,
  ]);

  const undoImagePromptOptimization = useCallback(() => {
    activeImageWorkspaceSetter((prev) => {
      if (!prev.promptOptimizeUndo) return prev;
      return {
        ...prev,
        prompt: prev.promptOptimizeUndo,
        promptOptimizeUndo: "",
        promptOptimizeError: "",
        submitError: "",
        submitDiagnostic: null,
      };
    });
  }, [activeImageWorkspaceSetter]);

  const replaceImageWorkspaceFiles = useCallback((files: File[]) => {
    let nextFiles: ImageWorkspaceFile[];
    try {
      nextFiles = createImageWorkspaceFiles(files);
    } catch (error) {
      activeImageWorkspaceSetter((prev) => ({
        ...prev,
        fileError: error instanceof Error ? error.message : "图像读取失败。",
        submitError: "",
        submitDiagnostic: null,
      }));
      return;
    }
    activeImageWorkspaceSetter((prev) => ({
      ...prev,
      files: nextFiles,
      fileError: "",
      submitError: "",
      submitDiagnostic: null,
    }));
    activeImageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    activeImageWorkspaceFilesRef.current = nextFiles;
  }, [activeImageWorkspaceFilesRef, activeImageWorkspaceSetter]);

  const removeImageWorkspaceFile = useCallback((index: number) => {
    activeImageWorkspaceSetter((prev) => {
      const removed = prev.files[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const nextFiles = prev.files.filter((_, currentIndex) => currentIndex !== index);
      activeImageWorkspaceFilesRef.current = nextFiles;
      return {
        ...prev,
        files: nextFiles,
        fileError: "",
        submitError: "",
        submitDiagnostic: null,
      };
    });
  }, [activeImageWorkspaceFilesRef, activeImageWorkspaceSetter]);

  const clearImageWorkspaceFiles = useCallback(() => {
    activeImageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    activeImageWorkspaceFilesRef.current = [];
    activeImageWorkspaceSetter((prev) => ({
      ...prev,
      files: [],
      fileError: "",
      submitError: "",
      submitDiagnostic: null,
    }));
  }, [activeImageWorkspaceFilesRef, activeImageWorkspaceSetter]);

  const submitImageWorkspace = useCallback(async () => {
    if (activeImageInFlightCountRef.current > 0) return;
    if (!selectedImageProvider) {
      activeImageWorkspaceSetter((prev) => ({
        ...prev,
        submitError: "当前尚未配置可用模型。",
        submitDiagnostic: null,
      }));
      setMessage("当前尚未配置可用模型。");
      return;
    }
    if (!imageWorkspacePrompt) {
      activeImageWorkspaceSetter((prev) => ({
        ...prev,
        submitError: "请输入提示词。",
        submitDiagnostic: null,
      }));
      return;
    }
    if (imageWorkspaceRequiresFile && !imageWorkspaceHasFiles) {
      activeImageWorkspaceSetter((prev) => ({
        ...prev,
        fileError: "请先上传图像。",
      }));
      return;
    }

    const totalCount = imageGenerationCount;
    const estimatedQuotaUnits = estimateImageGenerationTotalQuota({
      quality: activeImageWorkspace.quality,
      count: totalCount,
    });
    const progressId = createTaskId("image-progress");
    const batchId = createTaskId("image-batch");
    const snapshot = {
      scope: activeImageWorkspaceScope,
      providerId: selectedImageProvider.id,
      mode: activeImageMode,
      operation: activeImageBillingOperation,
      ratio: activeImageWorkspace.ratio,
      quality: activeImageWorkspace.quality,
      prompt: activeImageWorkspace.prompt,
      files: activeImageWorkspace.files.map((attachment) => attachment.file),
      estimatedQuotaUnits,
      totalCount,
      batchId,
    };

    updateImageInFlightState(activeImageInFlightCountRef.current + 1, snapshot.scope);
    setImageRequestScope(snapshot.scope);
    setImageResultScope(null);
    setImageOutputs([]);
    setOutputs((prev) => ({ ...prev, image: null }));
    activeImageWorkspaceSetter((prev) => ({
      ...prev,
      submitError: "",
      submitDiagnostic: null,
      fileError: "",
    }));
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    const startedAt = Date.now();
    setGenerationProgressTick(startedAt);
    setImageGenerationProgress((prev) => [...prev, {
      id: progressId,
      status: "running",
      current: 0,
      total: totalCount,
      startedAt,
      message: totalCount > 1 ? `正在同时生成 ${totalCount} 张图片` : "正在生成图片",
    }]);
    try {
      const taskId = createTaskId("image");
      const requestFingerprint = generationBillingFingerprint({
        kind: "image",
        operation: snapshot.operation,
        providerId: snapshot.providerId,
        mode: snapshot.mode,
        ratio: snapshot.ratio,
        quality: snapshot.quality,
        referenceImages: snapshot.files.length,
        taskId,
        estimatedQuotaUnits: snapshot.estimatedQuotaUnits,
      });

      await fetchJsonWithCsrf("/api/quota/precheck", {
        method: "POST",
        body: JSON.stringify({
          operation: snapshot.operation,
          taskId,
          idempotencyKey: taskId,
          estimatedQuotaUnits: snapshot.estimatedQuotaUnits,
          requestFingerprint,
        }),
      });
      await refreshAccountAfterPrecheck();

      const form = new FormData();
      form.set("providerId", snapshot.providerId);
      form.set("mode", snapshot.mode);
      form.set("ratio", snapshot.ratio);
      form.set("quality", snapshot.quality);
      form.set("prompt", snapshot.prompt);
      form.set("taskId", taskId);
      form.set("idempotencyKey", taskId);
      form.set("batchId", snapshot.batchId);
      form.set("batchTotal", String(snapshot.totalCount));
      form.set("count", String(snapshot.totalCount));
      form.set("estimatedQuotaUnits", String(snapshot.estimatedQuotaUnits));
      form.set("operation", snapshot.operation);
      snapshot.files.forEach((file) => form.append("files", file));
      const data = await fetchJsonWithCsrf<{ item: LibraryItem | null; items?: LibraryItem[] }>("/api/generate/image", {
        method: "POST",
        body: form,
      });
      const items = Array.isArray(data.items) && data.items.length
        ? data.items
        : data.item
          ? [data.item]
          : [];
      if (!items.length) {
        throw new Error("图片生成未返回结果。");
      }
      items.forEach((item) => handleImageResult(item, { append: true, scope: snapshot.scope }));

      await refreshLibraryAfterMutation();
      await refreshAccountAfterGeneration();
      updateImageGenerationProgress(progressId, (current) => ({
        ...current,
        status: "done",
        current: items.length,
        completedAt: Date.now(),
        message: items.length > 1 ? `${items.length} 张图片已生成` : "图片已生成",
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片生成失败。";
      activeImageWorkspaceSetter((prev) => ({
        ...prev,
        submitError: text,
        submitDiagnostic: diagnosticFromError(error),
      }));
      updateImageGenerationProgress(progressId, (current) => ({
        ...current,
        status: "failed",
        completedAt: Date.now(),
        message: text,
      }));
      setMessage(text);
    } finally {
      updateImageInFlightState(activeImageInFlightCountRef.current - 1, activeImageWorkspaceScope);
    }
  }, [
    activeImageBillingOperation,
    activeImageInFlightCountRef,
    activeImageWorkspace.files,
    activeImageWorkspace.prompt,
    activeImageWorkspace.quality,
    activeImageWorkspace.ratio,
    activeImageWorkspaceSetter,
    activeImageWorkspaceScope,
    activeImageMode,
    handleImageResult,
    imageGenerationCount,
    imageWorkspacePrompt,
    imageWorkspaceHasFiles,
    imageWorkspaceRequiresFile,
    refreshAccountAfterPrecheck,
    refreshAccountAfterGeneration,
    refreshLibraryAfterMutation,
    selectedImageProvider,
    setMessage,
    updateImageGenerationProgress,
    updateImageInFlightState,
  ]);

  const handleVideoResult = useCallback((item: LibraryItem, job?: JobRecord | null) => {
    setOutputs((prev) => ({ ...prev, video: { item, job, title: "视频结果", tool: "video" } }));
  }, []);

  const selectedVideoProvider = useMemo<WorkspacePublicProvider | null>(() => {
    if (!providers.video.length) return null;
    return (providers.video.find((provider) => provider.id === videoWorkspace.providerId) || providers.video[0]) as WorkspacePublicProvider;
  }, [providers.video, videoWorkspace.providerId]);
  const selectedVideoDurationOptions = useMemo(() => videoDurationOptions(selectedVideoProvider), [selectedVideoProvider]);
  const selectedVideoRatioOptions = useMemo(() => videoRatioOptions(selectedVideoProvider), [selectedVideoProvider]);

  const videoWorkspaceFiles = videoWorkspace.files;
  const videoWorkspaceHasFiles = videoWorkspaceFiles.length > 0;
  const videoWorkspacePrompt = videoWorkspace.prompt.trim();
  const videoWorkspaceNeedsFile = activeVideoMode === "image-to-video";
  const videoWorkspaceRequiresFile = activeVideoTemplate?.scope === "video" && activeVideoTemplate.requiresImage;
  const selectedVideoModelRequiresFile = videoProviderRequiresReferenceImage(selectedVideoProvider);
  const videoEstimatedQuotaUnits = estimateVideoGenerationQuota({
    mode: activeVideoMode,
    durationSeconds: videoWorkspace.duration,
    referenceImages: videoWorkspace.files.length,
    model: selectedVideoProvider?.model,
  });
  const videoGenerationCostLabel = membershipEntitlementLabel(
    membershipEntitlements,
    "video_generation",
    "次",
    formatQuotaSymbolLabel(videoEstimatedQuotaUnits),
  );
  const videoWorkspaceCanSubmit = Boolean(selectedVideoProvider)
    && !providersLoading
    && videoWorkspace.inFlightCount < CLIENT_VIDEO_SUBMISSION_LIMIT
    && Boolean(videoWorkspacePrompt)
    && (!videoWorkspaceNeedsFile || videoWorkspaceHasFiles)
    && (!videoWorkspaceRequiresFile || videoWorkspaceHasFiles)
    && (!selectedVideoModelRequiresFile || videoWorkspaceHasFiles);

  const updateVideoWorkspace = useCallback((patch: Partial<VideoWorkspaceState>) => {
    setVideoWorkspace((prev) => ({
      ...prev,
      ...patch,
      ...("submitError" in patch && !("submitDiagnostic" in patch) ? { submitDiagnostic: null } : {}),
    }));
  }, []);

  const applyVideoPromptTemplate = useCallback((templateId: string) => {
    applyTemplatePreset(templateId);
  }, [applyTemplatePreset]);

  useEffect(() => {
    if (!selectedVideoProvider) return;
    setVideoWorkspace((prev) => {
      const durationOptions = videoDurationOptions(selectedVideoProvider);
      const ratioOptions = videoRatioOptions(selectedVideoProvider);
      const nextDuration = durationOptions.includes(prev.duration) ? prev.duration : durationOptions[0];
      const nextRatio = ratioOptions.includes(prev.ratio) ? prev.ratio : ratioOptions[0];
      const modelNeedsFile = videoProviderRequiresReferenceImage(selectedVideoProvider);
      const nextFileError = modelNeedsFile && !prev.files.length
        ? videoModelReferenceMessage
        : prev.fileError === videoModelReferenceMessage ? "" : prev.fileError;
      if (nextDuration === prev.duration && nextRatio === prev.ratio && nextFileError === prev.fileError) return prev;
      return {
        ...prev,
        duration: nextDuration,
        ratio: nextRatio,
        fileError: nextFileError,
        submitError: "",
      };
    });
  }, [selectedVideoProvider]);

  const optimizeVideoPrompt = useCallback(async () => {
    const prompt = videoWorkspace.prompt.trim();
    if (!prompt) {
      const text = "请先填写提示词。";
      updateVideoWorkspace({
        promptOptimizeError: text,
        promptOptimizeUndo: "",
      });
      setMessage(text);
      return;
    }
    if (videoWorkspace.promptOptimizing) return;

    const originalPrompt = videoWorkspace.prompt;
    updateVideoWorkspace({
      promptOptimizing: true,
      promptOptimizeError: "",
      promptOptimizeUndo: "",
    });
    try {
      const taskId = createTaskId("prompt-video");
      const data = await fetchJsonWithCsrf<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        body: JSON.stringify({
          taskId,
          idempotencyKey: taskId,
          tool: "video-generator",
          templateId: videoWorkspace.templateId,
          prompt: originalPrompt,
          hasImage: videoWorkspaceHasFiles,
          aspectRatio: videoWorkspace.ratio,
          duration: videoWorkspace.duration,
          targetPlatform: promptOptimizationTargetPlatform,
        }),
      });
      const optimizedPrompt = String(data.optimizedPrompt || data.prompt || "").trim();
      if (!optimizedPrompt) throw new Error("优化失败，请稍后重试");
      updateVideoWorkspace({
        prompt: optimizedPrompt,
        promptOptimizing: false,
        promptOptimizeUndo: originalPrompt,
        promptOptimizeError: "",
        submitError: "",
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "优化失败，请稍后重试";
      updateVideoWorkspace({
        promptOptimizing: false,
        promptOptimizeUndo: "",
        promptOptimizeError: text,
      });
      setMessage(text);
    }
  }, [
    updateVideoWorkspace,
    videoWorkspace.duration,
    videoWorkspace.prompt,
    videoWorkspace.promptOptimizing,
    videoWorkspace.ratio,
    videoWorkspace.templateId,
    videoWorkspaceHasFiles,
  ]);

  const undoVideoPromptOptimization = useCallback(() => {
    setVideoWorkspace((prev) => {
      if (!prev.promptOptimizeUndo) return prev;
      return {
        ...prev,
        prompt: prev.promptOptimizeUndo,
        promptOptimizeUndo: "",
        promptOptimizeError: "",
        submitError: "",
        submitDiagnostic: null,
      };
    });
  }, []);

  const replaceVideoWorkspaceFiles = useCallback((files: File[]) => {
    let nextFiles: VideoWorkspaceFile[];
    try {
      nextFiles = createVideoWorkspaceFiles(files);
    } catch (error) {
      setVideoWorkspace((prev) => ({
        ...prev,
        fileError: error instanceof Error ? error.message : "图像读取失败。",
        submitError: "",
        submitDiagnostic: null,
      }));
      return;
    }
    setVideoWorkspace((prev) => ({
      ...prev,
      files: nextFiles,
      fileError: "",
      submitError: "",
      submitDiagnostic: null,
    }));
    videoWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    videoWorkspaceFilesRef.current = nextFiles;
  }, []);

  const removeVideoWorkspaceFile = useCallback((index: number) => {
    setVideoWorkspace((prev) => {
      const removed = prev.files[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const nextFiles = prev.files.filter((_, currentIndex) => currentIndex !== index);
      videoWorkspaceFilesRef.current = nextFiles;
      return {
        ...prev,
        files: nextFiles,
        fileError: selectedVideoModelRequiresFile && !nextFiles.length ? videoModelReferenceMessage : "",
        submitError: "",
        submitDiagnostic: null,
      };
    });
  }, [selectedVideoModelRequiresFile]);

  const clearVideoWorkspaceFiles = useCallback(() => {
    videoWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    videoWorkspaceFilesRef.current = [];
    setVideoWorkspace((prev) => ({
      ...prev,
      files: [],
      fileError: selectedVideoModelRequiresFile ? videoModelReferenceMessage : "",
      submitError: "",
      submitDiagnostic: null,
    }));
  }, [selectedVideoModelRequiresFile]);

  const updateImageUpscaleWorkspace = useCallback((patch: Partial<ImageUpscaleWorkspaceState>) => {
    setImageUpscaleWorkspace((prev) => ({
      ...prev,
      ...patch,
      ...("submitError" in patch && !("submitDiagnostic" in patch) ? { submitDiagnostic: null } : {}),
    }));
  }, []);

  const checkImageUpscaleAvailability = useCallback(async () => {
    updateImageUpscaleWorkspace({ statusLoading: true, statusError: "", checked: true });
    try {
      const data = await jsonFetch<UpscaleStatusResponse>("/api/upscale/status");
      if (data.uploadLimits) setUploadLimits((prev) => ({ ...prev, ...data.uploadLimits }));
      updateImageUpscaleWorkspace({ availability: data.image, statusLoading: false });
    } catch (error) {
      updateImageUpscaleWorkspace({
        availability: null,
        statusLoading: false,
        statusError: error instanceof Error ? error.message : upscaleUnavailableMessage,
      });
    }
  }, [updateImageUpscaleWorkspace]);

  useEffect(() => {
    if (activeBusinessTool !== "image-upscale") return;
    if (imageUpscaleWorkspace.checked && (imageUpscaleWorkspace.availability || imageUpscaleWorkspace.statusError)) return;
    void checkImageUpscaleAvailability();
  }, [
    activeBusinessTool,
    checkImageUpscaleAvailability,
    imageUpscaleWorkspace.availability,
    imageUpscaleWorkspace.checked,
    imageUpscaleWorkspace.statusError,
  ]);

  const replaceImageUpscaleFile = useCallback((files: File[]) => {
    const previous = imageUpscaleFileRef.current;
    try {
      const nextFile = createImageUpscaleFile(files, uploadLimits.imageUpscale);
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      imageUpscaleFileRef.current = nextFile;
      updateImageUpscaleWorkspace({
        file: nextFile,
        fileError: "",
        submitError: "",
      });
      setOutputs((prev) => ({ ...prev, "image-upscale": null }));
    } catch (error) {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      imageUpscaleFileRef.current = null;
      updateImageUpscaleWorkspace({
        file: null,
        fileError: error instanceof Error ? error.message : "图像读取失败。",
        submitError: "",
      });
      setOutputs((prev) => ({ ...prev, "image-upscale": null }));
    }
  }, [updateImageUpscaleWorkspace, uploadLimits.imageUpscale]);

  const removeImageUpscaleFile = useCallback(() => {
    if (imageUpscaleFileRef.current) {
      URL.revokeObjectURL(imageUpscaleFileRef.current.previewUrl);
    }
    imageUpscaleFileRef.current = null;
    updateImageUpscaleWorkspace({
      file: null,
      fileError: "",
      submitError: "",
    });
    setOutputs((prev) => ({ ...prev, "image-upscale": null }));
  }, [updateImageUpscaleWorkspace]);

  const submitImageUpscale = useCallback(async () => {
    const currentFile = imageUpscaleWorkspace.file;
    if (!currentFile) {
      updateImageUpscaleWorkspace({ fileError: "请先上传一张图像。", submitError: "请先上传一张图像。" });
      return;
    }
    if (!imageUpscaleWorkspace.availability?.ready) {
      updateImageUpscaleWorkspace({
        submitError: upscaleUnavailableMessage,
      });
      return;
    }
    if (imageUpscaleWorkspace.loading || imageUpscaleInFlightRef.current) return;
    imageUpscaleInFlightRef.current = true;

    updateImageUpscaleWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const taskId = createTaskId("image-upscale");
      const estimatedQuotaUnits = estimateUpscaleQuota({
        kind: "image",
        scale: imageUpscaleWorkspace.scale,
      });
      const requestFingerprint = upscaleBillingFingerprint({
        kind: "image",
        scale: imageUpscaleWorkspace.scale,
        taskId,
        estimatedQuotaUnits,
      });
      await fetchJsonWithCsrf("/api/quota/precheck", {
        method: "POST",
        body: JSON.stringify({
          operation: "cloud_image_upscale",
          taskId,
          idempotencyKey: taskId,
          estimatedQuotaUnits,
          requestFingerprint,
        }),
      });
      await refreshAccountAfterPrecheck();
      const form = new FormData();
      form.set("file", currentFile.file);
      form.set("scale", imageUpscaleWorkspace.scale);
      form.set("taskId", taskId);
      form.set("idempotencyKey", taskId);
      form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/image", {
        method: "POST",
        body: form,
      });
      setOutputs((prev) => ({ ...prev, "image-upscale": { item: data.item, job: data.job, title: "图片高清增强结果", tool: "image-upscale" } }));
      await refreshLibraryAfterMutation();
      await refreshAccountAfterGeneration();
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片高清增强处理失败。";
      updateImageUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
    } finally {
      imageUpscaleInFlightRef.current = false;
      updateImageUpscaleWorkspace({ loading: false });
    }
  }, [imageUpscaleWorkspace.availability?.ready, imageUpscaleWorkspace.file, imageUpscaleWorkspace.loading, imageUpscaleWorkspace.scale, refreshAccountAfterGeneration, refreshAccountAfterPrecheck, refreshLibraryAfterMutation, setMessage, updateImageUpscaleWorkspace]);

  const imageUpscaleCanSubmit = Boolean(imageUpscaleWorkspace.file)
    && Boolean(imageUpscaleWorkspace.availability?.ready)
    && !imageUpscaleWorkspace.loading
    && !imageUpscaleWorkspace.statusLoading;
  const imageUpscaleCostLabel = formatQuotaSymbolLabel(estimateUpscaleQuota({
    kind: "image",
    scale: imageUpscaleWorkspace.scale,
  }));

  const updateVideoUpscaleWorkspace = useCallback((patch: Partial<VideoUpscaleWorkspaceState>) => {
    setVideoUpscaleWorkspace((prev) => ({
      ...prev,
      ...patch,
      ...("submitError" in patch && !("submitDiagnostic" in patch) ? { submitDiagnostic: null } : {}),
    }));
  }, []);

  const checkVideoUpscaleAvailability = useCallback(async () => {
    updateVideoUpscaleWorkspace({ statusLoading: true, statusError: "", checked: true });
    try {
      const data = await jsonFetch<UpscaleStatusResponse>("/api/upscale/status");
      if (data.uploadLimits) setUploadLimits((prev) => ({ ...prev, ...data.uploadLimits }));
      updateVideoUpscaleWorkspace({ availability: data.video, statusLoading: false });
    } catch (error) {
      updateVideoUpscaleWorkspace({
        availability: null,
        statusLoading: false,
        statusError: error instanceof Error ? error.message : upscaleUnavailableMessage,
      });
    }
  }, [updateVideoUpscaleWorkspace]);

  useEffect(() => {
    if (activeBusinessTool !== "video-upscale") return;
    if (videoUpscaleWorkspace.checked && (videoUpscaleWorkspace.availability || videoUpscaleWorkspace.statusError)) return;
    void checkVideoUpscaleAvailability();
  }, [
    activeBusinessTool,
    checkVideoUpscaleAvailability,
    videoUpscaleWorkspace.availability,
    videoUpscaleWorkspace.checked,
    videoUpscaleWorkspace.statusError,
  ]);

  useEffect(() => {
    if (!previewMode && !sessionLoading && !sessionUser && !sessionError) {
      router.replace("/login");
    }
  }, [previewMode, router, sessionError, sessionLoading, sessionUser]);

  const replaceVideoUpscaleFile = useCallback((files: File[]) => {
    const previous = videoUpscaleFileRef.current;
    try {
      const nextFile = createVideoUpscaleFile(files, uploadLimits.videoUpscale);
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      videoUpscaleFileRef.current = nextFile;
      updateVideoUpscaleWorkspace({
        file: nextFile,
        fileError: "",
        submitError: "",
      });
      setOutputs((prev) => ({ ...prev, "video-upscale": null }));
    } catch (error) {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      videoUpscaleFileRef.current = null;
      updateVideoUpscaleWorkspace({
        file: null,
        fileError: error instanceof Error ? error.message : "视频读取失败。",
        submitError: "",
      });
      setOutputs((prev) => ({ ...prev, "video-upscale": null }));
    }
  }, [updateVideoUpscaleWorkspace, uploadLimits.videoUpscale]);

  const removeVideoUpscaleFile = useCallback(() => {
    if (videoUpscaleFileRef.current) {
      URL.revokeObjectURL(videoUpscaleFileRef.current.previewUrl);
    }
    videoUpscaleFileRef.current = null;
    updateVideoUpscaleWorkspace({
      file: null,
      fileError: "",
      submitError: "",
      job: null,
    });
    setOutputs((prev) => ({ ...prev, "video-upscale": null }));
  }, [updateVideoUpscaleWorkspace]);

  const submitVideoUpscale = useCallback(async () => {
    const currentFile = videoUpscaleWorkspace.file;
    const pendingJob = videoUpscaleWorkspace.job
      && videoUpscaleWorkspace.job.status !== "done"
      && videoUpscaleWorkspace.job.status !== "failed";
    if (!currentFile) {
      updateVideoUpscaleWorkspace({ fileError: "请先上传一个视频。", submitError: "请先上传一个视频。" });
      return;
    }
    if (!videoUpscaleWorkspace.availability?.ready) {
      updateVideoUpscaleWorkspace({
        submitError: upscaleUnavailableMessage,
      });
      return;
    }
    if (videoUpscaleWorkspace.loading || pendingJob || videoUpscaleInFlightRef.current) return;
    videoUpscaleInFlightRef.current = true;

    updateVideoUpscaleWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
      job: null,
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const taskId = createTaskId("video-upscale");
      const estimatedQuotaUnits = estimateUpscaleQuota({
        kind: "video",
        scale: videoUpscaleWorkspace.scale,
      });
      const requestFingerprint = upscaleBillingFingerprint({
        kind: "video",
        scale: videoUpscaleWorkspace.scale,
        taskId,
        estimatedQuotaUnits,
      });
      await fetchJsonWithCsrf("/api/quota/precheck", {
        method: "POST",
        body: JSON.stringify({
          operation: "cloud_video_upscale",
          taskId,
          idempotencyKey: taskId,
          estimatedQuotaUnits,
          requestFingerprint,
        }),
      });
      await refreshAccountAfterPrecheck();
      const form = new FormData();
      form.set("file", currentFile.file);
      form.set("scale", videoUpscaleWorkspace.scale);
      form.set("taskId", taskId);
      form.set("idempotencyKey", taskId);
      form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/video", {
        method: "POST",
        body: form,
      });
      updateVideoUpscaleWorkspace({ job: data.job });
      setOutputs((prev) => ({ ...prev, "video-upscale": { item: data.item, job: data.job, title: "视频高清增强结果", tool: "video-upscale" } }));
      await refreshLibraryAfterMutation();
      await refreshAccountAfterGeneration();
    } catch (error) {
      const text = error instanceof Error ? error.message : "视频高清增强处理失败。";
      updateVideoUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
    } finally {
      videoUpscaleInFlightRef.current = false;
      updateVideoUpscaleWorkspace({ loading: false });
    }
  }, [
    refreshAccountAfterGeneration,
    refreshAccountAfterPrecheck,
    refreshLibraryAfterMutation,
    setMessage,
    updateVideoUpscaleWorkspace,
    videoUpscaleWorkspace.availability?.ready,
    videoUpscaleWorkspace.file,
    videoUpscaleWorkspace.job,
    videoUpscaleWorkspace.loading,
    videoUpscaleWorkspace.scale,
  ]);

  const videoUpscaleProcessing = Boolean(videoUpscaleWorkspace.job)
    && videoUpscaleWorkspace.job?.status !== "done"
    && videoUpscaleWorkspace.job?.status !== "failed";
  const videoUpscaleCanSubmit = Boolean(videoUpscaleWorkspace.file)
    && Boolean(videoUpscaleWorkspace.availability?.ready)
    && !videoUpscaleWorkspace.loading
    && !videoUpscaleWorkspace.statusLoading
    && !videoUpscaleProcessing;
  const videoUpscaleCostLabel = formatQuotaSymbolLabel(estimateUpscaleQuota({
    kind: "video",
    scale: videoUpscaleWorkspace.scale,
  }));

  const sendResultToUpscale = useCallback(async (item: LibraryItem) => {
    if (!item.output?.url) {
      setMessage("结果文件暂不可用。");
      return;
    }

    setMessage("正在准备高清素材。");
    try {
      if (item.type === "image") {
        const file = await fileFromLibraryOutput(item, ".png", uploadLimits.imageUpscale);
        replaceImageUpscaleFile([file]);
        setActiveWorkspaceToolId("image-upscale");
        setMessage("已带入图片高清增强，请选择倍数后开始增强。");
        return;
      }

      const file = await fileFromLibraryOutput(item, ".mp4", uploadLimits.videoUpscale);
      replaceVideoUpscaleFile([file]);
      setActiveWorkspaceToolId("video-upscale");
      setMessage("已带入视频高清增强，请选择倍数后开始增强。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "高清素材准备失败。");
    }
  }, [replaceImageUpscaleFile, replaceVideoUpscaleFile, setMessage, uploadLimits.imageUpscale, uploadLimits.videoUpscale]);

  const sendImageResultToVideo = useCallback(async (item: LibraryItem) => {
    if (item.type !== "image") return;
    try {
      setMessage("正在准备图生视频素材。");
      const file = await fileFromLibraryOutput(item, ".png", defaultUploadLimits.referenceImage);
      replaceVideoWorkspaceFiles([file]);
      setVideoWorkspace((prev) => ({
        ...prev,
        prompt: item.prompt || prev.prompt,
        ratio: typeof item.params.ratio === "string" ? item.params.ratio : prev.ratio,
        submitError: "",
        submitDiagnostic: null,
      }));
      setOutputs((prev) => ({ ...prev, video: null }));
      setActiveWorkspaceToolId("video");
      setMessage("已带入图生视频，请补充运动和镜头描述后生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图生视频素材准备失败。");
    }
  }, [replaceVideoWorkspaceFiles]);

  const sendImageResultToEditor = useCallback(async (item: LibraryItem) => {
    if (item.type !== "image") return;
    try {
      setMessage("正在准备图片编辑素材。");
      const file = await fileFromLibraryOutput(item, ".png", defaultUploadLimits.referenceImage);
      const nextFiles = createImageWorkspaceFiles([file]);
      imageEditorWorkspaceFilesRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
      imageEditorWorkspaceFilesRef.current = nextFiles;
      setImageEditorWorkspace((prev) => ({
        ...prev,
        prompt: item.prompt || prev.prompt,
        ratio: typeof item.params.ratio === "string" ? item.params.ratio : prev.ratio,
        quality: typeof item.params.quality === "string" ? item.params.quality : prev.quality,
        count: 1,
        files: nextFiles,
        fileError: "",
        submitError: "",
        submitDiagnostic: null,
      }));
      setImageOutputs([]);
      setOutputs((prev) => ({ ...prev, image: null }));
      setActiveWorkspaceToolId("image-editor");
      setMessage("已带入图片编辑，请写清楚要修改的内容。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片编辑素材准备失败。");
    }
  }, []);

  const reuseLibraryItemParameters = useCallback((item: LibraryItem) => {
    setMessage("已复用上次的文案和参数。");
    if (item.type === "video") {
      setVideoWorkspace((prev) => ({
        ...prev,
        providerId: item.providerId || prev.providerId,
        prompt: item.prompt || prev.prompt,
        ratio: typeof item.params.ratio === "string" ? item.params.ratio : prev.ratio,
        duration: typeof item.params.duration === "number"
          ? item.params.duration
          : typeof item.params.durationSeconds === "number"
            ? item.params.durationSeconds
            : prev.duration,
        templateId: "",
        submitError: "",
        submitDiagnostic: null,
      }));
      setActiveWorkspaceToolId("video");
      return;
    }

    const setWorkspace = item.mode === "image-to-image" ? setImageEditorWorkspace : setImageWorkspace;
    setWorkspace((prev) => ({
      ...prev,
      providerId: item.providerId || prev.providerId,
      prompt: item.prompt || prev.prompt,
      ratio: typeof item.params.ratio === "string" ? item.params.ratio : prev.ratio,
      quality: typeof item.params.quality === "string" ? item.params.quality : prev.quality,
      count: 1,
      templateId: "",
      submitError: "",
      submitDiagnostic: null,
    }));
    setActiveWorkspaceToolId(item.mode === "image-to-image" ? "image-editor" : "image");
  }, []);

  useEffect(() => {
    const job = videoUpscaleWorkspace.job;
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await jsonFetch<{ job: JobRecord | null }>(`/api/jobs/${job.id}`);
        const nextJob = data.job || job;
        updateVideoUpscaleWorkspace({ job: nextJob });
        const libraryData = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
        const updatedItem = libraryData.items.find((item) => item.id === job.libraryItemId);
        if (updatedItem) {
          setOutputs((prev) => ({
            ...prev,
            "video-upscale": { item: updatedItem, job: nextJob, title: "视频高清增强结果", tool: "video-upscale" },
          }));
          if (updatedItem.status === "failed") {
            updateVideoUpscaleWorkspace({ submitError: updatedItem.error || nextJob.error || "视频高清增强处理失败。" });
          }
        }
        if (nextJob.status === "done" || nextJob.status === "failed") {
          await refreshAccountAfterGeneration();
        }
        await refreshLibraryAfterMutation();
      } catch (error) {
        const text = error instanceof Error ? error.message : "视频高清增强任务查询失败。";
        updateVideoUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
        setMessage(text);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshAccountAfterGeneration, refreshLibraryAfterMutation, setMessage, updateVideoUpscaleWorkspace, videoUpscaleWorkspace.job]);

  useEffect(() => {
    const job = videoWorkspace.job;
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await jsonFetch<{ job: JobRecord | null }>(`/api/jobs/${job.id}`);
        const nextJob = data.job || job;
        if (data.job) updateVideoWorkspace({ job: data.job });
        const libraryData = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
        const updatedItem = libraryData.items.find((item) => item.id === job.libraryItemId);
        if (updatedItem) handleVideoResult(updatedItem, nextJob);
        if (nextJob.status === "done" || nextJob.status === "failed") {
          updateVideoInFlightState(0);
        }
        await refreshLibraryAfterMutation();
      } catch (error) {
        const text = error instanceof Error ? error.message : "视频任务查询失败。";
        updateVideoWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
        setMessage(text);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [handleVideoResult, refreshLibraryAfterMutation, setMessage, updateVideoInFlightState, updateVideoWorkspace, videoWorkspace.job]);

  const submitVideoWorkspace = useCallback(async () => {
    if (!selectedVideoProvider) {
      const text = "当前尚未配置可用视频模型。";
      updateVideoWorkspace({ submitError: text });
      setMessage(text);
      return;
    }
    if (!videoWorkspacePrompt) {
      updateVideoWorkspace({ submitError: "请输入提示词。" });
      return;
    }
    if (videoWorkspaceNeedsFile && !videoWorkspaceHasFiles) {
      const text = "请先上传图像。";
      updateVideoWorkspace({ fileError: text, submitError: text });
      return;
    }
    if (selectedVideoModelRequiresFile && !videoWorkspaceHasFiles) {
      const text = videoModelReferenceMessage;
      updateVideoWorkspace({ fileError: text, submitError: text });
      return;
    }
    if (videoInFlightCountRef.current >= CLIENT_VIDEO_SUBMISSION_LIMIT) {
      const text = `当前最多同时进行 ${CLIENT_VIDEO_SUBMISSION_LIMIT} 个视频任务，请稍后再试。`;
      updateVideoWorkspace({ submitError: text });
      setMessage(text);
      return;
    }
    if ((videoWorkspaceRequiresFile || videoWorkspaceNeedsFile || selectedVideoModelRequiresFile) && !videoWorkspaceHasFiles) {
      setVideoWorkspace((prev) => ({
        ...prev,
        fileError: selectedVideoModelRequiresFile ? videoModelReferenceMessage : "请先上传图像。",
      }));
      return;
    }

    const taskId = createTaskId("video");
    const snapshot = {
      providerId: selectedVideoProvider.id,
      mode: activeVideoMode,
      ratio: videoWorkspace.ratio,
      duration: videoWorkspace.duration,
      prompt: videoWorkspace.prompt,
      model: selectedVideoProvider.model,
      files: videoWorkspace.files.map((attachment) => attachment.file),
      estimatedQuotaUnits: estimateVideoGenerationQuota({
        mode: activeVideoMode,
        durationSeconds: videoWorkspace.duration,
        referenceImages: videoWorkspace.files.length,
        model: selectedVideoProvider.model,
      }),
    };
    const requestFingerprint = generationBillingFingerprint({
      kind: "video",
      providerId: snapshot.providerId,
      mode: snapshot.mode,
      ratio: snapshot.ratio,
      durationSeconds: snapshot.duration,
      referenceImages: snapshot.files.length,
      model: snapshot.model,
      taskId,
      estimatedQuotaUnits: snapshot.estimatedQuotaUnits,
    });

    try {
      await fetchJsonWithCsrf("/api/quota/precheck", {
        method: "POST",
        body: JSON.stringify({
          operation: "cloud_video_generation",
          taskId,
          idempotencyKey: taskId,
          estimatedQuotaUnits: snapshot.estimatedQuotaUnits,
          requestFingerprint,
        }),
      });
      await refreshAccountAfterPrecheck();
    } catch (error) {
      const text = error instanceof Error ? error.message : "额度预检失败。";
      updateVideoWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
      return;
    }

    updateVideoInFlightState(videoInFlightCountRef.current + 1);
    updateVideoWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    let keepVideoSlotOccupied = false;
    try {
      const form = new FormData();
      form.set("providerId", snapshot.providerId);
      form.set("mode", snapshot.mode);
      form.set("ratio", snapshot.ratio);
      form.set("duration", String(snapshot.duration));
      form.set("prompt", snapshot.prompt);
      form.set("taskId", taskId);
      form.set("idempotencyKey", taskId);
      form.set("estimatedQuotaUnits", String(snapshot.estimatedQuotaUnits));
      if (snapshot.mode === "image-to-video") {
        snapshot.files.forEach((file) => form.append("files", file));
      }
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", {
        method: "POST",
        body: form,
      });
      keepVideoSlotOccupied = Boolean(data.job && data.job.status !== "done" && data.job.status !== "failed");
      updateVideoWorkspace({ job: data.job });
      handleVideoResult(data.item, data.job);
      await refreshLibraryAfterMutation();
      await refreshAccountAfterGeneration();
      updateVideoInFlightState(keepVideoSlotOccupied ? CLIENT_VIDEO_SUBMISSION_LIMIT : videoInFlightCountRef.current - 1);
    } catch (error) {
      const text = error instanceof Error ? error.message : "视频生成失败。";
      updateVideoWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
      updateVideoInFlightState(videoInFlightCountRef.current - 1);
    } finally {
      updateVideoWorkspace({ loading: false });
    }
  }, [
    activeVideoMode,
    handleVideoResult,
    refreshAccountAfterGeneration,
    refreshAccountAfterPrecheck,
    refreshLibraryAfterMutation,
    selectedVideoProvider,
    selectedVideoModelRequiresFile,
    setMessage,
    updateVideoInFlightState,
    updateVideoWorkspace,
    videoWorkspace.duration,
    videoWorkspace.files,
    videoWorkspace.prompt,
    videoWorkspace.ratio,
    videoWorkspaceHasFiles,
    videoWorkspaceRequiresFile,
    videoWorkspaceNeedsFile,
    videoWorkspacePrompt,
  ]);

  const parameterSlot = (
    <>
      {activeBusinessTool === "image" ? (
        <ImageGenerator
          mode={activeImageMode}
          showTemplates={activeWorkspaceToolId !== "image-editor"}
          providers={providers.image}
              providersLoading={providersLoading}
              providersError={providersError}
              selectedProvider={selectedImageProvider}
          templateCenterHref={imageTemplateCenterHref}
          state={activeImageWorkspace}
          loading={scopedImageLoading}
          canSubmit={imageWorkspaceCanSubmit}
          estimatedQuotaUnits={imageEstimatedQuotaUnits}
          costLabel={imageGenerationCostLabel}
          onProviderChange={(value) => updateImageWorkspace({ providerId: value })}
          onRatioChange={(value) => updateImageWorkspace({ ratio: value })}
          onQualityChange={(value) => updateImageWorkspace({ quality: value })}
          onCountChange={(value) => updateImageWorkspace({ count: value })}
          onTemplateChange={applyImagePromptTemplate}
          onPromptChange={(value) => updateImageWorkspace({ prompt: value, promptOptimizeError: "", submitError: "" })}
          onPromptOptimize={optimizeImagePrompt}
          onPromptOptimizeUndo={undoImagePromptOptimization}
          promptOptimizeCostLabel={membershipEntitlementLabel(membershipEntitlements, "prompt_optimize", "次", promptOptimizationCostLabel)}
          onFilesChange={replaceImageWorkspaceFiles}
          onFileRemove={removeImageWorkspaceFile}
          onFilesClear={clearImageWorkspaceFiles}
          onReloadProviders={refreshProviders}
          onSubmit={submitImageWorkspace}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "video" ? (
        <VideoGenerator
          mode={activeVideoMode}
          providers={providers.video}
              providersLoading={providersLoading}
              providersError={providersError}
              selectedProvider={selectedVideoProvider}
          templateCenterHref={videoTemplateCenterHref}
          state={videoWorkspace}
          canSubmit={videoWorkspaceCanSubmit}
          estimatedQuotaUnits={videoEstimatedQuotaUnits}
          costLabel={videoGenerationCostLabel}
          onProviderChange={(value) => updateVideoWorkspace({ providerId: value, submitError: "" })}
          onRatioChange={(value) => updateVideoWorkspace({ ratio: value })}
          onDurationChange={(value) => updateVideoWorkspace({ duration: value })}
          onTemplateChange={applyVideoPromptTemplate}
          onPromptChange={(value) => updateVideoWorkspace({ prompt: value, promptOptimizeError: "", submitError: "" })}
          onPromptOptimize={optimizeVideoPrompt}
          onPromptOptimizeUndo={undoVideoPromptOptimization}
          promptOptimizeCostLabel={membershipEntitlementLabel(membershipEntitlements, "prompt_optimize", "次", promptOptimizationCostLabel)}
          onFilesChange={replaceVideoWorkspaceFiles}
          onFileRemove={removeVideoWorkspaceFile}
          onFilesClear={clearVideoWorkspaceFiles}
          ratioOptions={selectedVideoRatioOptions}
          durationOptions={selectedVideoDurationOptions}
          modelRequiresImage={selectedVideoModelRequiresFile}
          onReloadProviders={refreshProviders}
          onSubmit={submitVideoWorkspace}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "image-upscale" ? (
        <ImageUpscaleForm
          state={imageUpscaleWorkspace}
          canSubmit={imageUpscaleCanSubmit}
          costLabel={imageUpscaleCostLabel}
          onScaleChange={(value) => updateImageUpscaleWorkspace({ scale: value as "1" | "2" | "4", submitError: "" })}
          onFilesChange={replaceImageUpscaleFile}
          onFileRemove={removeImageUpscaleFile}
          onFilesClear={removeImageUpscaleFile}
          onSubmit={submitImageUpscale}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "video-upscale" ? (
        <VideoUpscaleForm
          state={videoUpscaleWorkspace}
          canSubmit={videoUpscaleCanSubmit}
          costLabel={videoUpscaleCostLabel}
          onScaleChange={(value) => updateVideoUpscaleWorkspace({ scale: value as "1" | "2" | "4", submitError: "" })}
          onFilesChange={replaceVideoUpscaleFile}
          onFileRemove={removeVideoUpscaleFile}
          onFilesClear={removeVideoUpscaleFile}
          onSubmit={submitVideoUpscale}
          registerMobileAction={setMobileAction}
        />
      ) : null}
    </>
  );
  const accountPlanLabel = accountSummaryBusy ? "会员加载中" : getPlanStatusDisplay(accountPlanStatus).label;

  return (
    <>
      <WorkbenchShell
        state={{ activeToolId: activeWorkspaceToolId }}
        onToolAction={handleToolAction}
        isAuthenticated={Boolean(sessionUser)}
        canAccessAdmin={sessionUser?.role === "admin"}
        accountName={sessionUser?.display_name || sessionUser?.username || null}
        accountPointsLabel={accountSummaryBusy ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} ✦` : "—"}
        accountPlanLabel={accountPlanLabel}
        headerRightSlot={accountHeaderSlot}
        accountCloseSignal={accountCloseSignal}
        onOpenAccountCenter={handleOpenAccountCenter}
        onOpenAccountRecharge={handleOpenRechargeCenter}
        accountSlot={(
          <WorkspaceAccountPanel
            user={sessionUser}
            quota={quotaSnapshot}
            membershipEntitlements={membershipEntitlements}
            loading={accountSummaryBusy}
            accountError={accountDataError}
            accountView={accountCenterOpen ? accountView : undefined}
            planStatus={accountPlanStatus}
            membershipEndsAt={membershipSnapshot?.membership.active?.ends_at ?? null}
            checkInStatus={accountCheckInStatus}
            onRefresh={() => void refreshAccountSnapshot()}
            onLogout={() => setLogoutConfirmOpen(true)}
            onOpenCenter={handleOpenAccountCenter}
            onOpenRecharge={handleOpenRechargeCenter}
            onOpenUsage={handleOpenUsageRecords}
            onOpenOrders={handleOpenOrderRecords}
            onCheckInUnavailable={() => void handleCheckIn()}
          />
        )}
        contentMode={accountCenterOpen ? "account" : "default"}
        toolTitle={accountCenterOpen ? accountViewTitle(accountView) : activeWorkspaceTool.label}
        parameterSlot={parameterSlot}
        mobilePreviewSignal={mobilePreviewSignal}
        previewSlot={
          accountCenterOpen ? (
            <UserCenterWorkspace
              user={sessionUser}
              quota={quotaSnapshot}
              membershipSnapshot={membershipSnapshot}
              usage={usagePage}
              loading={accountViewLoading}
              billingOrders={billingOrders}
              accountView={accountView}
              planStatus={accountPlanStatus}
              checkInRecords={checkInRecords}
              onViewChange={setAccountView}
              onRefreshAccount={() => void refreshAccountSnapshot()}
            />
          ) : activeBusinessTool === "library" ? (
            <LibraryPane
              items={currentLibraryItems}
              totalCount={library.length}
              count={libraryCounts}
              selectedItem={selectedLibraryItem}
              loading={libraryPanelLoading}
              error={libraryError}
              isAuthenticated={Boolean(sessionUser)}
              filter={libraryFilter}
              sort={librarySort}
              search={librarySearch}
              deletingItemId={deletingLibraryItemId}
              bulkDeleting={bulkDeletingLibrary}
              removingItemId={removingLibraryItemId}
              missingMediaIds={missingLibraryMediaIds}
              deleteConfirmItem={libraryDeleteConfirmItem}
              onFilterChange={setLibraryFilter}
              onSortChange={setLibrarySort}
              onSearchChange={setLibrarySearch}
              onSelectItem={setSelectedLibraryItemId}
              onDelete={handleRequestDeleteLibraryItem}
              onDeleteMany={handleDeleteManyLibraryItems}
              onRegenerate={reuseLibraryItemParameters}
              onUpscale={sendResultToUpscale}
              onCreateVideo={sendImageResultToVideo}
              onEditImage={sendImageResultToEditor}
              onRefresh={() => refreshLibrary({ force: true })}
              onMediaMissing={markLibraryMediaMissing}
              onLogin={() => router.push("/login")}
              onStartCreate={() => setActiveWorkspaceToolId("image")}
              onCancelDelete={handleCancelDeleteLibraryItem}
              onConfirmDelete={() => void handleConfirmDeleteLibraryItem()}
            />
          ) : (
            activeBusinessTool === "image" ? (
              <ImagePreviewPanel
                mode={activeImageMode}
                output={scopedActiveImageOutput}
                outputs={scopedImageOutputs}
                loading={scopedImageLoading}
                canSubmit={imageWorkspaceCanSubmit}
                submitError={scopedImageSubmitError}
                submitDiagnostic={scopedImageSubmitDiagnostic}
                isEditor={activeWorkspaceToolId === "image-editor"}
                promptFilled={Boolean(imageWorkspacePrompt)}
                hasProvider={Boolean(selectedImageProvider)}
                hasFiles={imageWorkspaceHasFiles}
                onSubmit={submitImageWorkspace}
                onReloadProviders={refreshProviders}
                onUpscale={sendResultToUpscale}
                onCreateVideo={sendImageResultToVideo}
                onEdit={sendImageResultToEditor}
              />
            ) : activeBusinessTool === "video" ? (
              <VideoPreviewPanel
                mode={activeVideoMode}
                output={activeOutput}
                loading={videoWorkspace.loading}
                canSubmit={videoWorkspaceCanSubmit}
                submitError={videoWorkspace.submitError}
                submitDiagnostic={videoWorkspace.submitDiagnostic}
                promptFilled={Boolean(videoWorkspacePrompt)}
                hasProvider={Boolean(selectedVideoProvider)}
                hasFiles={videoWorkspaceHasFiles}
                onSubmit={submitVideoWorkspace}
                onReloadProviders={refreshProviders}
                onUpscale={sendResultToUpscale}
              />
            ) : activeBusinessTool === "image-upscale" ? (
              <ImageUpscalePreviewPanel
                state={imageUpscaleWorkspace}
                output={activeOutput}
                canSubmit={imageUpscaleCanSubmit}
                onSubmit={submitImageUpscale}
              />
            ) : activeBusinessTool === "video-upscale" ? (
              <VideoUpscalePreviewPanel
                state={videoUpscaleWorkspace}
                output={activeOutput}
                canSubmit={videoUpscaleCanSubmit}
                onSubmit={submitVideoUpscale}
              />
            ) : (
              <OutputPanel tool={activeBusinessTool} output={activeOutput} libraryCount={library.length} />
            )
          )
        }
        mobileActionSlot={mobileAction ? <MobileActionBar {...mobileAction} /> : null}
      />
      {imageGenerationProgress.length ? (
        <ImageGenerationProgressToast
          progress={imageGenerationProgress}
          tick={generationProgressTick}
          stacked={Boolean(message)}
          onClose={closeImageGenerationProgress}
        />
      ) : null}
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
      {logoutConfirmOpen ? (
        <LogoutConfirmDialog
          loading={accountSummaryBusy}
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={() => void handleLogout()}
        />
      ) : null}
    </>
  );
}

function UserCenterWorkspace({
  user,
  quota,
  membershipSnapshot,
  usage,
  loading,
  billingOrders,
  accountView,
  planStatus,
  checkInRecords,
  onViewChange,
  onRefreshAccount,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  membershipSnapshot: MembershipStatusResponse | null;
  usage: UsagePage | null;
  loading: boolean;
  billingOrders: BillingOrder[];
  accountView: AccountView;
  planStatus: PlanStatus;
  checkInRecords: PublicDailyCheckInRecord[];
  onViewChange: (view: AccountView) => void;
  onRefreshAccount: () => void;
}) {
  if (accountView === "recharge") {
    return (
      <RechargeCenterWorkspace
        user={user}
        quota={quota}
        membershipSnapshot={membershipSnapshot}
        loading={loading}
        planStatus={planStatus}
        onViewChange={onViewChange}
        onRefreshAccount={onRefreshAccount}
      />
    );
  }

  if (accountView === "usage") {
    return (
      <UsageRecordsWorkspace
        usage={usage}
        billingOrders={billingOrders}
        checkInRecords={checkInRecords}
        loading={loading}
        onViewChange={onViewChange}
      />
    );
  }

  if (accountView === "orders") {
    return (
      <OrderRecordsWorkspace
        billingOrders={billingOrders}
        loading={loading}
        onViewChange={onViewChange}
      />
    );
  }

  return (
    <UserCenterOverview
      user={user}
      quota={quota}
      membershipSnapshot={membershipSnapshot}
      usage={usage}
      billingOrders={billingOrders}
      checkInRecords={checkInRecords}
      loading={loading}
      planStatus={planStatus}
      onViewChange={onViewChange}
    />
  );
}

function createMembershipEntitlementItems(entitlements: MembershipEntitlements | null) {
  if (!entitlements) return [];
  return [
    {
      key: "prompt_optimize",
      label: "Prompt Optimize",
      value: `${formatQuotaUnits(entitlements.prompt_optimize.remaining)} uses`,
      remaining: entitlements.prompt_optimize.remaining,
    },
    {
      key: "image_generation",
      label: "Image Generation",
      value: `${formatQuotaUnits(entitlements.image_generation.remaining)} items`,
      remaining: entitlements.image_generation.remaining,
    },
    {
      key: "video_generation",
      label: "Video Generation",
      value: `${formatQuotaUnits(entitlements.video_generation.remaining)} uses`,
      remaining: entitlements.video_generation.remaining,
    },
    {
      key: "image_edit",
      label: "Image Edit",
      value: `${formatQuotaUnits(entitlements.image_edit.remaining)} items`,
      remaining: entitlements.image_edit.remaining,
    },
    {
      key: "image_upscale",
      label: "Image Upscale",
      value: `${formatQuotaUnits(entitlements.image_upscale.remaining)} items`,
      remaining: entitlements.image_upscale.remaining,
    },
    {
      key: "video_upscale",
      label: "Video Upscale",
      value: `${formatQuotaUnits(entitlements.video_upscale.remaining)} uses`,
      remaining: entitlements.video_upscale.remaining,
    },
  ].filter((item) => item.remaining > 0);
}

function membershipEntitlementLabel(
  entitlements: MembershipEntitlements | null | undefined,
  kind: keyof MembershipEntitlements,
  unit: "次" | "张",
  fallback: string,
) {
  const remaining = entitlements?.[kind]?.remaining ?? 0;
  return remaining > 0 ? `/ 剩余 ${formatQuotaUnits(remaining)} ${unit}` : fallback;
}

function formatMembershipDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function UserCenterOverview({
  user,
  quota,
  membershipSnapshot,
  usage,
  billingOrders,
  checkInRecords,
  loading,
  planStatus,
  onViewChange,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  membershipSnapshot: MembershipStatusResponse | null;
  usage: UsagePage | null;
  billingOrders: BillingOrder[];
  checkInRecords: PublicDailyCheckInRecord[];
  loading: boolean;
  planStatus: PlanStatus;
  onViewChange: (view: AccountView) => void;
}) {
  const recentRecords = useMemo(
    () => createAccountRecords(usage?.entries || [], billingOrders, checkInRecords).slice(0, 6),
    [billingOrders, checkInRecords, usage?.entries],
  );
  const quotaUnits = quota?.quota_units ?? null;
  const quotaValue = loading ? "加载中" : quota ? `${formatQuotaUnits(quota.quota_units)} ✦` : "—";
  const quotaNote = loading
    ? "正在同步真实账户积分。"
    : quota
      ? "积分用于图片和视频创作。"
      : "登录后将显示真实账户积分。";
  const entitlementItems = createMembershipEntitlementItems(membershipSnapshot?.membership.entitlements ?? null);
  const planDisplay = getPlanStatusDisplay(planStatus);
  const planTone = getPlanTone(planDisplay.label);
  const activeMembership = membershipSnapshot?.membership.active ?? null;
  const planEndsAtLabel = formatMembershipDate(activeMembership?.ends_at);
  const previousQuotaUnitsRef = useRef<number | null>(quotaUnits);
  const [quotaChanged, setQuotaChanged] = useState(false);

  useEffect(() => {
    if (quotaUnits === null) return undefined;
    if (previousQuotaUnitsRef.current === null) {
      previousQuotaUnitsRef.current = quotaUnits;
      return undefined;
    }
    if (previousQuotaUnitsRef.current === quotaUnits) return undefined;

    previousQuotaUnitsRef.current = quotaUnits;
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      setQuotaChanged(true);
      timer = window.setTimeout(() => setQuotaChanged(false), 720);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [quotaUnits]);

  return (
    <section className="user-center-page" aria-label="用户中心">
      <header className="user-center-page__header">
        <div>
          <h2>用户中心</h2>
          <p>查看积分、套餐、签到与订单信息</p>
        </div>
      </header>

      <div className="user-center-page__grid">
        <div className="user-center-page__main">
          <div className="user-center-account-summary">
            <article className={cn("user-center-points-card", quotaChanged && "is-updated")}>
              <div className="user-center-points-card__copy">
                <span>可用积分</span>
                <div className="user-center-points-card__main">
                  <strong className="user-center-points-card__value">{quotaValue}</strong>
                  <button type="button" className="user-center-action user-center-action--primary" onClick={() => onViewChange("recharge")} disabled={!user}>
                    <WalletCards className="size-4" aria-hidden="true" />
                    立即充值
                  </button>
                </div>
                <p>{quotaNote}</p>
              </div>
            </article>

            <div className="user-center-side-cards">
              <article className={cn("user-center-mini-card", `user-center-mini-card--${planTone}`)}>
                <span className="user-center-card-icon">
                  <Crown className="size-4" aria-hidden="true" />
                </span>
                <div className="user-center-mini-card__body">
                  <span className="user-center-membership-label">当前会员</span>
                  <div className="user-center-mini-card__main">
                    <div className="user-center-plan-line">
                      <strong className={cn("user-center-plan-name", `user-center-plan-name--${planTone}`)}>{planDisplay.label}</strong>
                      <span>{planEndsAtLabel ? `${planEndsAtLabel} 到期` : "暂未开通"}</span>
                    </div>
                    <button
                      type="button"
                      className="user-center-mini-card__action"
                      onClick={() => onViewChange("recharge")}
                      disabled={!user}
                    >
                      {planDisplay.actionLabel}
                    </button>
                  </div>
                  {!planEndsAtLabel ? (
                    <p>{planStatus.status === "active" ? "会员权益以账户数据为准。" : planDisplay.note}</p>
                  ) : null}
                  {entitlementItems.length ? (
                    <div className="user-center-entitlement-block">
                      <div className="user-center-entitlement-strip" aria-label="会员剩余次数">
                        {entitlementItems.map((item) => (
                          <span key={item.key} className="user-center-entitlement-pill">
                            <em>{item.label}</em>
                            <strong>{item.value}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>

            </div>
          </div>

          <section className="user-center-quick-links" aria-label="快捷入口">
            {[
              { label: "积分明细", note: "查看全部积分变动", icon: History, view: "usage" as AccountView },
              { label: "订单记录", note: "充值与会员订单", icon: CreditCard, view: "orders" as AccountView },
              { label: "会员套餐", note: "订阅与积分充值", icon: Crown, view: "recharge" as AccountView },
              { label: "签到记录", note: "查看签到积分", icon: CalendarCheck, view: "usage" as AccountView },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} type="button" className="user-center-quick-link" onClick={() => onViewChange(item.view)} disabled={!user}>
                  <span><Icon className="size-4" aria-hidden="true" /></span>
                  <strong>{item.label}</strong>
                  <em>{item.note}</em>
                </button>
              );
            })}
          </section>

          <section className="user-center-usage">
            <div className="user-center-section-head">
              <div>
                <h3>最近积分记录</h3>
                <p>仅展示最近的真实积分变动。</p>
              </div>
              <button type="button" className="user-center-link-button" onClick={() => onViewChange("usage")}>
                查看全部记录
              </button>
            </div>

            {loading && !recentRecords.length ? (
              <div className="user-center-usage__list">
                <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
                  <span>时间</span>
                  <span>类型</span>
                  <span>积分变动</span>
                  <span>积分余额</span>
                  <span>描述</span>
                </div>
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="user-center-usage__row user-center-usage__row--skeleton" aria-hidden="true">
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                  </div>
                ))}
              </div>
            ) : recentRecords.length ? (
              <div className="user-center-usage__list">
                <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
                  <span>时间</span>
                  <span>类型</span>
                  <span>积分变动</span>
                  <span>积分余额</span>
                  <span>描述</span>
                </div>
                {recentRecords.map((record, index) => (
                  <div key={record.id} className={cn("user-center-usage__row", `is-${record.kind}`)} style={{ "--usage-row-delay": `${index < 6 ? index * 24 : 0}ms` } as CSSProperties}>
                    <span>{formatUsageDate(record.createdAt)}</span>
                    <strong>{record.typeLabel}</strong>
                    <em>{formatAccountQuotaChange(record)}</em>
                    <span className="user-center-usage__balance">{formatAccountQuotaBalance(record)}</span>
                    <span>{record.description}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="user-center-usage__empty">
                <History className="size-5" aria-hidden="true" />
                <strong>暂无积分记录</strong>
                <span>开始生成图片或视频后，记录会自动出现在这里。</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function RechargeCenterWorkspace({
  user,
  quota,
  membershipSnapshot,
  loading,
  planStatus,
  onViewChange,
  onRefreshAccount,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  membershipSnapshot: MembershipStatusResponse | null;
  loading: boolean;
  planStatus: PlanStatus;
  onViewChange: (view: AccountView) => void;
  onRefreshAccount: () => void;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState("advanced");
  const [selectedPlanCycle, setSelectedPlanCycle] = useState<PlanCycle>("monthly");
  const [selectedCreditAmount, setSelectedCreditAmount] = useState<number | null>(59.9);
  const [customAmount, setCustomAmount] = useState("");
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [paymentChannels, setPaymentChannels] = useState<PublicPaymentChannelConfig[]>([]);
  const [selectedPaymentChannel, setSelectedPaymentChannel] = useState("");
  const [paymentConfigLoading, setPaymentConfigLoading] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [latestPayment, setLatestPayment] = useState<CreateBillingOrderResponse | null>(null);

  const defaultPlan = planOptions.find((plan) => plan.recommended) || planOptions[0] || null;
  const selectedPlan = planOptions.find((plan) => plan.id === selectedPlanId) || defaultPlan;
  const selectedCredit = selectedCreditAmount === null
    ? null
    : creditTopUpOptions.find((option) => option.amount === selectedCreditAmount) || null;
  const productionPaymentChannels = useMemo(
    () => paymentChannels.filter((channel) => channel.enabled && channel.channel.startsWith("production_")),
    [paymentChannels],
  );
  const selectedPaymentChannelConfig = productionPaymentChannels.find((channel) => channel.channel === selectedPaymentChannel)
    || productionPaymentChannels[0]
    || null;
  const customAmountValue = Number(customAmount);
  const customAmountEntered = customAmount.trim() !== "";
  const customAmountValid = customAmountEntered && Number.isFinite(customAmountValue) && customAmountValue >= CUSTOM_RECHARGE_MIN_AMOUNT;
  const customCredits = customAmountValid ? estimateRechargeCredits(selectedPaymentChannelConfig, customAmountValue) : 0;
  const customRechargeActive = customAmount.trim() !== "";
  const customAmountError = customAmountEntered && !customAmountValid
    ? `最低充值金额 ¥${CUSTOM_RECHARGE_MIN_AMOUNT}`
    : "";
  const customAmountHelpId = "custom-recharge-help";
  const customAmountErrorId = "custom-recharge-error";
  const pointsStatusLabel = quota ? `${formatQuotaUnits(quota.quota_units)} ✦` : "—";
  const planStatusLabel = getPlanStatusDisplay(planStatus).label;
  const membershipStatusLabel = planStatus.status === "active" ? planStatusLabel : "暂无会员";
  const creditSummaryLines = customRechargeActive
    ? createCustomCreditSummaryLines(customAmount, customAmountValid, customCredits)
    : createFixedCreditSummaryLines(selectedCredit, selectedPaymentChannelConfig);
  const creditSummaryReady = customRechargeActive ? customAmountValid : Boolean(selectedCredit);
  const creditPayableAmount = customRechargeActive && customAmountValid
    ? customAmount
    : selectedCredit?.amount ?? "";
  const creditPayableMinorAmount = creditPayableAmount === "" ? Number.NaN : rechargeAmountToMinor(creditPayableAmount);
  const creditAmountAllowed = selectedPaymentChannelConfig
    ? paymentChannelAllowsAmount(selectedPaymentChannelConfig, creditPayableMinorAmount)
    : false;
  const activePlanId = membershipSnapshot?.membership.active?.plan_id ?? null;
  const creditConfirmState = createRechargeConfirmState({
    mode: "credits",
    user,
    ready: creditSummaryReady,
    customRechargeActive,
    customAmountValid,
    amount: creditPayableAmount,
    paymentConfigLoading,
    paymentSubmitting,
    paymentChannelReady: Boolean(selectedPaymentChannelConfig),
    paymentAmountAllowed: creditAmountAllowed,
  });
  const latestPaymentDisplay = latestPayment ? createPaymentDisplay(latestPayment.payment) : null;
  const creditPaymentNote = paymentError || undefined;

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPaymentChannels([]);
      setSelectedPaymentChannel("");
      setPaymentError("");
      setLatestPayment(null);
      return () => {
        cancelled = true;
      };
    }
    setPaymentConfigLoading(true);
    setPaymentError("");
    fetchJson<BillingConfigResponse>("/api/billing/config")
      .then((data) => {
        if (cancelled) return;
        const channels = data.channels || [];
        const productionChannels = channels.filter((channel) => channel.enabled && channel.channel.startsWith("production_"));
        setPaymentChannels(channels);
        setSelectedPaymentChannel((current) => (
          productionChannels.some((channel) => channel.channel === current)
            ? current
            : productionChannels[0]?.channel || ""
        ));
      })
      .catch((error) => {
        if (cancelled) return;
        setPaymentChannels([]);
        setSelectedPaymentChannel("");
        setPaymentError(error instanceof ApiError ? error.message : "支付通道配置读取失败");
      })
      .finally(() => {
        if (!cancelled) setPaymentConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleRechargePayment = useCallback(async (
    amount: number | string,
    product: { productType: "credits" } | { productType: "membership"; planId: string; cycle: PlanCycle },
  ) => {
    if (!user || !selectedPaymentChannelConfig || paymentSubmitting) return;
    const requestedAmount = rechargeAmountToMinor(amount);
    if (!paymentChannelAllowsAmount(selectedPaymentChannelConfig, requestedAmount)) {
      setPaymentError("金额不符合支付规则");
      return;
    }
    setPaymentSubmitting(true);
    setPaymentError("");
    setLatestPayment(null);
    try {
      const result = await fetchJsonWithCsrf<CreateBillingOrderResponse>("/api/billing/orders", {
        method: "POST",
        body: JSON.stringify({
          channel: selectedPaymentChannelConfig.channel,
          currency: "CNY",
          requestedAmount,
          productType: product.productType,
          ...(product.productType === "membership" ? { planId: product.planId, cycle: product.cycle } : {}),
          idempotencyKey: createTaskId("billing-order"),
        }),
      });
      setLatestPayment(result);
      if (product.productType === "credits") {
        setCreditsDialogOpen(false);
      }
      const display = createPaymentDisplay(result.payment);
      if (!display.qrImageUrl && !display.paymentUrl) {
        setPaymentError("支付已发起，但支付网关未返回二维码。");
      }
    } catch (error) {
      setPaymentError(error instanceof ApiError ? error.message : "发起支付失败");
    } finally {
      setPaymentSubmitting(false);
    }
  }, [
    paymentSubmitting,
    selectedPaymentChannelConfig,
    user,
  ]);

  const handleCreditPayment = useCallback(() => {
    if (!creditSummaryReady || !creditAmountAllowed || creditPayableAmount === "") return;
    void handleRechargePayment(creditPayableAmount, { productType: "credits" });
  }, [creditAmountAllowed, creditPayableAmount, creditSummaryReady, handleRechargePayment]);

  return (
    <>
    <section className="user-center-page account-subpage account-subpage--recharge" aria-label="会员订阅">
      <header className="recharge-pricing-header">
        <div className="recharge-pricing-header__main">
          <button type="button" className="account-subpage-back" onClick={() => onViewChange("center")}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回用户中心
          </button>
          <div>
            <h2>会员订阅</h2>
          </div>
        </div>
        <div className="recharge-account-meta" aria-label="账户概览">
          <span className="recharge-account-meta__item recharge-account-meta__item--points">
            <span>积分</span>
            {loading && !quota ? (
              <i className="recharge-account-meta__skeleton motion-skeleton-shimmer" aria-label="积分加载中" />
            ) : (
              <strong>{pointsStatusLabel}</strong>
            )}
          </span>
          <span className="recharge-account-meta__item">
            <span>会员</span>
            {planStatus.status === "loading" ? (
              <i className="recharge-account-meta__skeleton motion-skeleton-shimmer" aria-label="套餐加载中" />
            ) : (
              <strong>{membershipStatusLabel}</strong>
            )}
          </span>
          <button type="button" className="recharge-toolbar-button recharge-toolbar-button--primary" onClick={() => setCreditsDialogOpen(true)}>
            <WalletCards className="size-4" aria-hidden="true" />
            积分充值
          </button>
        </div>
      </header>

      <div className="recharge-center-shell">
        <div className="recharge-pricing-toolbar">
          <div className="recharge-plan-cycles" role="tablist" aria-label="会员周期">
            {planCycleOptions.map((cycle) => (
              <button
                key={cycle.id}
                type="button"
                role="tab"
                aria-selected={selectedPlanCycle === cycle.id}
                className={cn("recharge-plan-cycle", selectedPlanCycle === cycle.id && "is-active")}
                onClick={() => setSelectedPlanCycle(cycle.id)}
              >
                <span>{cycle.label}</span>
                {cycle.badge ? <small>{cycle.badge}</small> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="recharge-layout">
          <div className="recharge-layout__selection">
            <div className="recharge-center-panel" role="tabpanel">
                {planOptions.length > 0 ? (
                <div className="recharge-plan-grid">
                  {planOptions.map((plan) => {
                    const selected = selectedPlan?.id === plan.id;
                    const planPrice = getPlanCyclePrice(plan, selectedPlanCycle);
                    const planCredits = plan.monthlyCredits;
                    const priceMeta = createPlanPriceMeta(plan, selectedPlanCycle);
                    const planCardAmountAllowed = selectedPaymentChannelConfig
                      ? paymentChannelAllowsAmount(selectedPaymentChannelConfig, rechargeAmountToMinor(planPrice))
                      : false;
                    const purchaseState = createPlanPurchaseState({
                      user,
                      plan,
                      activePlanId,
                      paymentConfigLoading,
                      paymentSubmitting,
                      paymentChannelReady: Boolean(selectedPaymentChannelConfig),
                      paymentAmountAllowed: planCardAmountAllowed,
                    });
                    const planCardDisabled = purchaseState.disabled;
                    return (
                      <article
                        key={plan.id}
                        className={cn("recharge-plan-card", selected && "is-selected", planCardDisabled && "is-disabled")}
                        onClick={() => setSelectedPlanId(plan.id)}
                      >
                        <span className="recharge-plan-card__top">
                          <span className="recharge-plan-card__scene">{plan.highlight}</span>
                          {plan.recommended ? <span className="recharge-card-badge">推荐选择</span> : null}
                        </span>
                        <span className="recharge-plan-card__name">{plan.name}</span>
                        <span className="recharge-plan-card__price">
                          <em>¥</em>{formatRechargeAmount(planPrice)}<small>/{selectedPlanCycle === "yearly" ? "年" : selectedPlanCycle === "quarterly" ? "季" : "月"}</small>
                        </span>
                        {priceMeta ? (
                          <span className="recharge-plan-card__price-meta">
                            <span>原价 {priceMeta.original}</span>
                            <span>折合 {priceMeta.monthly} / 月</span>
                          </span>
                        ) : null}
                        <span className="recharge-plan-card__desc">{plan.description}</span>
                        <span className="recharge-plan-card__credits">
                          <Sparkles className="size-4" aria-hidden="true" />
                          首月立即到账 {formatQuotaUnits(planCredits)} 积分
                        </span>
                        <span className="recharge-plan-card__facts" role="list" aria-label={`${plan.name}套餐信息`}>
                          {[plan.bonusLabel, ...plan.perks].slice(0, 5).map((item) => (
                            <span key={item} role="listitem">
                              <Check className="size-3.5" aria-hidden="true" />
                              <span>{item}</span>
                            </span>
                          ))}
                        </span>
                        {purchaseState.reason ? <span className="recharge-plan-card__reason">{purchaseState.reason}</span> : null}
                        <button
                          type="button"
                          className="recharge-plan-card__action"
                          disabled={planCardDisabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (planCardDisabled) return;
                            setSelectedPlanId(plan.id);
                            setPaymentError("");
                            setLatestPayment(null);
                            void handleRechargePayment(planPrice, {
                              productType: "membership",
                              planId: plan.id,
                              cycle: selectedPlanCycle,
                            });
                          }}
                        >
                          {purchaseState.label}
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="recharge-plan-empty" role="status">
                  <Crown className="size-5" aria-hidden="true" />
                  <strong>暂无套餐</strong>
                  <span>当前仅支持积分充值。</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <section className="membership-faq" aria-label="会员规则说明">
          <div className="membership-faq__head">
            <span>会员规则 FAQ</span>
            <p>支付、续费、赠送权益和到账规则统一在这里说明。</p>
          </div>
          <div className="membership-faq__grid">
            {membershipFaqItems.map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
    {creditsDialogOpen ? (
      <CreditsPurchaseDialog
        user={user}
        pointsStatusLabel={pointsStatusLabel}
        selectedCredit={selectedCredit}
        selectedPaymentChannelConfig={selectedPaymentChannelConfig}
        customRechargeActive={customRechargeActive}
        customAmount={customAmount}
        customAmountError={customAmountError}
        customAmountHelpId={customAmountHelpId}
        customAmountErrorId={customAmountErrorId}
        customAmountValid={customAmountValid}
        customCredits={customCredits}
        creditSummaryLines={creditSummaryLines}
        creditPaymentNote={creditPaymentNote}
        creditConfirmState={creditConfirmState}
        creditPayableAmount={creditPayableAmount}
        onClose={() => setCreditsDialogOpen(false)}
        onSelectCredit={(amount) => {
          setSelectedCreditAmount(amount);
          setCustomAmount("");
          setPaymentError("");
          setLatestPayment(null);
        }}
        onCustomAmountChange={(value) => {
          setCustomAmount(sanitizeRechargeAmount(value));
          setSelectedCreditAmount(null);
          setPaymentError("");
          setLatestPayment(null);
        }}
        onConfirm={handleCreditPayment}
      />
    ) : null}
    {latestPayment && latestPaymentDisplay ? (
      <PaymentQrDialog
        orderId={latestPayment.order.order_id}
        display={latestPaymentDisplay}
        amountLabel={formatMinorCurrency(latestPayment.order.requested_amount)}
        creditsLabel={formatQuotaUnits(latestPayment.order.credited_quota)}
        onPaid={onRefreshAccount}
        onClose={() => setLatestPayment(null)}
      />
    ) : null}
    </>
  );
}

function UsageRecordsWorkspace({
  usage,
  billingOrders,
  checkInRecords,
  loading,
  onViewChange,
}: {
  usage: UsagePage | null;
  billingOrders: BillingOrder[];
  checkInRecords: PublicDailyCheckInRecord[];
  loading: boolean;
  onViewChange: (view: AccountView) => void;
}) {
  const [filter, setFilter] = useState<AccountUsageFilter>("all");
  const records = useMemo(() => createAccountRecords(usage?.entries || [], billingOrders, checkInRecords), [billingOrders, checkInRecords, usage?.entries]);
  const filteredRecords = filter === "all" ? records : records.filter((record) => record.kind === filter);

  return (
    <section className="user-center-page account-subpage account-subpage--usage" aria-label="积分明细">
      <AccountSubpageHeader
        breadcrumb="用户中心 / 积分明细"
        title="积分明细"
        subtitle="只展示真实产生的积分支出、充值和签到记录"
        onBack={() => onViewChange("center")}
      />

      <div className="usage-record-filters" role="tablist" aria-label="记录筛选">
        {[
          ["all", "全部"],
          ["spend", "支出"],
          ["recharge", "充值"],
          ["checkin", "签到"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cn("usage-record-filter", filter === value && "is-active")}
            onClick={() => setFilter(value as AccountUsageFilter)}
            aria-pressed={filter === value}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="user-center-usage account-records">
        {loading && !records.length ? (
          <div className="user-center-usage__list">
            <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
              <span>时间</span>
              <span>类型</span>
              <span>积分变动</span>
              <span>积分余额</span>
              <span>描述</span>
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="user-center-usage__row user-center-usage__row--skeleton" aria-hidden="true">
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : filteredRecords.length ? (
          <div className="user-center-usage__list">
            <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
              <span>时间</span>
              <span>类型</span>
              <span>积分变动</span>
              <span>积分余额</span>
              <span>描述</span>
            </div>
            {filteredRecords.map((record, index) => (
              <div
                key={record.id}
                className={cn("user-center-usage__row", "account-record-row", `is-${record.kind}`)}
                style={{ "--usage-row-delay": `${index < 6 ? index * 24 : 0}ms` } as CSSProperties}
              >
                <span>{formatUsageDate(record.createdAt)}</span>
                <strong>{record.typeLabel}</strong>
                <em>{formatAccountQuotaChange(record)}</em>
                <span className="user-center-usage__balance">{formatAccountQuotaBalance(record)}</span>
                <span>{record.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="user-center-usage__empty">
            <History className="size-5" aria-hidden="true" />
            <strong>暂无积分明细</strong>
            <span>充值、签到或使用创作工具后，相关记录会显示在这里。</span>
          </div>
        )}
      </section>
    </section>
  );
}

function OrderRecordsWorkspace({
  billingOrders,
  loading,
  onViewChange,
}: {
  billingOrders: BillingOrder[];
  loading: boolean;
  onViewChange: (view: AccountView) => void;
}) {
  const sortedOrders = useMemo(
    () => [...billingOrders].sort((a, b) => Number(new Date(b.created_at)) - Number(new Date(a.created_at))),
    [billingOrders],
  );

  return (
    <section className="user-center-page account-subpage account-subpage--orders" aria-label="订单记录">
      <AccountSubpageHeader
        breadcrumb="用户中心 / 订单记录"
        title="订单记录"
        subtitle="展示真实充值订单和会员订单"
        onBack={() => onViewChange("center")}
      />

      <section className="user-center-usage account-records account-orders">
        {loading && !sortedOrders.length ? (
          <div className="user-center-usage__list">
            <div className="user-center-usage__row user-center-usage__row--head account-order-row" aria-hidden="true">
              <span>时间</span>
              <span>订单类型</span>
              <span>套餐/充值内容</span>
              <span>金额</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="user-center-usage__row user-center-usage__row--skeleton account-order-row" aria-hidden="true">
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
                <span className="motion-skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : sortedOrders.length ? (
          <div className="user-center-usage__list">
            <div className="user-center-usage__row user-center-usage__row--head account-order-row" aria-hidden="true">
              <span>时间</span>
              <span>订单类型</span>
              <span>套餐/充值内容</span>
              <span>金额</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {sortedOrders.map((order, index) => (
              <div
                key={order.order_id}
                className={cn("user-center-usage__row", "account-order-row", `is-${order.status}`)}
                style={{ "--usage-row-delay": `${index < 8 ? index * 24 : 0}ms` } as CSSProperties}
              >
                <span>{formatUsageDate(order.created_at)}</span>
                <strong>{formatOrderType(order)}</strong>
                <span>{formatOrderContent(order)}</span>
                <span>{formatMinorCurrency(order.paid_amount || order.requested_amount)}</span>
                <em>{formatOrderStatus(order.status)}</em>
                <span>{formatOrderAction(order.status)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="user-center-usage__empty">
            <CreditCard className="size-5" aria-hidden="true" />
            <strong>暂无订单记录</strong>
            <span>充值积分或开通会员后，订单会显示在这里。</span>
          </div>
        )}
      </section>
    </section>
  );
}

function AccountSubpageHeader({
  breadcrumb,
  title,
  subtitle,
  meta,
  actions,
  onBack,
}: {
  breadcrumb: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <header className="account-subpage-header">
      <button type="button" className="account-subpage-back" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        返回用户中心
      </button>
      <div className="account-subpage-header__main">
        <div>
          <span className="account-subpage-breadcrumb">{breadcrumb}</span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
          {meta ? <div className="account-subpage-header__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="account-subpage-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

function RechargeConfirmPanel({
  icon,
  title,
  lines,
  note,
  buttonLabel,
  disabled,
  onConfirm,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  lines: Array<[string, string]>;
  note?: string;
  buttonLabel: string;
  disabled: boolean;
  onConfirm: (text?: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <section className="recharge-confirm-panel" aria-label={title}>
      <div className="recharge-confirm-panel__head">
        <span>{icon}</span>
        <strong>{title}</strong>
      </div>
      <div className="recharge-confirm-panel__lines">
        {lines.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {note ? <p className="recharge-confirm-panel__note">{note}</p> : null}
      {extra}
      <button type="button" className="recharge-confirm-button" onClick={() => onConfirm()} disabled={disabled}>
        {buttonLabel}
      </button>
    </section>
  );
}

function CreditsPurchaseDialog({
  user,
  pointsStatusLabel,
  selectedCredit,
  selectedPaymentChannelConfig,
  customRechargeActive,
  customAmount,
  customAmountError,
  customAmountHelpId,
  customAmountErrorId,
  customAmountValid,
  customCredits,
  creditSummaryLines,
  creditPaymentNote,
  creditConfirmState,
  creditPayableAmount,
  onClose,
  onSelectCredit,
  onCustomAmountChange,
  onConfirm,
}: {
  user: PublicAuthUser | null;
  pointsStatusLabel: string;
  selectedCredit: CreditTopUpOption | null;
  selectedPaymentChannelConfig: PublicPaymentChannelConfig | null;
  customRechargeActive: boolean;
  customAmount: string;
  customAmountError: string;
  customAmountHelpId: string;
  customAmountErrorId: string;
  customAmountValid: boolean;
  customCredits: number;
  creditSummaryLines: Array<[string, string]>;
  creditPaymentNote?: string;
  creditConfirmState: ReturnType<typeof createRechargeConfirmState>;
  creditPayableAmount: number | string;
  onClose: () => void;
  onSelectCredit: (amount: number) => void;
  onCustomAmountChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const profileName = user?.display_name || user?.username || "未登录";
  const profileBadge = profileName.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="credits-dialog" role="dialog" aria-modal="true" aria-label="积分充值">
      <button type="button" className="credits-dialog__backdrop" aria-label="关闭积分充值弹窗" onClick={onClose} />
      <div className="credits-dialog__card">
        <div className="credits-dialog__head">
          <div className="credits-dialog__profile">
            <span className="credits-dialog__avatar" aria-hidden="true">{profileBadge}</span>
            <div className="credits-dialog__title">
              <strong>{profileName}</strong>
              <span>{user ? "按需补量，适合图片与视频生成消耗" : "登录后即可购买积分"}</span>
            </div>
          </div>
          <div className="credits-dialog__meta">
            <span className="credits-dialog__points">
              <Sparkles className="size-3.5" aria-hidden="true" />
              我的积分 {pointsStatusLabel}
            </span>
            <button type="button" className="credits-dialog__close" aria-label="关闭积分充值弹窗" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="credits-dialog__body">
          <div className="credits-dialog__picker">
            <div className="credits-dialog__section-head">
              <span>积分购买</span>
            </div>
            <div className="credit-topup-grid credits-dialog__grid">
              {creditTopUpOptions.map((option) => {
                const selected = !customRechargeActive && selectedCredit?.amount === option.amount;
                const credits = estimateRechargeCredits(selectedPaymentChannelConfig, option.amount, option.credits);
                const giftCredits = getCreditTopUpGift(option, selectedPaymentChannelConfig);
                const badge = getCreditTopUpBadge(option, creditTopUpOptions, selectedPaymentChannelConfig);
                return (
                  <button
                    key={option.amount}
                    type="button"
                    className={cn("credit-topup-card", selected && "is-selected")}
                    onClick={() => onSelectCredit(option.amount)}
                    aria-pressed={selected}
                  >
                    <span className="credit-topup-card__headline">
                      <strong className="credit-topup-card__amount">¥{formatRechargeAmount(option.amount)}</strong>
                      {badge ? <span className="recharge-card-badge">{badge}</span> : null}
                    </span>
                    <span className="credit-topup-card__credits">到账 {formatQuotaUnits(credits)} 积分</span>
                    {giftCredits > 0 ? (
                      <span className="credit-topup-card__gift">含赠送 {formatQuotaUnits(giftCredits)} 积分</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className={cn("custom-recharge-card credits-dialog__custom", customRechargeActive && "is-active")}>
              <label className="custom-recharge-field">
                <span>充值金额</span>
                <span className={cn("custom-recharge-input", customAmountError && "is-invalid")}>
                  <em aria-hidden="true">¥</em>
                  <input
                    value={customAmount}
                    inputMode="decimal"
                    placeholder="输入金额"
                    onChange={(event) => onCustomAmountChange(event.target.value)}
                    aria-describedby={customAmountError ? `${customAmountHelpId} ${customAmountErrorId}` : customAmountHelpId}
                    aria-invalid={customAmountError ? "true" : "false"}
                  />
                </span>
                {customAmountError ? <small id={customAmountErrorId}>{customAmountError}</small> : null}
              </label>
              <div id={customAmountHelpId} className="custom-recharge-preview">
                <span>预计到账</span>
                <strong>{customAmountValid ? formatQuotaUnits(customCredits) : "—"}</strong>
                <em>积分</em>
              </div>
            </div>

            <p className="credits-dialog__note">积分仅用于站内图片与视频生成消耗，请及时使用并保存作品。</p>
          </div>

          <div className="credits-dialog__confirm">
            <RechargeConfirmPanel
              icon={<CreditCard className="size-4" aria-hidden="true" />}
              title="积分充值确认"
              lines={creditSummaryLines}
              note={creditPaymentNote}
              buttonLabel={creditConfirmState.disabled ? creditConfirmState.label : `立即支付 ¥${formatRechargeAmount(Number(creditPayableAmount || 0))}`}
              disabled={creditConfirmState.disabled}
              onConfirm={onConfirm}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function cleanPaymentUrl(value?: string) {
  return value?.trim() || "";
}

function publicPaymentUrl(value?: string) {
  const clean = cleanPaymentUrl(value);
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.protocol === "http:" ? clean : "";
  } catch {
    return "";
  }
}

function paymentImageUrl(value?: string) {
  const clean = cleanPaymentUrl(value);
  if (clean.startsWith("data:image/")) return clean;
  return publicPaymentUrl(clean);
}

function createPaymentDisplay(payment: BillingPaymentDescriptor): PaymentDisplay {
  return {
    qrImageUrl: paymentImageUrl(payment.qrcode_image_url) || paymentImageUrl(payment.qrcode_url),
    paymentUrl: publicPaymentUrl(payment.checkout_url) || publicPaymentUrl(payment.qrcode_url) || publicPaymentUrl(payment.qrcode_image_url),
    gatewayLabel: payment.channel.startsWith("production_") ? "支付宝" : "支付宝",
  };
}

function PaymentQrDialog({
  orderId,
  display,
  amountLabel,
  creditsLabel,
  onPaid,
  onClose,
}: {
  orderId: string;
  display: PaymentDisplay;
  amountLabel: string;
  creditsLabel: string;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const [orderStatus, setOrderStatus] = useState<BillingOrder["status"] | "checking">("checking");

  const showImage = Boolean(display.qrImageUrl && failedImageUrl !== display.qrImageUrl);

  useEffect(() => {
    let cancelled = false;
    let paidHandled = false;
    const pollOrder = async () => {
      try {
        const result = await fetchJson<BillingOrderResponse>(`/api/billing/orders/${encodeURIComponent(orderId)}`);
        if (cancelled) return;
        setOrderStatus(result.order.status);
        if (result.order.status === "paid" && !paidHandled) {
          paidHandled = true;
          onPaid();
        }
      } catch {
        if (!cancelled) setOrderStatus("checking");
      }
    };
    void pollOrder();
    const timer = window.setInterval(() => void pollOrder(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onPaid, orderId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="recharge-payment-dialog" role="dialog" aria-modal="true" aria-label="支付宝扫码支付">
      <button type="button" className="recharge-payment-dialog__backdrop" aria-label="关闭支付弹窗" onClick={onClose} />
      <div className="recharge-payment-dialog__card">
        <div className="recharge-payment-dialog__head">
          <span>
            <CreditCard className="size-4" aria-hidden="true" />
            {display.gatewayLabel}
          </span>
          <button type="button" className="recharge-payment-dialog__close" aria-label="关闭支付弹窗" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="recharge-payment-qr" role="status" aria-label="支付二维码">
          <div className="recharge-payment-qr__image">
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- Z-Pay returns a runtime QR image URL outside Next image config.
              <img
                src={display.qrImageUrl}
                alt="支付宝支付二维码"
                onError={() => setFailedImageUrl(display.qrImageUrl)}
              />
            ) : (
              <span>二维码暂未返回，请关闭后重新发起支付。</span>
            )}
          </div>
          <div className="recharge-payment-qr__copy">
            <strong>支付宝扫码支付</strong>
            <span>金额 {amountLabel}，预计到账 {creditsLabel} 积分。</span>
            <span>{orderStatus === "paid" ? "支付已到账，账户信息已重新同步。" : "付款后等待积分自动到账，请勿重复付款。"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogoutConfirmDialog({
  loading,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="studio-library-confirm account-logout-confirm" role="dialog" aria-modal="true" aria-labelledby="account-logout-confirm-title">
      <button type="button" className="studio-library-confirm__backdrop" aria-label="取消退出登录" onClick={onCancel} disabled={loading} />
      <section className="studio-library-confirm__card">
        <span className="studio-library-confirm__icon" aria-hidden="true">
          <LogOut className="size-5" />
        </span>
        <div className="studio-library-confirm__copy">
          <h3 id="account-logout-confirm-title">确认退出登录？</h3>
          <p>退出后需要重新登录才能继续查看账户、作品和生成记录。</p>
        </div>
        <div className="studio-library-confirm__actions">
          <button type="button" className="studio-secondary-button" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button type="button" className="studio-danger-button" onClick={onConfirm} disabled={loading}>
            {loading ? "退出中" : "确认退出"}
          </button>
        </div>
      </section>
    </div>
  );
}

function createAccountRecords(
  usageEntries: UsageLogEntry[],
  billingOrders: BillingOrder[],
  checkInRecords: PublicDailyCheckInRecord[] = [],
) {
  const usageRecords: AccountRecord[] = usageEntries.map((entry) => ({
    id: `usage-${entry.id}`,
    createdAt: entry.created_at,
    kind: "spend",
    typeLabel: "支出",
    quotaDelta: -Math.abs(entry.actual_quota_units ?? entry.estimated_quota_units),
    balanceAfterQuotaUnits: entry.balance_after_quota_units ?? null,
    description: `${usageOperationLabel(entry.operation)}：${usageDescription(entry)}`,
  }));

  const paidOrders: AccountRecord[] = billingOrders
    .filter((order) => order.status === "paid" && order.credited_quota > 0)
    .map((order) => ({
      id: `order-${order.order_id}`,
      createdAt: order.paid_at || order.updated_at || order.created_at,
      kind: "recharge",
      typeLabel: "充值",
      quotaDelta: order.credited_quota,
      description: describeAccountCreditOrder(order),
    }));

  const checkIns: AccountRecord[] = checkInRecords
    .filter((record) => record.status === "credited" && record.quota_delta > 0)
    .map((record) => ({
      id: `checkin-${record.id}`,
      createdAt: record.created_at,
      kind: "checkin",
      typeLabel: "签到",
      quotaDelta: record.quota_delta,
      balanceAfterQuotaUnits: record.balance_after_quota_units ?? null,
      description: `每日签到奖励 ${record.quota_delta} 积分`,
    }));

  return [...usageRecords, ...paidOrders, ...checkIns].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
}

function describeAccountCreditOrder(order: BillingOrder) {
  if (order.channel === "signup_bonus") {
    return `新用户注册赠送到账，积分 ${formatQuotaUnits(order.credited_quota)}`;
  }
  if (order.channel === "admin_grant") {
    return `后台赠送到账，积分 ${formatQuotaUnits(order.credited_quota)}`;
  }
  return `充值订单已到账，金额 ${formatMinorCurrency(order.paid_amount || order.requested_amount)}`;
}

function estimateRechargeBaseCredits(channel: PublicPaymentChannelConfig | null, amount: number) {
  const minorAmount = rechargeAmountToMinor(amount);
  if (!Number.isInteger(minorAmount)) return 0;
  const quotaPerMinor = channel?.estimated_quota_units_per_minor_unit ?? CREDIT_TOP_UP_BASE_RATE / 100;
  return Math.floor(minorAmount * quotaPerMinor);
}

function estimateRechargeCredits(channel: PublicPaymentChannelConfig | null, amount: number, fallbackCredits?: number) {
  const minorAmount = rechargeAmountToMinor(amount);
  if (!Number.isInteger(minorAmount)) return fallbackCredits ?? 0;
  if (!channel) return fallbackCredits ?? Math.floor(amount * CREDIT_TOP_UP_BASE_RATE);
  const bestDiscount = channel.discounts
    .filter((discount) => minorAmount >= discount.threshold_amount)
    .sort((a, b) => b.threshold_amount - a.threshold_amount)[0];
  const multiplier = bestDiscount?.multiplier_basis_points || 10000;
  return Math.floor((minorAmount * channel.estimated_quota_units_per_minor_unit * multiplier) / 10000);
}

function getCreditTopUpGift(option: CreditTopUpOption, channel: PublicPaymentChannelConfig | null) {
  return Math.max(
    0,
    estimateRechargeCredits(channel, option.amount, option.credits) - estimateRechargeBaseCredits(channel, option.amount),
  );
}

function getCreditTopUpRate(option: CreditTopUpOption, channel: PublicPaymentChannelConfig | null) {
  if (option.amount <= 0) return 0;
  return estimateRechargeCredits(channel, option.amount, option.credits) / option.amount;
}

function getCreditTopUpBadge(option: CreditTopUpOption, options: CreditTopUpOption[], channel: PublicPaymentChannelConfig | null) {
  if (option.label === "新人首充") return "新人首充";
  if (option.label === "推荐") return "推荐";

  const bestRate = Math.max(...options.map((entry) => getCreditTopUpRate(entry, channel)));
  if (getCreditTopUpGift(option, channel) > 0 && getCreditTopUpRate(option, channel) === bestRate) return "最划算";

  return "";
}

function formatRechargeAmount(amount: number | string) {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function rechargeAmountToMinor(amount: number | string) {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  return Math.round(value * 100);
}

function paymentChannelAllowsAmount(channel: PublicPaymentChannelConfig, minorAmount: number) {
  if (!Number.isInteger(minorAmount) || minorAmount <= 0) return false;
  if (minorAmount < channel.min_amount) return false;
  if (channel.fixed_amounts.includes(minorAmount)) return true;
  return minorAmount >= channel.custom_amount_range.min_amount
    && minorAmount <= channel.custom_amount_range.max_amount;
}

function getPlanCyclePrice(plan: PlanOption, cycle: PlanCycle) {
  return plan.cyclePrices[cycle] ?? plan.price;
}

function getPlanRank(planId?: string | null) {
  if (!planId) return 0;
  return planOptions.find((plan) => plan.id === planId)?.rank ?? 0;
}

function createPlanPriceMeta(plan: PlanOption, cycle: PlanCycle) {
  if (cycle === "monthly") return null;
  const months = planCycleMonths[cycle];
  const cyclePrice = getPlanCyclePrice(plan, cycle);
  const originalPrice = getPlanCyclePrice(plan, "monthly") * months;
  return {
    original: `¥${formatRechargeAmount(originalPrice)}`,
    monthly: `¥${formatRechargeAmount(cyclePrice / months)}`,
  };
}

function createPlanPurchaseState(input: {
  user: PublicAuthUser | null;
  plan: PlanOption;
  activePlanId?: string | null;
  paymentConfigLoading?: boolean;
  paymentSubmitting?: boolean;
  paymentChannelReady?: boolean;
  paymentAmountAllowed?: boolean;
}) {
  if (!input.user) return { disabled: true, label: "登录后继续", reason: "" };

  const activeRank = getPlanRank(input.activePlanId);
  const planRank = input.plan.rank;
  if (activeRank > planRank) {
    return {
      disabled: true,
      label: "当前为更高等级会员",
      reason: "当前不支持降级，低等级套餐已禁用。",
    };
  }

  if (input.paymentConfigLoading) return { disabled: true, label: "支付配置加载中", reason: "" };
  if (input.paymentSubmitting) return { disabled: true, label: "正在发起支付", reason: "" };
  if (!input.paymentChannelReady) return { disabled: true, label: "支付通道未配置", reason: "" };
  if (!input.paymentAmountAllowed) return { disabled: true, label: "金额不符合支付规则", reason: "" };

  if (activeRank === planRank) {
    return { disabled: false, label: `续费 ${input.plan.name}`, reason: "同级续费会从当前到期时间顺延。" };
  }

  if (activeRank > 0 && activeRank < planRank) {
    return { disabled: false, label: `升级到 ${input.plan.name}`, reason: "升级后立即生效，旧套餐权益按替换规则处理。" };
  }

  return { disabled: false, label: "立即开通", reason: "" };
}

function createFixedCreditSummaryLines(option: CreditTopUpOption | null, channel: PublicPaymentChannelConfig | null): Array<[string, string]> {
  if (!option) {
    return [
      ["当前选择", "未选择"],
      ["充值金额", "—"],
      ["预计到账", "请选择充值档位或输入自定义金额"],
      ["应付金额", "—"],
    ];
  }

  const credits = estimateRechargeCredits(channel, option.amount, option.credits);
  const giftCredits = getCreditTopUpGift(option, channel);
  const baseCredits = estimateRechargeBaseCredits(channel, option.amount);
  const lines: Array<[string, string]> = [
    ["当前选择", `¥${formatRechargeAmount(option.amount)} 积分档位`],
    ["充值金额", `¥${formatRechargeAmount(option.amount)}`],
    ["基础积分", `${formatQuotaUnits(baseCredits)} 积分`],
  ];

  if (giftCredits > 0) {
    lines.push(["赠送积分", `${formatQuotaUnits(giftCredits)} 积分`]);
  }

  lines.push(["预计到账", `${formatQuotaUnits(credits)} 积分`]);
  lines.push(["应付金额", `¥${formatRechargeAmount(option.amount)}`]);
  return lines;
}

function createCustomCreditSummaryLines(amountText: string, valid: boolean, credits: number): Array<[string, string]> {
  const amount = amountText.trim();
  return [
    ["当前选择", "自定义充值"],
    ["充值金额", valid ? `¥${formatRechargeAmount(amount)}` : "未完成"],
    ["预计积分", valid ? `${formatQuotaUnits(credits)} 积分` : "—"],
    ["预计到账", valid ? `${formatQuotaUnits(credits)} 积分` : `请输入不低于 ¥${CUSTOM_RECHARGE_MIN_AMOUNT} 的金额`],
    ["应付金额", valid ? `¥${formatRechargeAmount(amount)}` : "—"],
  ];
}

function createRechargeConfirmState(input: {
  mode: RechargeTab;
  user: PublicAuthUser | null;
  ready: boolean;
  selectedPlan?: PlanOption | null;
  customRechargeActive?: boolean;
  customAmountValid?: boolean;
  amount?: number | string;
  paymentConfigLoading?: boolean;
  paymentSubmitting?: boolean;
  paymentChannelReady?: boolean;
  paymentAmountAllowed?: boolean;
}) {
  if (!input.ready) {
    if (input.mode === "credits" && input.customRechargeActive && !input.customAmountValid) {
      return { disabled: true, label: "请检查充值金额" };
    }
    return { disabled: true, label: input.mode === "plans" ? "暂无套餐" : "请选择充值金额" };
  }

  if (!input.user) return { disabled: true, label: "登录后继续" };
  if (input.paymentConfigLoading) return { disabled: true, label: "支付配置加载中" };
  if (input.paymentSubmitting) return { disabled: true, label: "正在发起支付" };
  if (!input.paymentChannelReady) return { disabled: true, label: "支付通道未配置" };
  if (!input.paymentAmountAllowed) return { disabled: true, label: "金额不符合支付规则" };

  if (input.mode === "plans" && input.selectedPlan) {
    return { disabled: false, label: `立即支付 ¥${formatRechargeAmount(input.amount ?? input.selectedPlan.price)}` };
  }

  if (input.mode === "credits" && input.amount !== undefined && input.amount !== "") {
    return { disabled: false, label: `立即支付 ¥${formatRechargeAmount(input.amount)}` };
  }

  return { disabled: true, label: "请选择充值金额" };
}

function formatSignedQuota(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatQuotaUnits(value)}`;
}

function formatAccountQuotaChange(record: AccountRecord) {
  return `${formatSignedQuota(record.quotaDelta)} 分`;
}

function formatAccountQuotaBalance(record: AccountRecord) {
  if (!Number.isFinite(record.balanceAfterQuotaUnits ?? Number.NaN)) return "--";
  return `${formatQuotaUnits(record.balanceAfterQuotaUnits || 0)} 分`;
}

function formatOrderType(order: BillingOrder) {
  if (order.channel === "signup_bonus" || order.channel === "admin_grant") return "系统赠送";
  return order.product_type === "membership" ? "会员订单" : "积分充值";
}

function formatOrderContent(order: BillingOrder) {
  if (order.channel === "signup_bonus") return `新用户注册赠送 ${formatQuotaUnits(order.credited_quota)} 积分`;
  if (order.channel === "admin_grant") return `后台赠送 ${formatQuotaUnits(order.credited_quota)} 积分`;
  if (order.product_type === "membership") {
    const planName = planOptions.find((plan) => plan.id === order.product_plan_id)?.name || order.product_plan_id || "会员套餐";
    const cycleLabel = planCycleOptions.find((cycle) => cycle.id === order.product_cycle)?.label || order.product_cycle || "";
    return cycleLabel ? `${planName} · ${cycleLabel}` : planName;
  }

  if (order.credited_quota > 0) return `${formatQuotaUnits(order.credited_quota)} 积分`;
  return "积分充值";
}

function formatOrderStatus(status: BillingOrder["status"]) {
  const labels: Record<BillingOrder["status"], string> = {
    pending: "待支付",
    processing: "处理中",
    paid: "已支付",
    failed: "支付失败",
    cancelled: "已取消",
    expired: "已过期",
    review: "人工核对",
    refunded: "已退款",
  };
  return labels[status] || status;
}

function formatOrderAction(status: BillingOrder["status"]) {
  if (status === "paid") return "已完成";
  if (status === "pending" || status === "processing") return "等待支付";
  if (status === "review") return "等待核对";
  return "--";
}

function formatMinorCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value / 100);
}

function sanitizeRechargeAmount(value: string) {
  const normalized = value.replace(/[^\d.]/g, "");
  const [integer, ...decimals] = normalized.split(".");
  const decimal = decimals.join("").slice(0, 2);
  if (!decimals.length) return integer.replace(/^0+(?=\d)/, "");
  return `${integer.replace(/^0+(?=\d)/, "") || "0"}.${decimal}`;
}

function formatUsageDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function usageOperationLabel(operation: UsageLogEntry["operation"]) {
  const labels: Record<UsageLogEntry["operation"], string> = {
    cloud_image_generation: "AI Image Generator",
    cloud_image_edit: "AI Image Editor",
    cloud_video_generation: "AI Video Generator",
    cloud_image_upscale: "Image Upscale",
    cloud_video_upscale: "Video Upscale",
    prompt_optimize: "Prompt Optimize",
  };
  return labels[operation] || "AI Tool";
}

function usageDescription(entry: UsageLogEntry) {
  const descriptions: Record<UsageLogEntry["operation"], string> = {
    cloud_image_generation: "Generate image",
    cloud_image_edit: "Edit image",
    cloud_video_generation: "Generate video",
    cloud_image_upscale: "Run image upscale",
    cloud_video_upscale: "Run video upscale",
    prompt_optimize: "Optimize prompt",
  };
  if (entry.status === "failed") return `${descriptions[entry.operation] || "Tool action"} failed`;
  if (entry.status === "refunded") return `${descriptions[entry.operation] || "Tool action"} refunded`;
  return descriptions[entry.operation] || "Tool action";
}
