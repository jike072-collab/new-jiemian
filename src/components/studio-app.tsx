"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CalendarCheck, Check, Crown, CreditCard, ExternalLink, History, Sparkles, WalletCards } from "lucide-react";
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
  grokVideo10Ratios,
  grokVideo15Ratios,
  grokVideoDurations,
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
  getCheckInStatusDisplay,
  getPlanStatusDisplay,
  type CheckInStatus,
  type PlanStatus,
} from "@/lib/account-status";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import {
  estimateUpscaleQuota,
  estimateImageGenerationQuota,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
} from "@/lib/generation-quota";
import {
  templateById,
  templateTabHref,
} from "@/lib/template-catalog";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder, PublicPaymentChannelConfig } from "@/lib/server/billing";
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

type AuthSessionResponse =
  | { ok: true; user: PublicAuthUser; mappingStatus: string | null }
  | { ok: false; code: string; uiState: string; message: string; retryAfterSeconds?: number };

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

type AccountView = "center" | "recharge" | "usage";
type RechargeTab = "plans" | "credits";
type AccountRecordKind = "spend" | "recharge" | "checkin";
type AccountUsageFilter = "all" | AccountRecordKind;

type PlanOption = {
  id: string;
  name: string;
  price: number;
  monthlyCredits: number;
  description: string;
  recommended?: boolean;
};

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
  description: string;
};

const planOptions: PlanOption[] = [
  { id: "basic", name: "基础套餐", price: 19, monthlyCredits: 220, description: "适合偶尔创作" },
  { id: "standard", name: "标准套餐", price: 49, monthlyCredits: 600, description: "适合日常商品创作", recommended: true },
  { id: "pro", name: "专业套餐", price: 99, monthlyCredits: 1300, description: "适合高频创作" },
];

const creditTopUpOptions: CreditTopUpOption[] = [
  { amount: 1, credits: 10, label: "体验充值" },
  { amount: 5, credits: 50 },
  { amount: 10, credits: 100 },
  { amount: 20, credits: 210 },
  { amount: 30, credits: 320 },
  { amount: 50, credits: 550, label: "推荐" },
  { amount: 100, credits: 1150, label: "最划算" },
  { amount: 200, credits: 2400, label: "超值" },
];

const CREDIT_TOP_UP_BASE_RATE = 10;
const CUSTOM_RECHARGE_MIN_AMOUNT = 1;
const PLAN_PERIOD_LABEL = "按月";
const PLAN_PERIOD_UNIT_LABEL = "月";
const CLIENT_IMAGE_SUBMISSION_LIMIT = 2;
const CLIENT_VIDEO_SUBMISSION_LIMIT = 1;

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
  if (view === "recharge") return "充值中心";
  if (view === "usage") return "消费记录";
  return "用户中心";
}

function createTaskId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
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
  return isGrokVideoProvider(provider) ? grokVideoDurations : defaultVideoDurations;
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
  const [usagePage, setUsagePage] = useState<UsagePage | null>(null);
  const [billingOrders, setBillingOrders] = useState<BillingOrder[]>([]);
  const [accountSummaryLoading, setAccountSummaryLoading] = useState(false);
  const [accountUsageLoading, setAccountUsageLoading] = useState(false);
  const [accountOrdersLoading, setAccountOrdersLoading] = useState(false);
  const [accountSummaryLoaded, setAccountSummaryLoaded] = useState(false);
  const [accountUsageLoaded, setAccountUsageLoaded] = useState(false);
  const [accountOrdersLoaded, setAccountOrdersLoaded] = useState(false);
  const [accountDataError, setAccountDataError] = useState("");
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView>("center");
  const [accountCloseSignal, setAccountCloseSignal] = useState(0);
  const [message, setMessage] = useState("");
  const [imageGenerationProgress, setImageGenerationProgress] = useState<ImageGenerationProgressState>([]);
  const [generationProgressTick, setGenerationProgressTick] = useState(() => Date.now());
  const [outputs, setOutputs] = useState<Partial<Record<BusinessToolId, OutputState>>>({});
  const [mobileAction, setMobileAction] = useState<MobileActionState>(null);
  const [mobilePreviewSignal, setMobilePreviewSignal] = useState(0);
  const [uploadLimits, setUploadLimits] = useState(defaultUploadLimits);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("image");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("recent");
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryDeleteConfirmItemId, setLibraryDeleteConfirmItemId] = useState<string | null>(null);
  const [deletingLibraryItemId, setDeletingLibraryItemId] = useState<string | null>(null);
  const [removingLibraryItemId, setRemovingLibraryItemId] = useState<string | null>(null);
  const [missingLibraryMediaIds, setMissingLibraryMediaIds] = useState<Set<string>>(() => new Set());
  const [imageWorkspace, setImageWorkspace] = useState<ImageWorkspaceState>({
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
  });
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
  const videoWorkspaceFilesRef = useRef<VideoWorkspaceFile[]>([]);
  const imageUpscaleFileRef = useRef<ImageUpscaleWorkspaceFile | null>(null);
  const videoUpscaleFileRef = useRef<VideoUpscaleWorkspaceFile | null>(null);
  const appliedTemplateIdRef = useRef<string | null>(null);
  const imageInFlightCountRef = useRef(0);
  const videoInFlightCountRef = useRef(0);
  const accountPlanStatus = useMemo<PlanStatus>(() => {
    if (sessionLoading || accountSummaryLoading) return { status: "loading" };
    return { status: "unavailable" };
  }, [accountSummaryLoading, sessionLoading]);
  const accountCheckInStatus = useMemo<CheckInStatus>(() => {
    if (sessionLoading || accountSummaryLoading) return "loading";
    return "unavailable";
  }, [accountSummaryLoading, sessionLoading]);
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
    setUsagePage(null);
    setBillingOrders([]);
    setAccountDataError("");
    setAccountSummaryLoading(false);
    setAccountUsageLoading(false);
    setAccountOrdersLoading(false);
    setAccountSummaryLoaded(false);
    setAccountUsageLoaded(false);
    setAccountOrdersLoaded(false);
  }, []);

  const refreshQuotaSnapshot = useCallback(async (userId?: string | null) => {
    if (!userId) {
      resetAccountState();
      return;
    }

    setAccountSummaryLoading(true);
    try {
      const quotaResult = await fetchJson<{ ok: true; quota: QuotaSnapshot }>("/api/quota");
      setQuotaSnapshot(quotaResult.quota);
      setAccountSummaryLoaded(true);
      setAccountDataError("");
    } catch (error) {
      setQuotaSnapshot(null);
      setAccountDataError("account-data-unavailable");
      if (process.env.NODE_ENV !== "production") {
        console.debug("[account] Failed to load quota snapshot", error);
      }
    } finally {
      setAccountSummaryLoading(false);
    }
  }, [resetAccountState]);

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
      const ordersResult = await fetchJson<BillingOrdersResponse>("/api/billing/orders?page=1&pageSize=8");
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
    if (options?.force || !accountSummaryLoaded) {
      tasks.push(refreshQuotaSnapshot(userId));
    }
    if (view !== "recharge" && (options?.force || !accountUsageLoaded)) {
      tasks.push(refreshUsageSnapshot(userId));
    }
    if (view === "usage" && (options?.force || !accountOrdersLoaded)) {
      tasks.push(refreshBillingOrdersSnapshot(userId));
    }
    if (tasks.length) {
      await Promise.all(tasks);
    }
  }, [
    accountOrdersLoaded,
    accountSummaryLoaded,
    accountUsageLoaded,
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
      resetAccountState();
      resetLibraryState();
      imageInFlightCountRef.current = 0;
      videoInFlightCountRef.current = 0;
      setImageGenerationProgress([]);
      router.replace("/login");
    }
  }, [resetAccountState, resetLibraryState, router, sessionUser]);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError("");
    try {
      const result = await fetchJson<AuthSessionResponse>("/api/auth/session");
      if ("ok" in result && result.ok) {
        setSessionUser(result.user);
        return;
      }
      setSessionUser(null);
      resetAccountState();
      resetLibraryState();
      setImageGenerationProgress([]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSessionUser(null);
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
  }, [resetAccountState, resetLibraryState]);

  const refreshAccountSnapshot = useCallback(async () => {
    await ensureAccountViewData(accountView, sessionUser?.local_user_id || null, { force: true });
  }, [accountView, ensureAccountViewData, sessionUser?.local_user_id]);

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
      setImageWorkspace((prev) => ({ ...prev, submitError: "", submitDiagnostic: null, fileError: "" }));
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
  const activeImageMode: WorkspaceImageMode = activeWorkspaceToolId === "image-editor" || imageWorkspace.files.length
    ? "image-to-image"
    : "text-to-image";
  const activeVideoMode: WorkspaceVideoMode = videoWorkspace.files.length ? "image-to-video" : "text-to-video";
  const templateParam = searchParams.get("template") || "";
  const activeImageTemplate = useMemo(() => templateById(imageWorkspace.templateId), [imageWorkspace.templateId]);
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
      setImageWorkspace((prev) => ({
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
    if (accountParam !== "center" && accountParam !== "recharge" && accountParam !== "usage") return;
    setAccountCenterOpen(true);
    setAccountView(accountParam);
    setAccountCloseSignal((value) => value + 1);
  }, [accountParam]);

  const currentLibraryItems = useMemo(() => {
    const search = librarySearch.trim().toLowerCase();
    const filtered = library.filter((item) => (
      item.type === libraryFilter
      && (!search
        || item.title.toLowerCase().includes(search)
        || item.prompt.toLowerCase().includes(search))
    ));
    const sorted = [...filtered];
    if (librarySort === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    } else {
      sorted.sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
    }
    return sorted;
  }, [library, libraryFilter, librarySearch, librarySort]);

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

  const handlePaymentUnavailable = useCallback((text = "充值功能暂未开放") => {
    setMessage(text);
  }, []);

  const handleCheckInUnavailable = useCallback(() => {
    setMessage("每日签到功能暂未开放。");
  }, []);

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
      await refreshLibraryAfterMutation();
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除失败。";
      setLibraryError(text);
      setMessage(text);
    } finally {
      setDeletingLibraryItemId(null);
      setRemovingLibraryItemId(null);
    }
  }, [deletingLibraryItemId, libraryDeleteConfirmItemId, prefersReducedMotion, refreshLibraryAfterMutation]);

  const libraryCounts = useMemo(() => ({
    all: library.length,
    image: library.filter((item) => item.type === "image").length,
    video: library.filter((item) => item.type === "video").length,
  }), [library]);
  const libraryDeleteConfirmItem = useMemo(
    () => library.find((item) => item.id === libraryDeleteConfirmItemId) || null,
    [library, libraryDeleteConfirmItemId],
  );
  const accountSummaryBusy = sessionLoading || accountSummaryLoading;
  const accountViewLoading = sessionLoading
    || (accountView === "usage"
      ? accountSummaryLoading || accountUsageLoading || accountOrdersLoading
      : accountView === "center"
        ? accountSummaryLoading || accountUsageLoading
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

  const handleImageResult = useCallback((item: LibraryItem) => {
    setOutputs((prev) => ({ ...prev, image: { item, title: "图片结果", tool: "image" } }));
  }, []);

  useEffect(() => {
    if (!imageGenerationProgress.some((progress) => progress.status === "running")) return undefined;

    const timer = window.setInterval(() => setGenerationProgressTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [imageGenerationProgress]);

  const selectedImageProvider = useMemo(() => {
    if (!providers.image.length) return null;
    return providers.image.find((provider) => provider.id === imageWorkspace.providerId) || providers.image[0];
  }, [imageWorkspace.providerId, providers.image]);

  const imageWorkspaceFiles = imageWorkspace.files;
  const imageWorkspaceHasFiles = imageWorkspaceFiles.length > 0;
  const imageWorkspacePrompt = imageWorkspace.prompt.trim();
  const imageWorkspaceRequiresFile = activeImageTemplate?.scope === "image" && activeImageTemplate.requiresImage;
  const imageGenerationCount = Math.min(Math.max(Math.round(Number(imageWorkspace.count) || 1), 1), 4);
  const imageEstimatedQuotaUnits = estimateImageGenerationQuota({
    mode: activeImageMode,
    quality: imageWorkspace.quality,
    referenceImages: imageWorkspace.files.length,
  }) * imageGenerationCount;
  const imageGenerationCostLabel = formatQuotaSymbolLabel(imageEstimatedQuotaUnits);
  const imageWorkspaceCanSubmit = Boolean(selectedImageProvider)
    && !providersLoading
    && imageWorkspace.inFlightCount < CLIENT_IMAGE_SUBMISSION_LIMIT
    && Boolean(imageWorkspacePrompt)
    && (!imageWorkspaceRequiresFile || imageWorkspaceHasFiles);

  const updateImageWorkspace = useCallback((patch: Partial<ImageWorkspaceState>) => {
    setImageWorkspace((prev) => ({
      ...prev,
      ...patch,
      ...("submitError" in patch && !("submitDiagnostic" in patch) ? { submitDiagnostic: null } : {}),
    }));
  }, []);

  const updateImageInFlightState = useCallback((nextCount: number) => {
    imageInFlightCountRef.current = Math.max(0, nextCount);
    setImageWorkspace((prev) => ({
      ...prev,
      inFlightCount: imageInFlightCountRef.current,
      loading: imageInFlightCountRef.current > 0,
    }));
  }, []);

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
    const prompt = imageWorkspace.prompt.trim();
    if (!prompt) {
      const text = "请先填写提示词。";
      updateImageWorkspace({
        promptOptimizeError: text,
        promptOptimizeUndo: "",
      });
      setMessage(text);
      return;
    }
    if (imageWorkspace.promptOptimizing) return;

    const originalPrompt = imageWorkspace.prompt;
    updateImageWorkspace({
      promptOptimizing: true,
      promptOptimizeError: "",
      promptOptimizeUndo: "",
    });
    try {
      const data = await fetchJsonWithCsrf<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        body: JSON.stringify({
          tool: activeWorkspaceToolId === "image-editor" ? "image-editor" : "image-generator",
          templateId: imageWorkspace.templateId,
          prompt: originalPrompt,
          hasImage: imageWorkspaceHasFiles,
          aspectRatio: imageWorkspace.ratio,
          quality: imageWorkspace.quality,
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
    imageWorkspace.prompt,
    imageWorkspace.promptOptimizing,
    imageWorkspace.quality,
    imageWorkspace.ratio,
    imageWorkspace.templateId,
    imageWorkspaceHasFiles,
    updateImageWorkspace,
  ]);

  const undoImagePromptOptimization = useCallback(() => {
    setImageWorkspace((prev) => {
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

  const replaceImageWorkspaceFiles = useCallback((files: File[]) => {
    let nextFiles: ImageWorkspaceFile[];
    try {
      nextFiles = createImageWorkspaceFiles(files);
    } catch (error) {
      setImageWorkspace((prev) => ({
        ...prev,
        fileError: error instanceof Error ? error.message : "图像读取失败。",
        submitError: "",
        submitDiagnostic: null,
      }));
      return;
    }
    setImageWorkspace((prev) => ({
      ...prev,
      files: nextFiles,
      fileError: "",
      submitError: "",
      submitDiagnostic: null,
    }));
    imageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    imageWorkspaceFilesRef.current = nextFiles;
  }, []);

  const removeImageWorkspaceFile = useCallback((index: number) => {
    setImageWorkspace((prev) => {
      const removed = prev.files[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const nextFiles = prev.files.filter((_, currentIndex) => currentIndex !== index);
      imageWorkspaceFilesRef.current = nextFiles;
      return {
        ...prev,
        files: nextFiles,
        fileError: "",
        submitError: "",
        submitDiagnostic: null,
      };
    });
  }, []);

  const clearImageWorkspaceFiles = useCallback(() => {
    imageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    imageWorkspaceFilesRef.current = [];
    setImageWorkspace((prev) => ({
      ...prev,
      files: [],
      fileError: "",
      submitError: "",
      submitDiagnostic: null,
    }));
  }, []);

  const submitImageWorkspace = useCallback(async () => {
    if (!selectedImageProvider) {
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: "当前尚未配置可用模型。",
        submitDiagnostic: null,
      }));
      setMessage("当前尚未配置可用模型。");
      return;
    }
    if (!imageWorkspacePrompt) {
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: "请输入提示词。",
        submitDiagnostic: null,
      }));
      return;
    }
    if (imageInFlightCountRef.current >= CLIENT_IMAGE_SUBMISSION_LIMIT) {
      const text = `当前最多同时进行 ${CLIENT_IMAGE_SUBMISSION_LIMIT} 个图片任务，请稍后再试。`;
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: text,
        submitDiagnostic: null,
      }));
      setMessage(text);
      return;
    }
    if (imageWorkspaceRequiresFile && !imageWorkspaceHasFiles) {
      setImageWorkspace((prev) => ({
        ...prev,
        fileError: "请先上传图像。",
      }));
      return;
    }

    const totalCount = imageGenerationCount;
    const estimatedQuotaUnitsPerImage = estimateImageGenerationQuota({
      mode: activeImageMode,
      quality: imageWorkspace.quality,
      referenceImages: imageWorkspace.files.length,
    });
    const progressId = createTaskId("image-progress");
    const snapshot = {
      providerId: selectedImageProvider.id,
      mode: activeImageMode,
      ratio: imageWorkspace.ratio,
      quality: imageWorkspace.quality,
      prompt: imageWorkspace.prompt,
      files: imageWorkspace.files.map((attachment) => attachment.file),
      estimatedQuotaUnitsPerImage,
      totalCount,
    };

    updateImageInFlightState(imageInFlightCountRef.current + 1);
    setImageWorkspace((prev) => ({
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
      message: totalCount > 1 ? `正在生成第 1 / ${totalCount} 张` : "正在生成图片",
    }]);
    try {
      for (let index = 0; index < totalCount; index += 1) {
        const taskId = createTaskId(`image-${index + 1}`);
        const requestFingerprint = generationBillingFingerprint({
          kind: "image",
          providerId: snapshot.providerId,
          mode: snapshot.mode,
          ratio: snapshot.ratio,
          quality: snapshot.quality,
          referenceImages: snapshot.files.length,
          taskId,
          estimatedQuotaUnits: snapshot.estimatedQuotaUnitsPerImage,
        });

        updateImageGenerationProgress(progressId, (current) => ({
          ...current,
          status: "running",
          current: index,
          message: totalCount > 1 ? `正在生成第 ${index + 1} / ${totalCount} 张` : "正在生成图片",
        }));

        try {
          await fetchJsonWithCsrf("/api/quota/precheck", {
            method: "POST",
            body: JSON.stringify({
              operation: "cloud_image_generation",
              taskId,
              idempotencyKey: taskId,
              estimatedQuotaUnits: snapshot.estimatedQuotaUnitsPerImage,
              requestFingerprint,
            }),
          });
        } catch (error) {
          const text = error instanceof Error ? error.message : "额度预检失败。";
          setImageWorkspace((prev) => ({ ...prev, submitError: text, submitDiagnostic: diagnosticFromError(error) }));
          throw error;
        }

        const form = new FormData();
        form.set("providerId", snapshot.providerId);
        form.set("mode", snapshot.mode);
        form.set("ratio", snapshot.ratio);
        form.set("quality", snapshot.quality);
        form.set("prompt", snapshot.prompt);
        form.set("taskId", taskId);
        form.set("idempotencyKey", taskId);
        form.set("estimatedQuotaUnits", String(snapshot.estimatedQuotaUnitsPerImage));
        snapshot.files.forEach((file) => form.append("files", file));
        const data = await fetchJsonWithCsrf<{ item: LibraryItem }>("/api/generate/image", {
          method: "POST",
          body: form,
        });
        handleImageResult(data.item);
        updateImageGenerationProgress(progressId, (current) => ({
          ...current,
          current: index + 1,
          message: totalCount > 1 ? `已完成 ${index + 1} / ${totalCount} 张` : "图片已生成",
        }));
      }

      await refreshLibraryAfterMutation();
      await refreshAccountAfterGeneration();
      updateImageGenerationProgress(progressId, (current) => ({
        ...current,
        status: "done",
        current: totalCount,
        completedAt: Date.now(),
        message: totalCount > 1 ? `${totalCount} 张图片已生成` : "图片已生成",
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片生成失败。";
      setImageWorkspace((prev) => ({
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
      updateImageInFlightState(imageInFlightCountRef.current - 1);
    }
  }, [
    activeImageMode,
    handleImageResult,
    imageWorkspace.files,
    imageWorkspace.quality,
    imageWorkspace.ratio,
    imageWorkspace.prompt,
    imageGenerationCount,
    imageWorkspacePrompt,
    imageWorkspaceHasFiles,
    imageWorkspaceRequiresFile,
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
  });
  const videoGenerationCostLabel = formatQuotaSymbolLabel(videoEstimatedQuotaUnits);
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
      const data = await fetchJsonWithCsrf<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        body: JSON.stringify({
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
    if (imageUpscaleWorkspace.loading) return;

    updateImageUpscaleWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", currentFile.file);
      form.set("scale", imageUpscaleWorkspace.scale);
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/image", {
        method: "POST",
        body: form,
      });
      setOutputs((prev) => ({ ...prev, "image-upscale": { item: data.item, job: data.job, title: "图片高清增强结果", tool: "image-upscale" } }));
      await refreshLibraryAfterMutation();
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片高清增强处理失败。";
      updateImageUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
    } finally {
      updateImageUpscaleWorkspace({ loading: false });
    }
  }, [imageUpscaleWorkspace.availability?.ready, imageUpscaleWorkspace.file, imageUpscaleWorkspace.loading, imageUpscaleWorkspace.scale, refreshLibraryAfterMutation, setMessage, updateImageUpscaleWorkspace]);

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
    if (videoUpscaleWorkspace.loading || pendingJob) return;

    updateVideoUpscaleWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
      job: null,
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", currentFile.file);
      form.set("scale", videoUpscaleWorkspace.scale);
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/video", {
        method: "POST",
        body: form,
      });
      updateVideoUpscaleWorkspace({ job: data.job });
      setOutputs((prev) => ({ ...prev, "video-upscale": { item: data.item, job: data.job, title: "视频高清增强结果", tool: "video-upscale" } }));
      await refreshLibraryAfterMutation();
    } catch (error) {
      const text = error instanceof Error ? error.message : "视频高清增强处理失败。";
      updateVideoUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
      setMessage(text);
    } finally {
      updateVideoUpscaleWorkspace({ loading: false });
    }
  }, [
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
        await refreshLibraryAfterMutation();
      } catch (error) {
        const text = error instanceof Error ? error.message : "视频高清增强任务查询失败。";
        updateVideoUpscaleWorkspace({ submitError: text, submitDiagnostic: diagnosticFromError(error) });
        setMessage(text);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshLibraryAfterMutation, setMessage, updateVideoUpscaleWorkspace, videoUpscaleWorkspace.job]);

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
      files: videoWorkspace.files.map((attachment) => attachment.file),
      estimatedQuotaUnits: estimateVideoGenerationQuota({
        mode: activeVideoMode,
        durationSeconds: videoWorkspace.duration,
        referenceImages: videoWorkspace.files.length,
      }),
    };
    const requestFingerprint = generationBillingFingerprint({
      kind: "video",
      providerId: snapshot.providerId,
      mode: snapshot.mode,
      ratio: snapshot.ratio,
      durationSeconds: snapshot.duration,
      referenceImages: snapshot.files.length,
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
          state={imageWorkspace}
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
          promptOptimizeCostLabel={promptOptimizationCostLabel}
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
          promptOptimizeCostLabel={promptOptimizationCostLabel}
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

  return (
    <>
      <WorkbenchShell
        state={{ activeToolId: activeWorkspaceToolId }}
        onToolAction={handleToolAction}
        isAuthenticated={Boolean(sessionUser)}
        canAccessAdmin={sessionUser?.role === "admin"}
        accountName={sessionUser?.display_name || sessionUser?.username || null}
        accountPointsLabel={accountSummaryBusy ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} ✦` : "—"}
        headerRightSlot={accountHeaderSlot}
        accountCloseSignal={accountCloseSignal}
        onOpenAccountCenter={handleOpenAccountCenter}
        onOpenAccountRecharge={handleOpenRechargeCenter}
        accountSlot={(
          <WorkspaceAccountPanel
            user={sessionUser}
            quota={quotaSnapshot}
            loading={accountSummaryBusy}
            accountError={accountDataError}
            accountView={accountCenterOpen ? accountView : undefined}
            planStatus={accountPlanStatus}
            checkInStatus={accountCheckInStatus}
            onRefresh={() => void refreshAccountSnapshot()}
            onLogout={() => void handleLogout()}
            onOpenCenter={handleOpenAccountCenter}
            onOpenRecharge={handleOpenRechargeCenter}
            onCheckInUnavailable={handleCheckInUnavailable}
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
              usage={usagePage}
              loading={accountViewLoading}
              billingOrders={billingOrders}
              accountView={accountView}
              planStatus={accountPlanStatus}
              checkInStatus={accountCheckInStatus}
              onViewChange={setAccountView}
              onPaymentUnavailable={handlePaymentUnavailable}
              onCheckInUnavailable={handleCheckInUnavailable}
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
              removingItemId={removingLibraryItemId}
              missingMediaIds={missingLibraryMediaIds}
              deleteConfirmItem={libraryDeleteConfirmItem}
              onFilterChange={setLibraryFilter}
              onSortChange={setLibrarySort}
              onSearchChange={setLibrarySearch}
              onSelectItem={setSelectedLibraryItemId}
              onDelete={handleRequestDeleteLibraryItem}
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
                output={activeOutput}
                loading={imageWorkspace.loading}
                canSubmit={imageWorkspaceCanSubmit}
                submitError={imageWorkspace.submitError}
                submitDiagnostic={imageWorkspace.submitDiagnostic}
                isEditor={activeWorkspaceToolId === "image-editor"}
                promptFilled={Boolean(imageWorkspacePrompt)}
                hasProvider={Boolean(selectedImageProvider)}
                hasFiles={imageWorkspaceHasFiles}
                onSubmit={submitImageWorkspace}
                onReloadProviders={refreshProviders}
                onUpscale={sendResultToUpscale}
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
    </>
  );
}

function UserCenterWorkspace({
  user,
  quota,
  usage,
  loading,
  billingOrders,
  accountView,
  planStatus,
  checkInStatus,
  onViewChange,
  onPaymentUnavailable,
  onCheckInUnavailable,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  loading: boolean;
  billingOrders: BillingOrder[];
  accountView: AccountView;
  planStatus: PlanStatus;
  checkInStatus: CheckInStatus;
  onViewChange: (view: AccountView) => void;
  onPaymentUnavailable: (text?: string) => void;
  onCheckInUnavailable: () => void;
}) {
  if (accountView === "recharge") {
    return (
      <RechargeCenterWorkspace
        user={user}
        quota={quota}
        loading={loading}
        planStatus={planStatus}
        onViewChange={onViewChange}
        onPaymentUnavailable={onPaymentUnavailable}
      />
    );
  }

  if (accountView === "usage") {
    return (
      <UsageRecordsWorkspace
        usage={usage}
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
      usage={usage}
      loading={loading}
      planStatus={planStatus}
      checkInStatus={checkInStatus}
      onCheckInUnavailable={onCheckInUnavailable}
      onViewChange={onViewChange}
    />
  );
}

function UserCenterOverview({
  user,
  quota,
  usage,
  loading,
  planStatus,
  checkInStatus,
  onCheckInUnavailable,
  onViewChange,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  loading: boolean;
  planStatus: PlanStatus;
  checkInStatus: CheckInStatus;
  onCheckInUnavailable: () => void;
  onViewChange: (view: AccountView) => void;
}) {
  const usageEntries = usage?.entries?.slice(0, 6) || [];
  const quotaUnits = quota?.quota_units ?? null;
  const quotaValue = loading ? "加载中" : quota ? `${formatQuotaUnits(quota.quota_units)} ✦` : "—";
  const quotaNote = loading
    ? "正在同步真实账户积分。"
    : quota
      ? "积分用于图片和视频创作。"
      : "登录后将显示真实账户积分。";
  const planDisplay = getPlanStatusDisplay(planStatus);
  const checkInDisplay = getCheckInStatusDisplay(checkInStatus);
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
          <p>查看积分、套餐与签到信息</p>
        </div>
      </header>

      <div className="user-center-page__grid">
        <div className="user-center-page__main">
          <div className="user-center-account-summary">
            <article className={cn("user-center-points-card", quotaChanged && "is-updated")}>
              <span className="user-center-card-icon user-center-card-icon--primary">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <div className="user-center-points-card__copy">
                <span>当前可用积分</span>
                <strong className="user-center-points-card__value">{quotaValue}</strong>
                <p>{quotaNote}</p>
              </div>
              <div className="user-center-points-card__actions">
                <button type="button" className="user-center-action user-center-action--primary" onClick={() => onViewChange("recharge")} disabled={!user}>
                  <WalletCards className="size-4" aria-hidden="true" />
                  立即充值
                </button>
              </div>
              <div className="user-center-mobile-status">
                <div className="user-center-mobile-status__item">
                  <span>
                    <Crown className="size-3.5" aria-hidden="true" />
                    当前套餐
                  </span>
                  <strong>{planDisplay.label}</strong>
                  <button type="button" onClick={() => onViewChange("recharge")} disabled={!user}>
                    {planDisplay.actionLabel}
                  </button>
                </div>
                <div className="user-center-mobile-status__item">
                  <span>
                    <CalendarCheck className="size-3.5" aria-hidden="true" />
                    每日签到
                  </span>
                  <strong>{checkInDisplay.label}</strong>
                  <button
                    type="button"
                    onClick={checkInStatus === "unavailable" ? onCheckInUnavailable : undefined}
                    disabled={!user || (checkInStatus !== "unavailable" && checkInDisplay.actionDisabled)}
                  >
                    {checkInDisplay.actionLabel}
                  </button>
                </div>
              </div>
            </article>

            <div className="user-center-side-cards">
              <article className="user-center-mini-card">
                <span className="user-center-card-icon">
                  <Crown className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <span>当前套餐</span>
                  <strong>{planDisplay.label}</strong>
                  <p>{planDisplay.note}</p>
                </div>
                <button
                  type="button"
                  className="user-center-mini-card__action"
                  onClick={() => onViewChange("recharge")}
                  disabled={!user}
                >
                  {planDisplay.actionLabel}
                </button>
              </article>

              <article className="user-center-mini-card">
                <span className="user-center-card-icon">
                  <CalendarCheck className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <span>每日签到</span>
                  <strong>{checkInDisplay.label}</strong>
                  <p>{checkInDisplay.note}</p>
                </div>
                <button
                  type="button"
                  className="user-center-mini-card__action"
                  onClick={checkInStatus === "unavailable" ? onCheckInUnavailable : undefined}
                  disabled={!user || (checkInStatus !== "unavailable" && checkInDisplay.actionDisabled)}
                >
                  {checkInDisplay.actionLabel}
                </button>
              </article>
            </div>
          </div>

          <section className="user-center-usage">
            <div className="user-center-section-head">
              <div>
                <h3>最近使用记录</h3>
                <p>仅展示最近的真实使用记录。</p>
              </div>
              <button type="button" className="user-center-link-button" onClick={() => onViewChange("usage")}>
                查看全部记录
              </button>
            </div>

            {loading && !usageEntries.length ? (
              <div className="user-center-usage__list">
                <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
                  <span>时间</span>
                  <span>功能</span>
                  <span>积分变动</span>
                  <span>描述</span>
                </div>
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="user-center-usage__row user-center-usage__row--skeleton" aria-hidden="true">
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                    <span className="motion-skeleton-shimmer" />
                  </div>
                ))}
              </div>
            ) : usageEntries.length ? (
              <div className="user-center-usage__list">
                <div className="user-center-usage__row user-center-usage__row--head" aria-hidden="true">
                  <span>时间</span>
                  <span>功能</span>
                  <span>积分变动</span>
                  <span>描述</span>
                </div>
                {usageEntries.map((entry, index) => (
                  <div key={entry.id} className="user-center-usage__row" style={{ "--usage-row-delay": `${index < 6 ? index * 24 : 0}ms` } as CSSProperties}>
                    <span>{formatUsageDate(entry.created_at)}</span>
                    <strong>{usageOperationLabel(entry.operation)}</strong>
                    <em>-{formatQuotaUnits(entry.actual_quota_units ?? entry.estimated_quota_units)} 分</em>
                    <span>{usageDescription(entry)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="user-center-usage__empty">
                <History className="size-5" aria-hidden="true" />
                <strong>暂无使用记录</strong>
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
  loading,
  planStatus,
  onViewChange,
  onPaymentUnavailable,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  loading: boolean;
  planStatus: PlanStatus;
  onViewChange: (view: AccountView) => void;
  onPaymentUnavailable: (text?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<RechargeTab>("plans");
  const [selectedPlanId, setSelectedPlanId] = useState("standard");
  const [selectedCreditAmount, setSelectedCreditAmount] = useState<number | null>(50);
  const [customAmount, setCustomAmount] = useState("");
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
  const customCredits = customAmountValid ? calculateCustomRechargeCredits(customAmountValue) : 0;
  const customRechargeActive = activeTab === "credits" && customAmount.trim() !== "";
  const customAmountError = customAmountEntered && !customAmountValid
    ? `最低充值金额 ¥${CUSTOM_RECHARGE_MIN_AMOUNT}`
    : "";
  const customAmountHelpId = "custom-recharge-help";
  const customAmountErrorId = "custom-recharge-error";
  const pointsStatusLabel = quota ? `${formatQuotaUnits(quota.quota_units)} ✦` : "—";
  const planStatusLabel = getPlanStatusDisplay(planStatus).label;
  const creditSummaryLines = customRechargeActive
    ? createCustomCreditSummaryLines(customAmount, customAmountValid, customCredits)
    : createFixedCreditSummaryLines(selectedCredit);
  const creditSummaryReady = customRechargeActive ? customAmountValid : Boolean(selectedCredit);
  const creditPayableAmount = customRechargeActive && customAmountValid
    ? customAmount
    : selectedCredit?.amount ?? "";
  const creditPayableMinorAmount = creditPayableAmount === "" ? Number.NaN : rechargeAmountToMinor(creditPayableAmount);
  const creditAmountAllowed = selectedPaymentChannelConfig
    ? paymentChannelAllowsAmount(selectedPaymentChannelConfig, creditPayableMinorAmount)
    : false;
  const planSummaryLines = createPlanSummaryLines(selectedPlan);
  const planSummaryReady = Boolean(selectedPlan);
  const planConfirmState = createRechargeConfirmState({
    mode: "plans",
    user,
    ready: planSummaryReady,
    selectedPlan,
  });
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
  const paymentUnavailableNote = "套餐支付暂未开放，当前先支持积分充值。";
  const creditPaymentNote = paymentError
    || (latestPayment
      ? `订单 ${latestPayment.order.status}，如未自动跳转请使用返回的支付链接继续付款。`
      : selectedPaymentChannelConfig
        ? "将跳转到 Z-Pay 支付宝收银台，支付成功后积分自动到账。"
        : paymentConfigLoading
          ? "正在读取支付通道配置。"
          : "生产支付通道未配置，暂时无法创建支付订单。");

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

  const handleCreditPayment = useCallback(async () => {
    if (!user || !selectedPaymentChannelConfig || !creditSummaryReady || !creditAmountAllowed || paymentSubmitting) return;
    setPaymentSubmitting(true);
    setPaymentError("");
    setLatestPayment(null);
    try {
      const result = await fetchJsonWithCsrf<CreateBillingOrderResponse>("/api/billing/orders", {
        method: "POST",
        body: JSON.stringify({
          channel: selectedPaymentChannelConfig.channel,
          currency: "CNY",
          requestedAmount: creditPayableMinorAmount,
          idempotencyKey: createTaskId("billing-order"),
        }),
      });
      setLatestPayment(result);
      const checkoutUrl = result.payment.checkout_url || result.payment.qrcode_url || result.payment.qrcode_image_url;
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setPaymentError("支付订单已创建，但 Z-Pay 未返回可跳转的支付链接。");
    } catch (error) {
      setPaymentError(error instanceof ApiError ? error.message : "创建支付订单失败");
    } finally {
      setPaymentSubmitting(false);
    }
  }, [
    creditAmountAllowed,
    creditPayableMinorAmount,
    creditSummaryReady,
    paymentSubmitting,
    selectedPaymentChannelConfig,
    user,
  ]);

  return (
    <section className="user-center-page account-subpage account-subpage--recharge" aria-label="充值中心">
      <AccountSubpageHeader
        breadcrumb="用户中心 / 充值中心"
        title="充值中心"
        subtitle="选择适合当前创作节奏的套餐或积分充值方式，先核对订单信息，支付开放后再继续。"
        onBack={() => onViewChange("center")}
        meta={(
          <div className="recharge-account-meta" aria-label="账户概览">
            <span className="recharge-account-meta__item">
              <span>当前积分</span>
              {loading && !quota ? (
                <i className="recharge-account-meta__skeleton motion-skeleton-shimmer" aria-label="积分加载中" />
              ) : (
                <strong>{pointsStatusLabel}</strong>
              )}
            </span>
            <span className="recharge-account-meta__item">
              <span>当前套餐</span>
              {planStatus.status === "loading" ? (
                <i className="recharge-account-meta__skeleton motion-skeleton-shimmer" aria-label="套餐加载中" />
              ) : (
                <strong>{planStatusLabel}</strong>
              )}
            </span>
          </div>
        )}
        actions={(
          <div className="recharge-header-actions">
            <button type="button" className="recharge-header-action" onClick={() => onPaymentUnavailable("帮助入口暂未开放")}>
              <ExternalLink className="size-4" aria-hidden="true" />
              帮助
            </button>
          </div>
        )}
      />

      <div className="recharge-center-shell">
        <div className="recharge-center-tabs" role="tablist" aria-label="充值类型">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "plans"}
            className={cn("recharge-center-tab", activeTab === "plans" && "is-active")}
            onClick={() => setActiveTab("plans")}
          >
            套餐购买
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "credits"}
            className={cn("recharge-center-tab", activeTab === "credits" && "is-active")}
            onClick={() => setActiveTab("credits")}
          >
            积分充值
          </button>
        </div>

        <div className="recharge-layout">
          <div className="recharge-layout__selection">
            {activeTab === "plans" ? (
              <div className="recharge-center-panel" role="tabpanel">
                <div className="recharge-selection-head">
                  <h3>选择适合你的套餐</h3>
                  <p>套餐按月展示，每档仅包含当前支持的月度积分额度。</p>
                </div>
                {planOptions.length > 0 ? (
                  <div className="recharge-plan-grid">
                    {planOptions.map((plan) => {
                      const selected = selectedPlan?.id === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={cn("recharge-plan-card", plan.recommended && "is-recommended", selected && "is-selected")}
                          onClick={() => setSelectedPlanId(plan.id)}
                          aria-pressed={selected}
                        >
                          <span className="recharge-card-check" aria-hidden="true">
                            <Check className="size-3.5" />
                          </span>
                          <span className="recharge-plan-card__top">
                            <span className="recharge-plan-card__scene">{plan.description}</span>
                            {plan.recommended ? <span className="recharge-card-badge">推荐</span> : null}
                          </span>
                          <span className="recharge-plan-card__name">{plan.name}</span>
                          <span className="recharge-plan-card__price">¥{plan.price} <small>/ {PLAN_PERIOD_UNIT_LABEL}</small></span>
                          <span className="recharge-plan-card__credits">每月 {formatQuotaUnits(plan.monthlyCredits)} 积分</span>
                          <span className="recharge-plan-card__facts" role="list" aria-label={`${plan.name}套餐信息`}>
                            {createPlanFactItems(plan).map((item) => (
                              <span key={item} role="listitem">
                                <Check className="size-3.5" aria-hidden="true" />
                                <span>{item}</span>
                              </span>
                            ))}
                          </span>
                          <span className="recharge-plan-card__action">{selected ? "已选择" : "选择套餐"}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="recharge-plan-empty" role="status">
                    <Crown className="size-5" aria-hidden="true" />
                    <strong>暂无可购买套餐</strong>
                    <span>当前暂未返回可购买的套餐配置。</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="recharge-center-panel" role="tabpanel">
                <div className="recharge-selection-head">
                  <h3>选择充值金额</h3>
                  <p>充值成功后，积分将发放至当前账户。</p>
                </div>
                <div className="credit-topup-grid">
                  {creditTopUpOptions.map((option) => {
                    const selected = !customRechargeActive && selectedCredit?.amount === option.amount;
                    const giftCredits = getCreditTopUpGift(option);
                    const badge = getCreditTopUpBadge(option, creditTopUpOptions);
                    return (
                      <button
                        key={option.amount}
                        type="button"
                        className={cn("credit-topup-card", selected && "is-selected")}
                        onClick={() => {
                          setSelectedCreditAmount(option.amount);
                          setCustomAmount("");
                        }}
                        aria-pressed={selected}
                      >
                        <span className="recharge-card-check" aria-hidden="true">
                          <Check className="size-3.5" />
                        </span>
                        <span className="credit-topup-card__headline">
                          <strong className="credit-topup-card__amount">¥{formatRechargeAmount(option.amount)}</strong>
                          {badge ? <span className="recharge-card-badge">{badge}</span> : null}
                        </span>
                        <span className="credit-topup-card__credits">到账 {formatQuotaUnits(option.credits)} 积分</span>
                        {giftCredits > 0 ? (
                          <span className="credit-topup-card__gift">含赠送 {formatQuotaUnits(giftCredits)} 积分</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className={cn("custom-recharge-card", customRechargeActive && "is-active")}>
                  <div className="custom-recharge-card__intro">
                    <h3>自定义充值</h3>
                    <p>最低金额 ¥{CUSTOM_RECHARGE_MIN_AMOUNT}，换算比例 1 元 = {CREDIT_TOP_UP_BASE_RATE} 积分。</p>
                  </div>
                  <label className="custom-recharge-field">
                    <span>充值金额</span>
                    <span className={cn("custom-recharge-input", customAmountError && "is-invalid")}>
                      <em aria-hidden="true">¥</em>
                      <input
                        value={customAmount}
                        inputMode="decimal"
                        placeholder="输入金额"
                        onChange={(event) => {
                          setCustomAmount(sanitizeRechargeAmount(event.target.value));
                          setSelectedCreditAmount(null);
                        }}
                        aria-describedby={customAmountError ? `${customAmountHelpId} ${customAmountErrorId}` : customAmountHelpId}
                        aria-invalid={customAmountError ? "true" : "false"}
                      />
                    </span>
                    {customAmountError ? <small id={customAmountErrorId}>{customAmountError}</small> : null}
                  </label>
                  <div id="custom-recharge-help" className="custom-recharge-preview">
                    <span>预计到账</span>
                    <strong>{customAmountValid ? formatQuotaUnits(customCredits) : "—"}</strong>
                    <em>积分</em>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="recharge-layout__summary" aria-label="订单摘要">
            {activeTab === "plans" ? (
              <RechargeConfirmPanel
                icon={<Crown className="size-4" aria-hidden="true" />}
                title="订单确认"
                lines={planSummaryLines}
                note={paymentUnavailableNote}
                buttonLabel={planConfirmState.label}
                disabled={planConfirmState.disabled}
                onConfirm={onPaymentUnavailable}
              />
            ) : (
              <RechargeConfirmPanel
                icon={<CreditCard className="size-4" aria-hidden="true" />}
                title="订单确认"
                lines={creditSummaryLines}
                note={creditPaymentNote}
                buttonLabel={creditConfirmState.label}
                disabled={creditConfirmState.disabled}
                onConfirm={handleCreditPayment}
              />
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function UsageRecordsWorkspace({
  usage,
  billingOrders,
  loading,
  onViewChange,
}: {
  usage: UsagePage | null;
  billingOrders: BillingOrder[];
  loading: boolean;
  onViewChange: (view: AccountView) => void;
}) {
  const [filter, setFilter] = useState<AccountUsageFilter>("all");
  const records = useMemo(() => createAccountRecords(usage?.entries || [], billingOrders), [billingOrders, usage?.entries]);
  const filteredRecords = filter === "all" ? records : records.filter((record) => record.kind === filter);

  return (
    <section className="user-center-page account-subpage account-subpage--usage" aria-label="消费记录">
      <AccountSubpageHeader
        breadcrumb="用户中心 / 消费记录"
        title="消费记录"
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
              <span>描述</span>
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="user-center-usage__row user-center-usage__row--skeleton" aria-hidden="true">
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
                <em>{formatSignedQuota(record.quotaDelta)} 分</em>
                <span>{record.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="user-center-usage__empty">
            <History className="size-5" aria-hidden="true" />
            <strong>暂无消费记录</strong>
            <span>充值、签到或使用创作工具后，相关记录会显示在这里。</span>
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
  subtitle: string;
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
          <p>{subtitle}</p>
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
}: {
  icon: React.ReactNode;
  title: string;
  lines: Array<[string, string]>;
  note?: string;
  buttonLabel: string;
  disabled: boolean;
  onConfirm: (text?: string) => void;
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
      <button type="button" className="recharge-confirm-button" onClick={() => onConfirm()} disabled={disabled}>
        {buttonLabel}
      </button>
    </section>
  );
}

function createAccountRecords(usageEntries: UsageLogEntry[], billingOrders: BillingOrder[]) {
  const usageRecords: AccountRecord[] = usageEntries.map((entry) => ({
    id: `usage-${entry.id}`,
    createdAt: entry.created_at,
    kind: "spend",
    typeLabel: "支出",
    quotaDelta: -Math.abs(entry.actual_quota_units ?? entry.estimated_quota_units),
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
      description: `充值订单已到账，金额 ${formatMinorCurrency(order.paid_amount || order.requested_amount)}`,
    }));

  return [...usageRecords, ...paidOrders].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
}

function getCreditTopUpGift(option: CreditTopUpOption) {
  return Math.max(0, option.credits - option.amount * CREDIT_TOP_UP_BASE_RATE);
}

function getCreditTopUpRate(option: CreditTopUpOption) {
  if (option.amount <= 0) return 0;
  return option.credits / option.amount;
}

function getCreditTopUpBadge(option: CreditTopUpOption, options: CreditTopUpOption[]) {
  if (option.label === "体验充值") return "体验充值";
  if (option.label === "推荐") return "推荐";

  const bestRate = Math.max(...options.map(getCreditTopUpRate));
  if (getCreditTopUpGift(option) > 0 && getCreditTopUpRate(option) === bestRate) return "最划算";

  return "";
}

function calculateCustomRechargeCredits(amount: number) {
  return Math.floor(amount * CREDIT_TOP_UP_BASE_RATE);
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

function createPlanFactItems(plan: PlanOption) {
  return [
    `${PLAN_PERIOD_LABEL}购买`,
    `每月获得 ${formatQuotaUnits(plan.monthlyCredits)} 积分`,
  ];
}

function createPlanSummaryLines(plan: PlanOption | null): Array<[string, string]> {
  if (!plan) {
    return [
      ["当前选择", "未选择"],
      ["套餐周期", "—"],
      ["每月积分", "请选择套餐"],
      ["应付金额", "—"],
    ];
  }

  return [
    ["当前选择", plan.name],
    ["套餐周期", PLAN_PERIOD_LABEL],
    ["每月积分", `${formatQuotaUnits(plan.monthlyCredits)} 积分`],
    ["套餐金额", `¥${formatRechargeAmount(plan.price)}`],
    ["应付金额", `¥${formatRechargeAmount(plan.price)}`],
  ];
}

function createFixedCreditSummaryLines(option: CreditTopUpOption | null): Array<[string, string]> {
  if (!option) {
    return [
      ["当前选择", "未选择"],
      ["充值金额", "—"],
      ["预计到账", "请选择充值档位或输入自定义金额"],
      ["应付金额", "—"],
    ];
  }

  const giftCredits = getCreditTopUpGift(option);
  const baseCredits = option.amount * CREDIT_TOP_UP_BASE_RATE;
  const lines: Array<[string, string]> = [
    ["当前选择", `¥${formatRechargeAmount(option.amount)} 积分档位`],
    ["充值金额", `¥${formatRechargeAmount(option.amount)}`],
    ["基础积分", `${formatQuotaUnits(baseCredits)} 积分`],
  ];

  if (giftCredits > 0) {
    lines.push(["赠送积分", `${formatQuotaUnits(giftCredits)} 积分`]);
  }

  lines.push(["预计到账", `${formatQuotaUnits(option.credits)} 积分`]);
  lines.push(["应付金额", `¥${formatRechargeAmount(option.amount)}`]);
  return lines;
}

function createCustomCreditSummaryLines(amountText: string, valid: boolean, credits: number): Array<[string, string]> {
  const amount = amountText.trim();
  return [
    ["当前选择", "自定义充值"],
    ["充值金额", valid ? `¥${formatRechargeAmount(amount)}` : "未完成"],
    ["基础积分", valid ? `${formatQuotaUnits(credits)} 积分` : "—"],
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
    return { disabled: true, label: input.mode === "plans" ? "请选择套餐" : "请选择充值金额" };
  }

  if (!input.user) return { disabled: true, label: "登录后继续" };
  if (input.mode === "plans") return { disabled: true, label: "套餐支付暂未开放" };
  if (input.paymentConfigLoading) return { disabled: true, label: "支付配置加载中" };
  if (input.paymentSubmitting) return { disabled: true, label: "正在创建订单" };
  if (!input.paymentChannelReady) return { disabled: true, label: "支付通道未配置" };
  if (!input.paymentAmountAllowed) return { disabled: true, label: "金额不符合支付规则" };

  if (input.mode === "credits" && input.amount !== undefined && input.amount !== "") {
    return { disabled: false, label: `立即充值 ¥${formatRechargeAmount(input.amount)}` };
  }

  return { disabled: true, label: "请选择充值金额" };
}

function formatSignedQuota(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatQuotaUnits(value)}`;
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
    cloud_image_generation: "AI 图像生成器",
    cloud_video_generation: "AI 视频生成器",
    cloud_image_upscale: "图片高清增强",
    cloud_video_upscale: "视频高清增强",
  };
  return labels[operation] || "AI 工具";
}

function usageDescription(entry: UsageLogEntry) {
  const descriptions: Record<UsageLogEntry["operation"], string> = {
    cloud_image_generation: "生成图片",
    cloud_video_generation: "生成视频",
    cloud_image_upscale: "图片高清增强处理",
    cloud_video_upscale: "视频高清增强处理",
  };
  if (entry.status === "failed") return `${descriptions[entry.operation] || "工具处理"}失败`;
  if (entry.status === "refunded") return `${descriptions[entry.operation] || "工具处理"}已退回额度`;
  return descriptions[entry.operation] || "工具处理";
}
