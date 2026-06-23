"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowDownUp, ArrowLeft, CalendarCheck, Check, ChevronDown, Crown, CreditCard, Download, ExternalLink, Eye, History, ImageUp, Loader2, Play, ReceiptText, RefreshCw, Search, Sparkles, Trash2, UploadCloud, WalletCards, Wand2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { BeforeAfterImageCompare } from "@/components/before-after-image-compare";
import { ResultReveal } from "@/components/motion";
import { WorkbenchShell } from "@/components/workbench-shell";
import { TemplateRail } from "@/components/template-center";
import { WorkspaceAccountPanel } from "@/components/workspace-account-panel";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import {
  estimateImageGenerationQuota,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
} from "@/lib/generation-quota";
import {
  featuredImagePromptTemplates,
  featuredVideoPromptTemplates,
  templateById,
  templateTabHref,
} from "@/lib/template-catalog";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder } from "@/lib/server/billing";
import type { UsageLogEntry, QuotaSnapshot, UsagePage } from "@/lib/server/quota";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { FrontendProvider, JobRecord, LibraryItem } from "@/lib/server/types";
import {
  type WorkspaceAction,
  type WorkspaceImageMode,
  type WorkspaceToolId,
  type WorkspaceVideoMode,
  workspaceToolById,
  workspaceToolEntries,
} from "@/lib/workspace-registry";

type BusinessToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";
type LibraryFilter = "image" | "video";
type LibrarySort = "recent" | "title";
type UpscaleKind = "image" | "video";
type UpscaleAvailability = { ready: boolean; detail: string };
type UpscaleStatusResponse = Record<UpscaleKind, UpscaleAvailability>;

type EnabledProviders = {
  image: FrontendProvider[];
  video: FrontendProvider[];
};

type WorkspaceVideoOptions = {
  durations?: number[];
  ratios?: string[];
};

type WorkspacePublicProvider = FrontendProvider & {
  videoOptions?: WorkspaceVideoOptions;
};

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
const PAYMENT_FLOW_AVAILABLE: boolean = false;

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

type OutputState = {
  item: LibraryItem;
  job?: JobRecord | null;
  title: string;
  tool: BusinessToolId;
} | null;

type MobileActionState = {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
} | null;

type ImageWorkspaceFile = {
  file: File;
  previewUrl: string;
};

type UploadFilePreview = {
  name: string;
  size: number;
  previewUrl?: string;
  mediaType?: "image" | "video";
};

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ImageWorkspaceState = {
  providerId: string;
  ratio: string;
  quality: string;
  count: number;
  templateId: string;
  prompt: string;
  promptOptimizing: boolean;
  promptOptimizeError: string;
  promptOptimizeUndo: string;
  files: ImageWorkspaceFile[];
  fileError: string;
  submitError: string;
  loading: boolean;
};

type VideoWorkspaceFile = {
  file: File;
  previewUrl: string;
};

type VideoWorkspaceState = {
  providerId: string;
  ratio: string;
  duration: number;
  templateId: string;
  prompt: string;
  promptOptimizing: boolean;
  promptOptimizeError: string;
  promptOptimizeUndo: string;
  files: VideoWorkspaceFile[];
  fileError: string;
  submitError: string;
  loading: boolean;
  job: JobRecord | null;
};

type ImageGenerationProgressState = {
  status: "running" | "done" | "failed";
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  message?: string;
} | null;

type ImageUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
};

type VideoUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
};

type ImageUpscaleWorkspaceState = {
  scale: "2" | "4";
  file: ImageUpscaleWorkspaceFile | null;
  fileError: string;
  submitError: string;
  loading: boolean;
  statusLoading: boolean;
  checked: boolean;
  availability: UpscaleAvailability | null;
  statusError: string;
};

type VideoUpscaleWorkspaceState = {
  scale: "2" | "4";
  file: VideoUpscaleWorkspaceFile | null;
  fileError: string;
  submitError: string;
  loading: boolean;
  statusLoading: boolean;
  checked: boolean;
  availability: UpscaleAvailability | null;
  statusError: string;
  job: JobRecord | null;
};

const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const defaultVideoDurations = [5, 8, 10, 15];
const grokVideoDurations = [4, 6, 8, 10, 12, 15];
const grokVideo10Ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const grokVideo15Ratios = ["16:9", "9:16"];
const jimengVideoRatios = ["16:9", "9:16", "1:1"];
const upscaleUnavailableMessage = "高清处理暂时不可用，请稍后重试";
const promptOptimizationTargetPlatform = "TikTok Shop";

const imageWorkspaceModeMeta: Record<WorkspaceImageMode, {
  title: string;
  subtitle: string;
  submitLabel: string;
  loadingLabel: string;
  promptPlaceholder: string;
  guideTitle: string;
  guideDescription: string;
  guideNotes: string[];
}> = {
  "text-to-image": {
    title: "AI 图像生成器",
    subtitle: "描述画面，可选图像。",
    submitLabel: "生成图片",
    loadingLabel: "正在生成",
    promptPlaceholder: "描述你要生成的画面、风格、主体和氛围。",
    guideTitle: "准备开始生成",
    guideDescription: "描述你想生成的画面。",
    guideNotes: ["选择模型", "填写提示词", "生成后可下载或放大"],
  },
  "image-to-image": {
    title: "AI 图片编辑器",
    subtitle: "上传图像并描述修改要求。",
    submitLabel: "开始编辑",
    loadingLabel: "正在编辑",
    promptPlaceholder: "描述你要如何修改这张图像，保留哪些元素、替换哪些内容。",
    guideTitle: "准备开始编辑",
    guideDescription: "描述希望如何修改图像。",
    guideNotes: ["上传图像", "写清修改要求", "生成后可下载或放大"],
  },
};

const allowedReferenceImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedUpscaleVideoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const maxReferenceImageSize = 10 * 1024 * 1024;
const maxReferenceImageCount = 10;
const maxVideoFirstFrameCount = 1;
const maxImageUpscaleSize = 25 * 1024 * 1024;
const maxVideoUpscaleSize = 1024 * 1024 * 1024;

const videoWorkspaceModeMeta: Record<WorkspaceVideoMode, {
  submitLabel: string;
  loadingLabel: string;
  uploadLabel: string;
  uploadRequired: boolean;
  uploadEmptyTitle: string;
  uploadFilledTitle: string;
  uploadHelpText: string;
  promptLabel: string;
  promptPlaceholder: string;
  guideDescription: string;
  guideEmpty: string;
  guideReady: string;
  guideNotes: string[];
}> = {
  "text-to-video": {
    submitLabel: "生成视频",
    loadingLabel: "正在生成视频",
    uploadLabel: "图像",
    uploadRequired: false,
    uploadEmptyTitle: "上传图像",
    uploadFilledTitle: "已选择图像",
    uploadHelpText: "支持 JPG、PNG、WEBP",
    promptLabel: "提示词",
    promptPlaceholder: "描述主体、动作、场景、镜头、运镜、光线和氛围。例如：雨夜霓虹街道，低机位缓慢推进，人物回头看向镜头。",
    guideDescription: "描述你想生成的视频画面、动作和镜头。",
    guideEmpty: "描述你想生成的视频画面、动作和镜头，真实视频结果会显示在这里。",
    guideReady: "提示词已填写，可以提交真实视频任务。",
    guideNotes: ["选择视频模型", "描述画面动作和镜头", "生成后可下载或放大"],
  },
  "image-to-video": {
    submitLabel: "生成视频",
    loadingLabel: "正在生成视频",
    uploadLabel: "图像",
    uploadRequired: true,
    uploadEmptyTitle: "上传图像",
    uploadFilledTitle: "已选择图像",
    uploadHelpText: "支持 JPG、PNG、WEBP",
    promptLabel: "提示词",
    promptPlaceholder: "描述图像中的主体如何运动、镜头如何推进/拉远/环绕、背景如何变化，以及哪些元素必须保持一致。",
    guideDescription: "上传图像，再描述希望画面如何运动。",
    guideEmpty: "先上传图像，再补充提示词。这里不会用假视频冒充结果。",
    guideReady: "图像已准备好，补充提示词后可以提交真实视频任务。",
    guideNotes: ["上传图像", "描述运动和镜头变化", "生成后可下载或放大"],
  },
};

function createImageWorkspaceFiles(files: File[]) {
  const nextFiles = files.slice(0, maxReferenceImageCount);
  if (files.length > maxReferenceImageCount) {
    throw new Error(`最多上传 ${maxReferenceImageCount} 张图像。`);
  }
  for (const file of nextFiles) {
    if (!allowedReferenceImageTypes.has(file.type)) {
      throw new Error("图像仅支持 PNG、JPEG 和 WebP。");
    }
    if (file.size > maxReferenceImageSize) {
      throw new Error("单张图像不能超过 10MB。");
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
  if (file.size > maxReferenceImageSize) {
    throw new Error("图像不能超过 10MB。");
  }
  return [{
    file,
    previewUrl: URL.createObjectURL(file),
  }];
}

function createImageUpscaleFile(files: File[]) {
  if (files.length > 1) {
    throw new Error("图片高清一次只能上传 1 张图片。");
  }
  const [file] = files;
  if (!file) return null;
  if (!allowedReferenceImageTypes.has(file.type)) {
    throw new Error("图片高清仅支持 PNG、JPEG 和 WebP。");
  }
  if (file.size > maxImageUpscaleSize) {
    throw new Error("图片高清文件不能超过 25MB。");
  }
  return {
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function createVideoUpscaleFile(files: File[]) {
  if (files.length > 1) {
    throw new Error("视频高清一次只能上传 1 个视频。");
  }
  const [file] = files;
  if (!file) return null;
  if (!allowedUpscaleVideoTypes.has(file.type)) {
    throw new Error("视频高清仅支持 MP4、WebM 和 MOV。");
  }
  if (file.size > maxVideoUpscaleSize) {
    throw new Error("视频高清文件不能超过 1GB。");
  }
  return {
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(url, options);
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

async function fileFromLibraryOutput(item: LibraryItem, fallbackExtension: string) {
  const output = item.output;
  if (!output?.url) throw new Error("结果文件暂不可用。");

  const response = await fetch(output.url);
  if (!response.ok) throw new Error("结果文件读取失败。");

  const blob = await response.blob();
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

const videoModelReferenceMessage = "当前模型需要上传 1 张图像。";

const ratioShapeClass: Record<string, string> = {
  "1:1": "ratio-1-1",
  "16:9": "ratio-16-9",
  "9:16": "ratio-9-16",
  "4:3": "ratio-4-3",
  "3:4": "ratio-3-4",
  "3:2": "ratio-3-2",
  "2:3": "ratio-2-3",
};

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
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [sessionUser, setSessionUser] = useState<PublicAuthUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [quotaSnapshot, setQuotaSnapshot] = useState<QuotaSnapshot | null>(null);
  const [usagePage, setUsagePage] = useState<UsagePage | null>(null);
  const [billingOrders, setBillingOrders] = useState<BillingOrder[]>([]);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountDataError, setAccountDataError] = useState("");
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView>("center");
  const [accountCloseSignal, setAccountCloseSignal] = useState(0);
  const [message, setMessage] = useState("");
  const [imageGenerationProgress, setImageGenerationProgress] = useState<ImageGenerationProgressState>(null);
  const [generationProgressTick, setGenerationProgressTick] = useState(() => Date.now());
  const [outputs, setOutputs] = useState<Partial<Record<BusinessToolId, OutputState>>>({});
  const [mobileAction, setMobileAction] = useState<MobileActionState>(null);
  const [mobilePreviewSignal, setMobilePreviewSignal] = useState(0);
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
    loading: false,
    job: null,
  });
  const [imageUpscaleWorkspace, setImageUpscaleWorkspace] = useState<ImageUpscaleWorkspaceState>({
    scale: "2",
    file: null,
    fileError: "",
    submitError: "",
    loading: false,
    statusLoading: true,
    checked: false,
    availability: null,
    statusError: "",
  });
  const [videoUpscaleWorkspace, setVideoUpscaleWorkspace] = useState<VideoUpscaleWorkspaceState>({
    scale: "2",
    file: null,
    fileError: "",
    submitError: "",
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

  const refreshAccountData = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setQuotaSnapshot(null);
      setUsagePage(null);
      setBillingOrders([]);
      setAccountDataError("");
      setAccountLoading(false);
      return;
    }

    setAccountLoading(true);
    try {
      const [quotaResult, usageResult, ordersResult] = await Promise.allSettled([
        fetchJson<{ ok: true; quota: QuotaSnapshot }>("/api/quota"),
        fetchJson<{ ok: true; usage: UsagePage }>("/api/usage?page=1&pageSize=10"),
        fetchJson<BillingOrdersResponse>("/api/billing/orders?page=1&pageSize=8"),
      ]);

      if (quotaResult.status === "fulfilled") {
        setQuotaSnapshot(quotaResult.value.quota);
      } else {
        setQuotaSnapshot(null);
      }

      if (usageResult.status === "fulfilled") {
        setUsagePage(usageResult.value.usage);
      } else {
        setUsagePage(null);
      }

      if (ordersResult.status === "fulfilled") {
        setBillingOrders(ordersResult.value.orders);
      } else {
        setBillingOrders([]);
      }

      const failures = [quotaResult, usageResult, ordersResult].filter((result) => result.status === "rejected");
      if (failures.length) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[account] Failed to load account data", failures);
        }
        setAccountDataError(formatAccountDataError(failures[0]));
      } else {
        setAccountDataError("");
      }
    } finally {
      setAccountLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    if (!sessionUser) return;
    try {
      await fetchJsonWithCsrf("/api/auth/logout", { method: "POST" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败。");
    } finally {
      setSessionUser(null);
      setQuotaSnapshot(null);
      setUsagePage(null);
      setBillingOrders([]);
      router.replace("/login");
    }
  }, [router, sessionUser]);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError("");
    try {
      const result = await fetchJson<AuthSessionResponse>("/api/auth/session");
      if ("ok" in result && result.ok) {
        setSessionUser(result.user);
        await refreshAccountData(result.user.local_user_id);
        return;
      }
      setSessionUser(null);
      setQuotaSnapshot(null);
      setUsagePage(null);
      setBillingOrders([]);
      setAccountDataError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSessionUser(null);
        setQuotaSnapshot(null);
        setUsagePage(null);
        setBillingOrders([]);
        setAccountDataError("");
      } else {
        const text = error instanceof Error ? error.message : "会话加载失败。";
        setSessionError(text);
        setMessage(text);
      }
    } finally {
      setSessionLoading(false);
    }
  }, [refreshAccountData]);

  const refreshAccountSnapshot = useCallback(async () => {
    await refreshSession();
  }, [refreshSession]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const data = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
      setLibrary(data.items);
      setMissingLibraryMediaIds(new Set());
    } catch (error) {
      const text = error instanceof Error ? error.message : "作品库加载失败。";
      setLibraryError(text);
      throw error;
    } finally {
      setLibraryLoading(false);
    }
  }, []);

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
        setLibraryLoading(true);
        const [providersData, libraryData] = await Promise.all([
          jsonFetch<{ providers: EnabledProviders }>("/api/providers/enabled"),
          jsonFetch<{ items: LibraryItem[] }>("/api/library"),
        ]);
        if (cancelled) return;
        setProviders(providersData.providers);
        setLibrary(libraryData.items);
        setProvidersError("");
        setLibraryError("");
      } catch (error) {
        if (!cancelled) {
          const text = error instanceof Error ? error.message : "加载失败。";
          setProvidersError(text);
          setLibraryError(text);
          setMessage(text);
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
          setLibraryLoading(false);
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
      return { ...prev, providerId: nextProviders[0].id, submitError: "" };
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
      setImageWorkspace((prev) => ({ ...prev, submitError: "", fileError: "" }));
    }

    const nextVideoMode = action.mode === "text-to-video" || action.mode === "image-to-video" ? action.mode : null;
    if (action.toolId === "video" && nextVideoMode) {
      setVideoWorkspace((prev) => ({ ...prev, fileError: "", submitError: "" }));
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
      await refreshLibrary();
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除失败。";
      setLibraryError(text);
      setMessage(text);
    } finally {
      setDeletingLibraryItemId(null);
      setRemovingLibraryItemId(null);
    }
  }, [deletingLibraryItemId, libraryDeleteConfirmItemId, prefersReducedMotion, refreshLibrary]);

  const libraryCounts = useMemo(() => ({
    all: library.length,
    image: library.filter((item) => item.type === "image").length,
    video: library.filter((item) => item.type === "video").length,
  }), [library]);
  const libraryDeleteConfirmItem = useMemo(
    () => library.find((item) => item.id === libraryDeleteConfirmItemId) || null,
    [library, libraryDeleteConfirmItemId],
  );

  const accountHeaderSlot = (
    <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/68 md:flex">
      <span>积分</span>
      <strong className="text-white">{sessionLoading || accountLoading ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} 分` : "—"}</strong>
      <span className="text-white/38">/</span>
      <span>{sessionUser ? sessionUser.display_name : "未登录"}</span>
    </div>
  );

  const handleImageResult = useCallback((item: LibraryItem) => {
    setOutputs((prev) => ({ ...prev, image: { item, title: "图片结果", tool: "image" } }));
  }, []);

  useEffect(() => {
    if (!imageGenerationProgress || imageGenerationProgress.status !== "running") return undefined;

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
  const imageWorkspaceCanSubmit = Boolean(selectedImageProvider)
    && !providersLoading
    && !imageWorkspace.loading
    && Boolean(imageWorkspacePrompt)
    && (!imageWorkspaceRequiresFile || imageWorkspaceHasFiles);

  const updateImageWorkspace = useCallback((patch: Partial<ImageWorkspaceState>) => {
    setImageWorkspace((prev) => ({ ...prev, ...patch }));
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
      const data = await jsonFetch<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "image-generator",
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
      }));
      return;
    }
    setImageWorkspace((prev) => ({
      ...prev,
      files: nextFiles,
      fileError: "",
      submitError: "",
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
    }));
  }, []);

  const submitImageWorkspace = useCallback(async () => {
    if (!selectedImageProvider) {
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: "当前尚未配置可用模型。",
      }));
      setMessage("当前尚未配置可用模型。");
      return;
    }
    if (!imageWorkspacePrompt) {
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: "请输入提示词。",
      }));
      return;
    }
    if (imageWorkspace.loading) return;
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

    setImageWorkspace((prev) => ({
      ...prev,
      loading: true,
      submitError: "",
      fileError: "",
    }));
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    const startedAt = Date.now();
    setGenerationProgressTick(startedAt);
    setImageGenerationProgress({
      status: "running",
      current: 0,
      total: totalCount,
      startedAt,
      message: totalCount > 1 ? `正在生成第 1 / ${totalCount} 张` : "正在生成图片",
    });
    try {
      for (let index = 0; index < totalCount; index += 1) {
        const taskId = createTaskId(`image-${index + 1}`);
        const requestFingerprint = generationBillingFingerprint({
          kind: "image",
          providerId: selectedImageProvider.id,
          mode: activeImageMode,
          ratio: imageWorkspace.ratio,
          quality: imageWorkspace.quality,
          referenceImages: imageWorkspace.files.length,
          taskId,
          estimatedQuotaUnits: estimatedQuotaUnitsPerImage,
        });

        setImageGenerationProgress((current) => current ? {
          ...current,
          status: "running",
          current: index,
          message: totalCount > 1 ? `正在生成第 ${index + 1} / ${totalCount} 张` : "正在生成图片",
        } : current);

        try {
          await fetchJsonWithCsrf("/api/quota/precheck", {
            method: "POST",
            body: JSON.stringify({
              operation: "cloud_image_generation",
              taskId,
              idempotencyKey: taskId,
              estimatedQuotaUnits: estimatedQuotaUnitsPerImage,
              requestFingerprint,
            }),
          });
        } catch (error) {
          const text = error instanceof Error ? error.message : "额度预检失败。";
          setImageWorkspace((prev) => ({ ...prev, submitError: text }));
          throw new Error(text);
        }

        const form = new FormData();
        form.set("providerId", selectedImageProvider.id);
        form.set("mode", activeImageMode);
        form.set("ratio", imageWorkspace.ratio);
        form.set("quality", imageWorkspace.quality);
        form.set("prompt", imageWorkspace.prompt);
        form.set("taskId", taskId);
        form.set("idempotencyKey", taskId);
        form.set("estimatedQuotaUnits", String(estimatedQuotaUnitsPerImage));
        imageWorkspace.files.forEach((attachment) => form.append("files", attachment.file));
        const data = await fetchJsonWithCsrf<{ item: LibraryItem }>("/api/generate/image", {
          method: "POST",
          body: form,
        });
        handleImageResult(data.item);
        setImageGenerationProgress((current) => current ? {
          ...current,
          current: index + 1,
          message: totalCount > 1 ? `已完成 ${index + 1} / ${totalCount} 张` : "图片已生成",
        } : current);
      }

      await refreshLibrary();
      await refreshAccountData(sessionUser?.local_user_id || null);
      setImageGenerationProgress((current) => current ? {
        ...current,
        status: "done",
        current: totalCount,
        completedAt: Date.now(),
        message: totalCount > 1 ? `${totalCount} 张图片已生成` : "图片已生成",
      } : current);
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片生成失败。";
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: text,
      }));
      setImageGenerationProgress((current) => current ? {
        ...current,
        status: "failed",
        completedAt: Date.now(),
        message: text,
      } : current);
      setMessage(text);
    } finally {
      setImageWorkspace((prev) => ({
        ...prev,
        loading: false,
      }));
    }
  }, [
    activeImageMode,
    handleImageResult,
    imageWorkspace.files,
    imageWorkspace.loading,
    imageWorkspace.quality,
    imageWorkspace.ratio,
    imageWorkspace.prompt,
    imageGenerationCount,
    imageWorkspacePrompt,
    refreshAccountData,
    imageWorkspaceHasFiles,
    imageWorkspaceRequiresFile,
    refreshLibrary,
    sessionUser?.local_user_id,
    selectedImageProvider,
    setMessage,
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
  const videoWorkspaceCanSubmit = Boolean(selectedVideoProvider)
    && !providersLoading
    && !videoWorkspace.loading
    && Boolean(videoWorkspacePrompt)
    && (!videoWorkspaceNeedsFile || videoWorkspaceHasFiles)
    && (!videoWorkspaceRequiresFile || videoWorkspaceHasFiles)
    && (!selectedVideoModelRequiresFile || videoWorkspaceHasFiles);

  const updateVideoWorkspace = useCallback((patch: Partial<VideoWorkspaceState>) => {
    setVideoWorkspace((prev) => ({ ...prev, ...patch }));
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
      const data = await jsonFetch<{ prompt?: string; optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      }));
      return;
    }
    setVideoWorkspace((prev) => ({
      ...prev,
      files: nextFiles,
      fileError: "",
      submitError: "",
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
    }));
  }, [selectedVideoModelRequiresFile]);

  const updateImageUpscaleWorkspace = useCallback((patch: Partial<ImageUpscaleWorkspaceState>) => {
    setImageUpscaleWorkspace((prev) => ({ ...prev, ...patch }));
  }, []);

  const checkImageUpscaleAvailability = useCallback(async () => {
    updateImageUpscaleWorkspace({ statusLoading: true, statusError: "", checked: true });
    try {
      const data = await jsonFetch<UpscaleStatusResponse>("/api/upscale/status");
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
    void checkImageUpscaleAvailability();
  }, [checkImageUpscaleAvailability]);

  const replaceImageUpscaleFile = useCallback((files: File[]) => {
    const previous = imageUpscaleFileRef.current;
    try {
      const nextFile = createImageUpscaleFile(files);
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
  }, [updateImageUpscaleWorkspace]);

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
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/image", {
        method: "POST",
        body: form,
      });
      setOutputs((prev) => ({ ...prev, "image-upscale": { item: data.item, job: data.job, title: "图片高清结果", tool: "image-upscale" } }));
      await refreshLibrary();
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片高清处理失败。";
      updateImageUpscaleWorkspace({ submitError: text });
      setMessage(text);
    } finally {
      updateImageUpscaleWorkspace({ loading: false });
    }
  }, [imageUpscaleWorkspace.availability?.ready, imageUpscaleWorkspace.file, imageUpscaleWorkspace.loading, imageUpscaleWorkspace.scale, refreshLibrary, setMessage, updateImageUpscaleWorkspace]);

  const imageUpscaleCanSubmit = Boolean(imageUpscaleWorkspace.file)
    && Boolean(imageUpscaleWorkspace.availability?.ready)
    && !imageUpscaleWorkspace.loading
    && !imageUpscaleWorkspace.statusLoading;

  const updateVideoUpscaleWorkspace = useCallback((patch: Partial<VideoUpscaleWorkspaceState>) => {
    setVideoUpscaleWorkspace((prev) => ({ ...prev, ...patch }));
  }, []);

  const checkVideoUpscaleAvailability = useCallback(async () => {
    updateVideoUpscaleWorkspace({ statusLoading: true, statusError: "", checked: true });
    try {
      const data = await jsonFetch<UpscaleStatusResponse>("/api/upscale/status");
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
    void checkVideoUpscaleAvailability();
  }, [checkVideoUpscaleAvailability]);

  useEffect(() => {
    if (!previewMode && !sessionLoading && !sessionUser && !sessionError) {
      router.replace("/login");
    }
  }, [previewMode, router, sessionError, sessionLoading, sessionUser]);

  const replaceVideoUpscaleFile = useCallback((files: File[]) => {
    const previous = videoUpscaleFileRef.current;
    try {
      const nextFile = createVideoUpscaleFile(files);
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
  }, [updateVideoUpscaleWorkspace]);

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
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>("/api/upscale/video", {
        method: "POST",
        body: form,
      });
      updateVideoUpscaleWorkspace({ job: data.job });
      setOutputs((prev) => ({ ...prev, "video-upscale": { item: data.item, job: data.job, title: "视频高清结果", tool: "video-upscale" } }));
      await refreshLibrary();
    } catch (error) {
      const text = error instanceof Error ? error.message : "视频高清处理失败。";
      updateVideoUpscaleWorkspace({ submitError: text });
      setMessage(text);
    } finally {
      updateVideoUpscaleWorkspace({ loading: false });
    }
  }, [
    refreshLibrary,
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

  const sendResultToUpscale = useCallback(async (item: LibraryItem) => {
    if (!item.output?.url) {
      setMessage("结果文件暂不可用。");
      return;
    }

    setMessage("正在准备高清素材。");
    try {
      if (item.type === "image") {
        const file = await fileFromLibraryOutput(item, ".png");
        replaceImageUpscaleFile([file]);
        setActiveWorkspaceToolId("image-upscale");
        setMessage("已带入图片高清，请选择倍数后开始增强。");
        return;
      }

      const file = await fileFromLibraryOutput(item, ".mp4");
      replaceVideoUpscaleFile([file]);
      setActiveWorkspaceToolId("video-upscale");
      setMessage("已带入视频高清，请选择倍数后开始增强。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "高清素材准备失败。");
    }
  }, [replaceImageUpscaleFile, replaceVideoUpscaleFile, setMessage]);

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
            "video-upscale": { item: updatedItem, job: nextJob, title: "视频高清结果", tool: "video-upscale" },
          }));
          if (updatedItem.status === "failed") {
            updateVideoUpscaleWorkspace({ submitError: updatedItem.error || nextJob.error || "视频高清处理失败。" });
          }
        }
        await refreshLibrary();
      } catch (error) {
        const text = error instanceof Error ? error.message : "视频高清任务查询失败。";
        updateVideoUpscaleWorkspace({ submitError: text });
        setMessage(text);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshLibrary, setMessage, updateVideoUpscaleWorkspace, videoUpscaleWorkspace.job]);

  useEffect(() => {
    const job = videoWorkspace.job;
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await jsonFetch<{ job: JobRecord | null }>(`/api/jobs/${job.id}`);
        if (data.job) updateVideoWorkspace({ job: data.job });
        const libraryData = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
        const updatedItem = libraryData.items.find((item) => item.id === job.libraryItemId);
        if (updatedItem) handleVideoResult(updatedItem, data.job || job);
        await refreshLibrary();
      } catch (error) {
        const text = error instanceof Error ? error.message : "视频任务查询失败。";
        updateVideoWorkspace({ submitError: text });
        setMessage(text);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [handleVideoResult, refreshLibrary, setMessage, updateVideoWorkspace, videoWorkspace.job]);

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
    if (videoWorkspace.loading) return;
    if ((videoWorkspaceRequiresFile || videoWorkspaceNeedsFile || selectedVideoModelRequiresFile) && !videoWorkspaceHasFiles) {
      setVideoWorkspace((prev) => ({
        ...prev,
        fileError: selectedVideoModelRequiresFile ? videoModelReferenceMessage : "请先上传图像。",
      }));
      return;
    }

    const taskId = createTaskId("video");
    const estimatedQuotaUnits = estimateVideoGenerationQuota({
      mode: activeVideoMode,
      durationSeconds: videoWorkspace.duration,
      referenceImages: videoWorkspace.files.length,
    });
    const requestFingerprint = generationBillingFingerprint({
      kind: "video",
      providerId: selectedVideoProvider.id,
      mode: activeVideoMode,
      ratio: videoWorkspace.ratio,
      durationSeconds: videoWorkspace.duration,
      referenceImages: videoWorkspace.files.length,
      taskId,
      estimatedQuotaUnits,
    });

    try {
      await fetchJsonWithCsrf("/api/quota/precheck", {
        method: "POST",
        body: JSON.stringify({
          operation: "cloud_video_generation",
          taskId,
          idempotencyKey: taskId,
          estimatedQuotaUnits,
          requestFingerprint,
        }),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "额度预检失败。";
      updateVideoWorkspace({ submitError: text });
      setMessage(text);
      return;
    }

    updateVideoWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
    });
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const form = new FormData();
      form.set("providerId", selectedVideoProvider.id);
      form.set("mode", activeVideoMode);
      form.set("ratio", videoWorkspace.ratio);
      form.set("duration", String(videoWorkspace.duration));
      form.set("prompt", videoWorkspace.prompt);
      form.set("taskId", taskId);
      form.set("idempotencyKey", taskId);
      form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
      if (activeVideoMode === "image-to-video") {
        videoWorkspace.files.forEach((attachment) => form.append("files", attachment.file));
      }
      const data = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", {
        method: "POST",
        body: form,
      });
      updateVideoWorkspace({ job: data.job });
      handleVideoResult(data.item, data.job);
      await refreshLibrary();
      await refreshAccountData(sessionUser?.local_user_id || null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "视频生成失败。";
      updateVideoWorkspace({ submitError: text });
      setMessage(text);
    } finally {
      updateVideoWorkspace({ loading: false });
    }
  }, [
    activeVideoMode,
    handleVideoResult,
    refreshAccountData,
    refreshLibrary,
    selectedVideoProvider,
    selectedVideoModelRequiresFile,
    setMessage,
    updateVideoWorkspace,
    sessionUser?.local_user_id,
    videoWorkspace.duration,
    videoWorkspace.files,
    videoWorkspace.loading,
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
          onProviderChange={(value) => updateImageWorkspace({ providerId: value })}
          onRatioChange={(value) => updateImageWorkspace({ ratio: value })}
          onQualityChange={(value) => updateImageWorkspace({ quality: value })}
          onCountChange={(value) => updateImageWorkspace({ count: value })}
          onTemplateChange={applyImagePromptTemplate}
          onPromptChange={(value) => updateImageWorkspace({ prompt: value, promptOptimizeError: "", submitError: "" })}
          onPromptOptimize={optimizeImagePrompt}
          onPromptOptimizeUndo={undoImagePromptOptimization}
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
          onProviderChange={(value) => updateVideoWorkspace({ providerId: value, submitError: "" })}
          onRatioChange={(value) => updateVideoWorkspace({ ratio: value })}
          onDurationChange={(value) => updateVideoWorkspace({ duration: value })}
          onTemplateChange={applyVideoPromptTemplate}
          onPromptChange={(value) => updateVideoWorkspace({ prompt: value, promptOptimizeError: "", submitError: "" })}
          onPromptOptimize={optimizeVideoPrompt}
          onPromptOptimizeUndo={undoVideoPromptOptimization}
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
          onScaleChange={(value) => updateImageUpscaleWorkspace({ scale: value as "2" | "4", submitError: "" })}
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
          onScaleChange={(value) => updateVideoUpscaleWorkspace({ scale: value as "2" | "4", submitError: "" })}
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
        accountPointsLabel={sessionLoading || accountLoading ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} 分` : "—"}
        headerRightSlot={accountHeaderSlot}
        accountCloseSignal={accountCloseSignal}
        onOpenAccountCenter={handleOpenAccountCenter}
        onOpenAccountRecharge={handleOpenRechargeCenter}
        accountSlot={(
          <WorkspaceAccountPanel
            user={sessionUser}
            quota={quotaSnapshot}
            loading={sessionLoading || accountLoading}
            accountError={accountDataError}
            accountView={accountCenterOpen ? accountView : undefined}
            onRefresh={() => void refreshAccountSnapshot()}
            onLogout={() => void handleLogout()}
            onOpenCenter={handleOpenAccountCenter}
            onOpenRecharge={handleOpenRechargeCenter}
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
              loading={sessionLoading || accountLoading}
              billingOrders={billingOrders}
              accountError={accountDataError}
              accountView={accountView}
              onViewChange={setAccountView}
              onRefreshAccount={() => void refreshAccountSnapshot()}
              onPaymentUnavailable={handlePaymentUnavailable}
            />
          ) : activeBusinessTool === "library" ? (
            <LibraryWorkspace
              items={currentLibraryItems}
              totalCount={library.length}
              count={libraryCounts}
              selectedItem={selectedLibraryItem}
              loading={libraryLoading}
              error={libraryError}
              isAuthenticated={Boolean(sessionUser)}
              filter={libraryFilter}
              sort={librarySort}
              search={librarySearch}
              deletingItemId={deletingLibraryItemId}
              removingItemId={removingLibraryItemId}
              missingMediaIds={missingLibraryMediaIds}
              onFilterChange={setLibraryFilter}
              onSortChange={setLibrarySort}
              onSearchChange={setLibrarySearch}
              onSelectItem={setSelectedLibraryItemId}
              onDelete={handleRequestDeleteLibraryItem}
              onRefresh={refreshLibrary}
              onMediaMissing={markLibraryMediaMissing}
              onLogin={() => router.push("/login")}
              onStartCreate={() => setActiveWorkspaceToolId("image")}
            />
          ) : (
            activeBusinessTool === "image" ? (
              <ImagePreviewPanel
                mode={activeImageMode}
                output={activeOutput}
                loading={imageWorkspace.loading}
                submitError={imageWorkspace.submitError}
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
                submitError={videoWorkspace.submitError}
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
      <LibraryDeleteConfirmDialog
        item={libraryDeleteConfirmItem}
        deleting={Boolean(libraryDeleteConfirmItem && deletingLibraryItemId === libraryDeleteConfirmItem.id)}
        onCancel={handleCancelDeleteLibraryItem}
        onConfirm={() => void handleConfirmDeleteLibraryItem()}
      />
      {imageGenerationProgress ? (
        <ImageGenerationProgressToast
          progress={imageGenerationProgress}
          tick={generationProgressTick}
          stacked={Boolean(message)}
          onClose={() => setImageGenerationProgress(null)}
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
  accountError,
  accountView,
  onViewChange,
  onRefreshAccount,
  onPaymentUnavailable,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  loading: boolean;
  billingOrders: BillingOrder[];
  accountError: string;
  accountView: AccountView;
  onViewChange: (view: AccountView) => void;
  onRefreshAccount: () => void;
  onPaymentUnavailable: (text?: string) => void;
}) {
  if (accountView === "recharge") {
    return (
      <RechargeCenterWorkspace
        user={user}
        quota={quota}
        loading={loading}
        accountError={accountError}
        onViewChange={onViewChange}
        onRefreshAccount={onRefreshAccount}
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
      accountError={accountError}
      onRefreshAccount={onRefreshAccount}
      onViewChange={onViewChange}
    />
  );
}

function UserCenterOverview({
  user,
  quota,
  usage,
  loading,
  accountError,
  onRefreshAccount,
  onViewChange,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  usage: UsagePage | null;
  loading: boolean;
  accountError: string;
  onRefreshAccount: () => void;
  onViewChange: (view: AccountView) => void;
}) {
  const usageEntries = usage?.entries?.slice(0, 6) || [];
  const quotaUnits = quota?.quota_units ?? null;
  const quotaValue = loading ? "加载中" : quota ? `${formatQuotaUnits(quota.quota_units)} 分` : "—";
  const quotaNote = loading
    ? "正在同步真实账户积分。"
    : quota
      ? "积分用于图片和视频创作。"
      : "账户信息暂时无法加载。";
  const planValue = loading ? "加载中" : quota ? "当前未开通套餐" : "—";
  const planNote = loading
    ? "正在同步套餐状态。"
    : quota
      ? "当前使用按次积分模式。"
      : "账户信息暂时无法加载。";
  const checkInValue = loading ? "加载中" : "签到暂未开放";
  const checkInNote = loading ? "正在确认签到状态。" : "开放后会在这里显示每日签到状态。";
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
          {accountError && !loading ? (
            <div className="user-center-account-alert" role="status">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <span>{accountError}</span>
              <button type="button" onClick={onRefreshAccount} disabled={!user}>重试</button>
            </div>
          ) : null}

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
                <button type="button" className="user-center-action" onClick={() => onViewChange("usage")} disabled={!user}>
                  <History className="size-4" aria-hidden="true" />
                  查看记录
                </button>
              </div>
            </article>

            <div className="user-center-side-cards">
              <article className="user-center-mini-card">
                <span className="user-center-card-icon">
                  <Crown className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <span>当前套餐</span>
                  <strong>{planValue}</strong>
                  <p>{planNote}</p>
                </div>
                <button type="button" className="user-center-mini-card__action" onClick={() => onViewChange("recharge")} disabled={!user}>
                  查看套餐
                </button>
              </article>

              <article className="user-center-mini-card">
                <span className="user-center-card-icon">
                  <CalendarCheck className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <span>每日签到</span>
                  <strong>{checkInValue}</strong>
                  <p>{checkInNote}</p>
                </div>
                <button type="button" className="user-center-mini-card__action" disabled>
                  暂未开放
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
  accountError,
  onViewChange,
  onRefreshAccount,
  onPaymentUnavailable,
}: {
  user: PublicAuthUser | null;
  quota: QuotaSnapshot | null;
  loading: boolean;
  accountError: string;
  onViewChange: (view: AccountView) => void;
  onRefreshAccount: () => void;
  onPaymentUnavailable: (text?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<RechargeTab>("plans");
  const [selectedPlanId, setSelectedPlanId] = useState("standard");
  const [selectedCreditAmount, setSelectedCreditAmount] = useState<number | null>(50);
  const [customAmount, setCustomAmount] = useState("");

  const defaultPlan = planOptions.find((plan) => plan.recommended) || planOptions[0] || null;
  const selectedPlan = planOptions.find((plan) => plan.id === selectedPlanId) || defaultPlan;
  const selectedCredit = selectedCreditAmount === null
    ? null
    : creditTopUpOptions.find((option) => option.amount === selectedCreditAmount) || null;
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
  const pointsStatusLabel = quota ? `${formatQuotaUnits(quota.quota_units)} 分` : "—";
  const planStatusLabel = quota ? "暂未开通" : "—";
  const creditSummaryLines = customRechargeActive
    ? createCustomCreditSummaryLines(customAmount, customAmountValid, customCredits)
    : createFixedCreditSummaryLines(selectedCredit);
  const creditSummaryReady = customRechargeActive ? customAmountValid : Boolean(selectedCredit);
  const creditPayableAmount = customRechargeActive && customAmountValid
    ? customAmount
    : selectedCredit?.amount ?? "";
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
  });
  const paymentUnavailableNote = "当前仅可核对订单信息，支付功能暂未开放。";

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
              {loading && !quota ? (
                <i className="recharge-account-meta__skeleton motion-skeleton-shimmer" aria-label="套餐加载中" />
              ) : (
                <strong>{planStatusLabel}</strong>
              )}
            </span>
          </div>
        )}
        actions={(
          <div className="recharge-header-actions">
            <button type="button" className="recharge-header-action" onClick={() => onViewChange("usage")}>
              <ReceiptText className="size-4" aria-hidden="true" />
              充值记录
            </button>
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

        {accountError && !loading ? (
          <div className="recharge-account-error" role="status">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <span>{accountError}</span>
            <button type="button" onClick={onRefreshAccount}>重试</button>
          </div>
        ) : null}

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
                        {badge ? <span className="recharge-card-badge">{badge}</span> : null}
                        <strong className="credit-topup-card__amount">¥{formatRechargeAmount(option.amount)}</strong>
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
                note={paymentUnavailableNote}
                buttonLabel={creditConfirmState.label}
                disabled={creditConfirmState.disabled}
                onConfirm={onPaymentUnavailable}
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
    <section className="user-center-page account-subpage" aria-label="消费记录">
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

function formatQuotaUnits(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatAccountDataError(error: unknown) {
  void error;
  return "部分账户信息暂时无法加载，请稍后重试。";
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
}) {
  if (!input.ready) {
    if (input.mode === "credits" && input.customRechargeActive && !input.customAmountValid) {
      return { disabled: true, label: "请检查充值金额" };
    }
    return { disabled: true, label: input.mode === "plans" ? "请选择套餐" : "请选择充值金额" };
  }

  if (!input.user) return { disabled: true, label: "登录后继续" };
  if (!PAYMENT_FLOW_AVAILABLE) return { disabled: true, label: "支付功能暂未开放" };

  if (input.mode === "plans" && input.selectedPlan) {
    return { disabled: false, label: `立即购买 ¥${formatRechargeAmount(input.selectedPlan.price)}` };
  }

  if (input.mode === "credits" && input.amount !== undefined && input.amount !== "") {
    return { disabled: false, label: `立即充值 ¥${formatRechargeAmount(input.amount)}` };
  }

  return { disabled: true, label: input.mode === "plans" ? "请选择套餐" : "请选择充值金额" };
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
    cloud_image_upscale: "图片高清",
    cloud_video_upscale: "视频高清",
  };
  return labels[operation] || "AI 工具";
}

function usageDescription(entry: UsageLogEntry) {
  const descriptions: Record<UsageLogEntry["operation"], string> = {
    cloud_image_generation: "生成图片",
    cloud_video_generation: "生成视频",
    cloud_image_upscale: "图片高清处理",
    cloud_video_upscale: "视频高清处理",
  };
  if (entry.status === "failed") return `${descriptions[entry.operation] || "工具处理"}失败`;
  if (entry.status === "refunded") return `${descriptions[entry.operation] || "工具处理"}已退回额度`;
  return descriptions[entry.operation] || "工具处理";
}

function ImageGenerator({
  mode,
  showTemplates,
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  templateCenterHref,
  state,
  canSubmit,
  estimatedQuotaUnits,
  onProviderChange,
  onRatioChange,
  onQualityChange,
  onCountChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceImageMode;
  showTemplates: boolean;
  providers: FrontendProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: FrontendProvider | null;
  templateCenterHref: string;
  state: ImageWorkspaceState;
  canSubmit: boolean;
  estimatedQuotaUnits: number;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: () => void;
  onPromptOptimizeUndo: () => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? meta.loadingLabel : meta.submitLabel,
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, meta.loadingLabel, meta.submitLabel, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      {showTemplates ? (
        <TemplateRail
          title="模板"
          viewAllHref={templateCenterHref}
          templates={featuredImagePromptTemplates}
          activeTemplateId={state.templateId}
          onSelect={(template) => onTemplateChange(template.id)}
        />
      ) : null}
      <ReferenceImageInput
        mode={mode}
        files={state.files}
        error={state.fileError}
        onChange={onFilesChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
      />
      <StackedControl label="比例" required>
        <AspectRatioSelector label="比例" value={state.ratio} onChange={onRatioChange} />
      </StackedControl>
      <div className="studio-dual-fields">
        <StackedControl label="清晰度" required>
          <CustomSelect
            label="清晰度"
            value={state.quality}
            options={[
              { value: "1k", label: "1K（默认）" },
              { value: "2k", label: "2K（细节更多）" },
            ]}
            onChange={onQualityChange}
          />
        </StackedControl>
        <StackedControl label="数量" required>
          <CustomSelect
            label="数量"
            value={String(state.count)}
            options={[
              { value: "1", label: "1张" },
              { value: "2", label: "2张" },
              { value: "3", label: "3张" },
              { value: "4", label: "4张" },
            ]}
            onChange={(value) => onCountChange(Number(value))}
          />
        </StackedControl>
      </div>
      <PromptBox
        value={state.prompt}
        onChange={onPromptChange}
        optimizing={state.promptOptimizing}
        optimizeError={state.promptOptimizeError}
        canUndoOptimize={Boolean(state.promptOptimizeUndo)}
        onOptimize={onPromptOptimize}
        onUndoOptimize={onPromptOptimizeUndo}
        required
        placeholder={meta.promptPlaceholder}
      />
      {state.submitError ? <p className="studio-error-text" role="alert">{state.submitError}</p> : null}

      <StickyPrimaryAction>
        <SubmitButton
          disabled={!canSubmit}
          loading={state.loading}
          loadingLabel={meta.loadingLabel}
          costLabel={`花费 ${formatQuotaUnits(estimatedQuotaUnits)} 积分`}
          onClick={onSubmit}
        >
          {meta.submitLabel}
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function ReferenceImageInput({
  mode,
  files,
  error,
  onChange,
  onRemove,
  onClear,
}: {
  mode: WorkspaceImageMode;
  files: ImageWorkspaceFile[];
  error: string;
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onChange(nextFiles);
  }, [onChange]);

  return (
    <FieldFrame label="图像" hint={mode === "image-to-image" ? "已上传" : "可选"}>
      <CompactDropzone
        inputRef={fileInputRef}
        inputId="reference-image-input"
        accept="image/png,image/jpeg,image/webp"
        multiple
        dragging={dragging}
        error={error}
        files={files.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
        }))}
        emptyTitle="上传图像"
        filledTitle="已选择图像"
        helpText="支持 JPG、PNG、WEBP"
        onFiles={applyFiles}
        onRemove={onRemove}
        onClear={files.length ? onClear : undefined}
        onDraggingChange={setDragging}
      />
      {error ? <p id="reference-image-error" className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function VideoGenerator({
  mode,
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  templateCenterHref,
  state,
  canSubmit,
  estimatedQuotaUnits,
  onProviderChange,
  onRatioChange,
  onDurationChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  ratioOptions,
  durationOptions,
  modelRequiresImage,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceVideoMode;
  providers: FrontendProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: WorkspacePublicProvider | null;
  templateCenterHref: string;
  state: VideoWorkspaceState;
  canSubmit: boolean;
  estimatedQuotaUnits: number;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: () => void;
  onPromptOptimizeUndo: () => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  ratioOptions: string[];
  durationOptions: number[];
  modelRequiresImage: boolean;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = videoWorkspaceModeMeta[mode];

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? meta.loadingLabel : meta.submitLabel,
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, meta.loadingLabel, meta.submitLabel, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      <TemplateRail
        title="模板"
        viewAllHref={templateCenterHref}
        templates={featuredVideoPromptTemplates}
        activeTemplateId={state.templateId}
        onSelect={(template) => onTemplateChange(template.id)}
      />
      <VideoReferenceInput
        files={state.files}
        error={state.fileError}
        label={meta.uploadLabel}
        mode={mode}
        emptyTitle={meta.uploadEmptyTitle}
        filledTitle={meta.uploadFilledTitle}
        helpText={meta.uploadHelpText}
        required={modelRequiresImage || meta.uploadRequired}
        onChange={onFilesChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
      />
      {modelRequiresImage && !state.files.length ? (
        <p className="studio-help-text">{videoModelReferenceMessage}</p>
      ) : null}
      <StackedControl label="比例" required>
        <AspectRatioSelector label="比例" value={state.ratio} options={ratioOptions} onChange={onRatioChange} />
      </StackedControl>
      <FieldFrame label="时长" required>
        <CustomSelect
          label="时长"
          value={String(state.duration)}
          options={durationOptions.map((value) => ({
            value: String(value),
          label: `${value} 秒`,
          }))}
          onChange={(value) => onDurationChange(Number(value))}
        />
      </FieldFrame>
      <VideoPromptBox
        label={meta.promptLabel}
        value={state.prompt}
        onChange={onPromptChange}
        optimizing={state.promptOptimizing}
        optimizeError={state.promptOptimizeError}
        canUndoOptimize={Boolean(state.promptOptimizeUndo)}
        onOptimize={onPromptOptimize}
        onUndoOptimize={onPromptOptimizeUndo}
        required
        placeholder={meta.promptPlaceholder}
      />
      {state.submitError ? <p className="studio-error-text" role="alert">{state.submitError}</p> : null}
      <StickyPrimaryAction>
        <SubmitButton
          disabled={!canSubmit}
          loading={state.loading}
          loadingLabel={meta.loadingLabel}
          costLabel={`花费 ${formatQuotaUnits(estimatedQuotaUnits)} 积分`}
          onClick={onSubmit}
        >
          {meta.submitLabel}
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function VideoReferenceInput({
  files,
  error,
  label,
  mode,
  emptyTitle,
  filledTitle,
  helpText,
  required,
  onChange,
  onRemove,
  onClear,
}: {
  files: VideoWorkspaceFile[];
  error: string;
  label: string;
  mode: WorkspaceVideoMode;
  emptyTitle: string;
  filledTitle: string;
  helpText: string;
  required: boolean;
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <FieldFrame label={label} required={required} hint={required ? "必填" : mode === "image-to-video" ? "已上传" : "可选"}>
      <CompactDropzone
        inputRef={inputRef}
        inputId="video-first-frame-input"
        accept="image/png,image/jpeg,image/webp"
        multiple={false}
        dragging={dragging}
        error={error}
        files={files.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
        }))}
        emptyTitle={emptyTitle}
        filledTitle={filledTitle}
        helpText={helpText}
        onFiles={onChange}
        onRemove={onRemove}
        onClear={files.length ? onClear : undefined}
        onDraggingChange={setDragging}
      />
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}

function VideoPromptBox({
  label,
  value,
  onChange,
  enableOptimization = true,
  placeholder,
  required,
  optimizing,
  optimizeError,
  canUndoOptimize,
  onOptimize,
  onUndoOptimize,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  enableOptimization?: boolean;
  placeholder: string;
  required?: boolean;
  optimizing: boolean;
  optimizeError: string;
  canUndoOptimize: boolean;
  onOptimize: () => void;
  onUndoOptimize: () => void;
}) {
  const descriptionId = "video-prompt-counter";

  return (
    <FieldFrame
      label={label}
      required={required}
      action={(
        <div className="studio-prompt-actions">
          <button
            type="button"
            className="studio-prompt-action studio-prompt-action--clear"
            onClick={() => onChange("")}
            disabled={!value}
            aria-label="清除提示词"
          >
            清除
          </button>
          <button
            type="button"
            className={cn("studio-prompt-action", !enableOptimization && "hidden")}
            onClick={onOptimize}
            disabled={optimizing || !enableOptimization}
            aria-busy={optimizing}
            aria-hidden={!enableOptimization}
          >
            {optimizing ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                正在优化…
              </>
            ) : (
              "✨ 优化提示词"
            )}
          </button>
          {enableOptimization && canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize}>
              撤销优化
            </button>
          ) : null}
        </div>
      )}
    >
      <label className="studio-sr-only" htmlFor="video-prompt">
        {label}
      </label>
      <div className="studio-textarea-wrap">
        <textarea
          id="video-prompt"
          data-testid="video-prompt-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={descriptionId}
          className="studio-textarea"
        />
        <span id={descriptionId} className="studio-counter">{value.length} 个字符</span>
      </div>
      {optimizeError ? <p className="studio-error-text" role="alert">{optimizeError}</p> : null}
    </FieldFrame>
  );
}

function ImageUpscaleForm({
  state,
  canSubmit,
  onScaleChange,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onSubmit,
  registerMobileAction,
}: {
  state: ImageUpscaleWorkspaceState;
  canSubmit: boolean;
  onScaleChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: () => void;
  onFilesClear: () => void;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const file = state.file;

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? "正在增强" : "开始增强",
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <FieldFrame label="图像" required>
        <CompactDropzone
          inputRef={inputRef}
          inputId="image-upscale-input"
          accept="image/png,image/jpeg,image/webp"
          multiple={false}
          dragging={dragging}
          files={file ? [{ name: file.file.name, size: file.file.size, previewUrl: file.previewUrl }] : []}
          emptyTitle="上传图像"
          filledTitle="已选择图像"
          helpText="支持 JPG、PNG、WEBP"
          onFiles={onFilesChange}
          onRemove={file ? () => onFileRemove() : undefined}
          onClear={file ? onFilesClear : undefined}
          onDraggingChange={setDragging}
        />
        {state.fileError ? <p className="studio-error-text" role="alert">{state.fileError}</p> : null}
      </FieldFrame>

      <StackedControl label="放大倍数" required>
        <ModeSegmentedControl
          label="放大倍数"
          labelHidden
          groupId="image-upscale-scale"
          value={state.scale}
          options={[
            ["2", "2x"],
            ["4", "4x"],
          ]}
          onChange={onScaleChange}
        />
      </StackedControl>

      {state.checked && !state.statusLoading && !state.availability?.ready ? (
        <p className="studio-error-text" role="alert">{upscaleUnavailableMessage}</p>
      ) : null}

      <StickyPrimaryAction>
        <SubmitButton disabled={!canSubmit} loading={state.loading} loadingLabel="正在增强" onClick={onSubmit}>
          开始增强
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

type ToolTutorialKind = "image" | "image-editor" | "video" | "image-upscale" | "video-upscale";

type TutorialLayer = {
  src: string;
  alt: string;
  className: string;
  type?: "image" | "video";
  poster?: string;
};

type TutorialOverlay = {
  text: string;
  className: string;
};

type TutorialSection = {
  title: string;
  description: string;
  mediaSide: "left" | "right";
  visualClassName?: string;
  layers: TutorialLayer[];
  bubbles?: TutorialOverlay[];
  tags?: TutorialOverlay[];
};

const toolTutorials: Record<ToolTutorialKind, {
  title: string;
  description: string;
  sections: TutorialSection[];
}> = {
  image: {
    title: "图片生成快速教程",
    description: "从想法到商品图片，按三个步骤完成生成。",
    sections: [
      {
        title: "输入你的想法",
        description: "输入提示词，也可以上传图像作为参考，快速生成适合商品展示的图片。",
        mediaSide: "left",
        visualClassName: "is-stack",
        layers: [
          { src: "/tutorials/image-generator/idea-left.svg", alt: "白底商品示意图", className: "is-back-left is-tilt-left" },
          { src: "/tutorials/image-generator/idea-right.svg", alt: "商品场景示意图", className: "is-back-right is-tilt-right" },
          { src: "/tutorials/image-generator/idea-main.svg", alt: "商品主图示意图", className: "is-main is-tilt-soft-right" },
        ],
        bubbles: [{ text: "+ 提示词", className: "is-top" }],
      },
      {
        title: "调整图片参数",
        description: "选择比例和清晰度，让图片适合不同商品展示场景。",
        mediaSide: "right",
        visualClassName: "is-ratio",
        layers: [
          { src: "/tutorials/image-generator/ratio-square.svg", alt: "一比一商品图", className: "is-ratio-left is-tilt-soft-left" },
          { src: "/tutorials/image-generator/ratio-wide.svg", alt: "四比三详情图", className: "is-ratio-right is-tilt-soft-right" },
          { src: "/tutorials/image-generator/ratio-vertical.svg", alt: "九比十六竖屏图", className: "is-ratio-center" },
        ],
        tags: [
          { text: "1:1", className: "is-bottom-left" },
          { text: "9:16", className: "is-bottom-center" },
          { text: "4:3", className: "is-bottom-right" },
          { text: "2K", className: "is-top-right" },
        ],
      },
      {
        title: "生成并继续完善",
        description: "生成完成后，可以下载图片、保存到作品库，或继续优化结果。",
        mediaSide: "left",
        visualClassName: "is-result-stack",
        layers: [
          { src: "/tutorials/image-generator/result-left.svg", alt: "海报版本结果图", className: "is-back-left is-tilt-left" },
          { src: "/tutorials/image-generator/result-right.svg", alt: "细节版本结果图", className: "is-back-right is-tilt-right" },
          { src: "/tutorials/image-generator/result-main.svg", alt: "生成结果主图", className: "is-main is-tilt-soft-right" },
        ],
        tags: [
          { text: "下载", className: "is-action-left" },
          { text: "保存作品", className: "is-action-right" },
        ],
      },
    ],
  },
  "image-editor": {
    title: "图片编辑快速教程",
    description: "上传原图，描述修改，再查看真实编辑结果。",
    sections: [
      {
        title: "上传需要编辑的图像",
        description: "选择一张图片作为编辑基础，保留主体并修改指定内容。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/image-editor/upload.svg", alt: "上传图像示意框", className: "is-upload-base" },
          { src: "/tutorials/image-editor/source.svg", alt: "待编辑原图", className: "is-upload-front is-tilt-left" },
        ],
      },
      {
        title: "描述修改内容",
        description: "说明要修改什么，以及哪些内容必须保持不变。",
        mediaSide: "right",
        visualClassName: "is-edit-flow",
        layers: [
          { src: "/tutorials/image-editor/edit-source.svg", alt: "编辑前原图", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/image-editor/edit-result.svg", alt: "编辑后结果图", className: "is-flow-right is-tilt-right" },
        ],
        bubbles: [
          { text: "改为纯白背景", className: "is-center" },
          { text: "保留商品主体", className: "is-lower" },
        ],
      },
      {
        title: "查看编辑结果",
        description: "确认结果后下载，或继续调整提示词进行优化。",
        mediaSide: "left",
        visualClassName: "is-detail",
        layers: [
          { src: "/tutorials/image-editor/result-main.svg", alt: "编辑结果主图", className: "is-main" },
          { src: "/tutorials/image-editor/detail-one.svg", alt: "编辑结果局部细节一", className: "is-detail-left is-tilt-soft-left" },
          { src: "/tutorials/image-editor/detail-two.svg", alt: "编辑结果局部细节二", className: "is-detail-right is-tilt-soft-right" },
        ],
      },
    ],
  },
  video: {
    title: "视频生成快速教程",
    description: "从提示词或首帧开始，生成商品展示短视频。",
    sections: [
      {
        title: "输入视频内容",
        description: "填写提示词，也可以上传图像作为视频起点。",
        mediaSide: "left",
        visualClassName: "is-video-flow",
        layers: [
          { src: "/tutorials/video-generator/start-frame.svg", alt: "视频首帧示意", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/video-generator/end-frame.svg", alt: "视频末帧示意", className: "is-flow-right is-tilt-right" },
        ],
        bubbles: [{ text: "商品旋转展示，镜头缓慢推进", className: "is-center" }],
      },
      {
        title: "调整视频参数",
        description: "选择比例、时长和清晰度，让视频更适合展示场景。",
        mediaSide: "right",
        visualClassName: "is-video-stack",
        layers: [
          { src: "/tutorials/video-generator/frame-left.svg", alt: "视频后置镜头一", className: "is-back-left is-tilt-soft-left" },
          { src: "/tutorials/video-generator/frame-right.svg", alt: "视频后置镜头二", className: "is-back-right is-tilt-soft-right" },
          { src: "/tutorials/video-generator/cover-main.svg", alt: "视频主封面", className: "is-main" },
        ],
        tags: [
          { text: "5秒", className: "is-bottom-left" },
          { text: "720P", className: "is-bottom-center" },
          { text: "9:16", className: "is-bottom-right" },
        ],
      },
      {
        title: "生成并查看视频",
        description: "生成完成后，可以播放、下载，或继续完善视频效果。",
        mediaSide: "left",
        visualClassName: "is-video-result",
        layers: [
          { src: "/tutorials/video-generator/result-left.svg", alt: "视频结果后置帧一", className: "is-back-left is-tilt-soft-left" },
          { src: "/tutorials/video-generator/result-right.svg", alt: "视频结果后置帧二", className: "is-back-right is-tilt-soft-right" },
          {
            src: "/tutorials/video-generator/demo.webm",
            poster: "/tutorials/video-generator/demo-poster.svg",
            alt: "静音循环商品视频演示",
            className: "is-main-video",
            type: "video",
          },
        ],
      },
    ],
  },
  "image-upscale": {
    title: "图片高清快速教程",
    description: "上传图片，选择倍数，再下载高清结果。",
    sections: [
      {
        title: "上传图片",
        description: "选择需要提升清晰度的图片。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/image-upscale/upload.svg", alt: "图片高清上传框", className: "is-upload-base" },
          { src: "/tutorials/image-upscale/source.svg", alt: "待高清处理原图", className: "is-upload-front is-tilt-left" },
        ],
      },
      {
        title: "选择放大倍数",
        description: "根据用途选择 2 倍或 4 倍增强。",
        mediaSide: "right",
        visualClassName: "is-detail",
        layers: [
          { src: "/tutorials/image-upscale/main.svg", alt: "图片高清主图", className: "is-main" },
          { src: "/tutorials/image-upscale/detail-low.svg", alt: "原始细节示意", className: "is-detail-left is-tilt-soft-left" },
          { src: "/tutorials/image-upscale/detail-high.svg", alt: "高清细节示意", className: "is-detail-right is-tilt-soft-right" },
        ],
        tags: [
          { text: "2x", className: "is-bottom-left" },
          { text: "4x", className: "is-bottom-right" },
        ],
      },
      {
        title: "查看高清结果",
        description: "对比处理前后效果并下载高清图片。",
        mediaSide: "left",
        visualClassName: "is-compare",
        layers: [
          { src: "/tutorials/image-upscale/compare.svg", alt: "高清前后对比图", className: "is-compare-main" },
        ],
        tags: [{ text: "800 x 800 -> 3200 x 3200", className: "is-bottom-center is-wide" }],
      },
    ],
  },
  "video-upscale": {
    title: "视频高清快速教程",
    description: "上传视频，选择规格，再播放和下载高清结果。",
    sections: [
      {
        title: "上传视频",
        description: "选择需要提升清晰度的视频。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/video-upscale/upload.svg", alt: "视频高清上传框", className: "is-upload-base" },
          { src: "/tutorials/video-upscale/cover.svg", alt: "待处理视频封面", className: "is-upload-front is-tilt-left" },
        ],
        tags: [{ text: "播放", className: "is-action-left" }],
      },
      {
        title: "选择放大倍数",
        description: "根据输出需求选择增强规格。",
        mediaSide: "right",
        visualClassName: "is-video-compare",
        layers: [
          { src: "/tutorials/video-upscale/frame-low.svg", alt: "原始视频帧", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/video-upscale/frame-high.svg", alt: "高清视频帧", className: "is-flow-right is-tilt-right" },
        ],
        tags: [{ text: "2x / 4x", className: "is-center-tag" }],
      },
      {
        title: "播放高清结果",
        description: "确认清晰度后下载处理完成的视频。",
        mediaSide: "left",
        visualClassName: "is-video-result",
        layers: [
          {
            src: "/tutorials/video-upscale/result.webm",
            poster: "/tutorials/video-upscale/result-poster.svg",
            alt: "静音循环高清视频演示",
            className: "is-main-video",
            type: "video",
          },
        ],
        tags: [{ text: "640 x 360 -> 1280 x 720", className: "is-bottom-center is-wide" }],
      },
    ],
  },
};

function ImageGenerationTutorial() {
  return (
    <PreviewState eyebrow="快速教程" title="快速教程" description="输入描述，选择比例，即可生成图片。">
      <div className="image-tutorial-simple">
        <div className="image-tutorial-simple__stage">
          <div className="image-tutorial-simple__image-shell">
            <img
              className="image-tutorial-simple__image"
              src="/tutorials/image-generator/perfume-result.png"
              alt="新中式香水产品图，粉色牡丹花、香水瓶、大理石台面和中式窗棂背景"
            />
          </div>
          <div className="image-tutorial-simple__overlay image-tutorial-simple__overlay--prompt">
            <span>提示词</span>
            <p>新中式香水产品摄影，粉色牡丹花簇拥，香水瓶置于大理石台面，背景带有中式窗棂元素，光影柔和，画面干净高级，细节丰富，商业产品图风格。</p>
          </div>
          <div className="image-tutorial-simple__overlay image-tutorial-simple__overlay--ratio">
            <span>比例</span>
            <i aria-hidden="true" />
            <strong>16:9</strong>
          </div>
        </div>
      </div>
    </PreviewState>
  );
}

function ImageEditorTutorial() {
  return (
    <PreviewState eyebrow="图片编辑示例" title="图片编辑示例" description="上传图片并描述修改要求，快速完成内容编辑与素材融合。">
      <div className="image-editor-tutorial">
        <div className="image-editor-tutorial__canvas" aria-label="图片编辑器示例图片">
          <svg className="image-editor-tutorial__path" viewBox="0 0 980 520" aria-hidden="true">
            <path className="image-editor-tutorial__dash" d="M18 425C98 190 238 330 365 265C487 202 575 262 690 170C750 122 810 82 862 52" />
            <g className="image-editor-plane-mark">
              <path d="M9 30 56 9 42 56 32 39 9 48 25 33 9 30Z" fill="none" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--single-source">
            <img src="/tutorials/image-editor/single-source.png" alt="方形粉色香水瓶白底素材" />
          </figure>
          <svg className="image-editor-arrow image-editor-arrow--single" viewBox="0 0 128 74" aria-hidden="true" focusable="false">
            <defs>
              <marker id="image-editor-arrow-tip-single" viewBox="0 0 22 22" refX="19" refY="11" markerWidth="5.4" markerHeight="5.4" orient="auto">
                <path className="image-editor-arrow__tip" d="M3 2.6 19 11 3 19.4 7.4 11Z" />
              </marker>
            </defs>
            <path className="image-editor-arrow__halo" pathLength={1} d="M7 50C37 21 84 18 111 36" />
            <path className="image-editor-arrow__path" pathLength={1} d="M7 50C37 21 84 18 111 36" markerEnd="url(#image-editor-arrow-tip-single)" />
            <path className="image-editor-arrow__shine" pathLength={1} d="M7 50C37 21 84 18 111 36" />
          </svg>
          <span className="image-editor-prompt image-editor-prompt--single">
            <span>+</span>
            <span>提示词</span>
          </span>
          <figure className="image-editor-photo image-editor-photo--result image-editor-photo--single-result">
            <img src="/tutorials/image-editor/single-result.png" alt="女性手持同款香水瓶的编辑结果" />
          </figure>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-product">
            <img src="/tutorials/image-editor/merge-product.png" alt="椭圆形粉色香水瓶白底素材" />
          </figure>
          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-scene">
            <img src="/tutorials/image-editor/merge-scene.png" alt="新中式牡丹场景素材" />
          </figure>
          <svg className="image-editor-arrow image-editor-arrow--merge" viewBox="0 0 128 74" aria-hidden="true" focusable="false">
            <defs>
              <marker id="image-editor-arrow-tip-merge" viewBox="0 0 22 22" refX="19" refY="11" markerWidth="5.4" markerHeight="5.4" orient="auto">
                <path className="image-editor-arrow__tip" d="M3 2.6 19 11 3 19.4 7.4 11Z" />
              </marker>
            </defs>
            <path className="image-editor-arrow__halo" pathLength={1} d="M7 50C37 21 84 18 111 36" />
            <path className="image-editor-arrow__path" pathLength={1} d="M7 50C37 21 84 18 111 36" markerEnd="url(#image-editor-arrow-tip-merge)" />
            <path className="image-editor-arrow__shine" pathLength={1} d="M7 50C37 21 84 18 111 36" />
          </svg>
          <span className="image-editor-prompt image-editor-prompt--merge">
            <span>+</span>
            <span>提示词</span>
          </span>
          <figure className="image-editor-photo image-editor-photo--result image-editor-photo--merge-result">
            <img src="/tutorials/image-editor/merge-result.png" alt="香水瓶放入新中式牡丹场景后的融合结果" />
          </figure>
        </div>
      </div>
    </PreviewState>
  );
}

const videoTutorialPromptText = "雨天城市街头，女生撑透明雨伞缓慢向前行走，并自然回头看向镜头。";
const videoTutorialResultVideoSrc = "/tutorials/video-generator/demo-result.mp4";

type VideoTutorialImagePhase = "hidden" | "dragging" | "landed";
type VideoTutorialPlaybackState =
  | "final"
  | "idle"
  | "image-entering"
  | "image-touching"
  | "image-covered"
  | "typing"
  | "arrow-to-parameters"
  | "parameters"
  | "arrow-to-result"
  | "result-preparing"
  | "result-entering"
  | "result-playing"
  | "complete"
  | "resetting"
  | "fading-out";

function createTutorialTimeline() {
  const timers: number[] = [];

  return {
    wait(callback: () => void, delay: number) {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
      return timer;
    },
    clear() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.length = 0;
    },
  };
}

function isVideoTutorialImageLandedState(playbackState: VideoTutorialPlaybackState) {
  return !["idle", "image-entering", "image-touching"].includes(playbackState);
}

function isVideoTutorialPromptVisibleState(playbackState: VideoTutorialPlaybackState) {
  return !["idle", "image-entering", "image-touching", "image-covered"].includes(playbackState);
}

function isVideoTutorialParameterVisibleState(playbackState: VideoTutorialPlaybackState) {
  return ["final", "parameters", "arrow-to-result", "result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out"].includes(playbackState);
}

function isVideoTutorialResultVisibleState(playbackState: VideoTutorialPlaybackState) {
  return Boolean(playbackState);
}

function isVideoTutorialResultPlayingState(playbackState: VideoTutorialPlaybackState) {
  return ["result-preparing", "result-entering", "result-playing"].includes(playbackState);
}

function VideoTutorialInputDemo({
  playbackState,
  promptText,
}: {
  playbackState: VideoTutorialPlaybackState;
  promptText: string;
}) {
  const demoRef = useRef<HTMLDivElement | null>(null);
  const imagePhase: VideoTutorialImagePhase = isVideoTutorialImageLandedState(playbackState)
    ? "landed"
    : playbackState === "image-entering" || playbackState === "image-touching"
      ? "dragging"
      : "hidden";
  const targetState = playbackState === "image-touching" ? "touching" : imagePhase === "landed" ? "covered" : "idle";
  const promptBubbleVisible = isVideoTutorialPromptVisibleState(playbackState);

  return (
    <div ref={demoRef} className="video-tutorial-input-demo">
      <div className="tutorial-upload-placeholder">
        <UploadCloud aria-hidden="true" />
        <span>上传图片</span>
      </div>
      <span
        className={cn(
          "tutorial-upload-target-ring",
          targetState === "touching" && "is-touching",
          targetState === "covered" && "is-covered",
        )}
        aria-hidden="true"
      />

      <img
        src="/tutorials/video-generator/input-person.png"
        alt=""
        className={cn(
          "tutorial-source-image",
          imagePhase === "dragging" && "is-dragging",
          imagePhase === "landed" && "is-visible",
        )}
      />

      <div className={cn("tutorial-prompt-bubble", promptBubbleVisible && "is-visible")}>
        {promptText}
        {promptBubbleVisible && playbackState === "typing" && promptText.length < videoTutorialPromptText.length ? <span className="typing-caret" /> : null}
      </div>
    </div>
  );
}

function VideoTutorialResultSlot({
  playbackState,
  paused,
  onPlaybackEnd,
}: {
  playbackState: VideoTutorialPlaybackState;
  paused: boolean;
  onPlaybackEnd: () => void;
}) {
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [isInView, setIsInView] = useState(typeof IntersectionObserver === "undefined");
  const shouldPlay = Boolean(videoTutorialResultVideoSrc && !paused && isVideoTutorialResultPlayingState(playbackState) && isInView);

  useEffect(() => {
    const node = mediaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, { threshold: 0.36 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (shouldPlay) {
      if (!wasPlayingRef.current) {
        try {
          video.currentTime = Math.min(0.1, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.1);
        } catch {
          // Metadata may still be settling on first load; playback can still begin muted.
        }
        wasPlayingRef.current = true;
      }
      void video.play().catch(() => undefined);
      return;
    }

    wasPlayingRef.current = false;
    video.pause();
  }, [shouldPlay]);

  return (
    <div className="video-tutorial-result-slot">
      <div className="video-tutorial-result-slot__backdrop" aria-hidden="true">
        <img src="/tutorials/video-generator/input-person.png" alt="" />
      </div>
      <div
        ref={mediaRef}
        className={cn(
          "video-tutorial-result-slot__media",
          isVideoTutorialResultVisibleState(playbackState) && "is-visible",
          isVideoTutorialResultPlayingState(playbackState) && "is-playing",
          playbackState === "complete" && "is-complete",
          playbackState === "resetting" && "is-resetting",
        )}
      >
        {videoTutorialResultVideoSrc ? (
          <video
            ref={videoRef}
            src={videoTutorialResultVideoSrc}
            poster="/tutorials/video-generator/rain-umbrella.png"
            muted
            playsInline
            preload="auto"
            onEnded={onPlaybackEnd}
            onError={onPlaybackEnd}
          />
        ) : (
          <video poster="/tutorials/video-generator/input-person.png" muted playsInline preload="metadata" aria-label="视频结果预留位" />
        )}
      </div>
    </div>
  );
}

function VideoTutorialParameterDemo({
  playbackState,
}: {
  playbackState: VideoTutorialPlaybackState;
}) {
  const showParameters = isVideoTutorialParameterVisibleState(playbackState);

  return (
    <div className={cn("video-tutorial-parameter-demo", showParameters && "is-active")}>
      <div className="video-tutorial-parameter-demo__preview">
        <img src="/tutorials/video-generator/rain-umbrella.png" alt="" />
      </div>
      <div className="video-tutorial-parameter-demo__assets" aria-label="示例参数">
        <span className="video-tutorial-parameter-demo__asset" aria-label="5 秒">
          <span className="video-tutorial-parameter-demo__asset-icon is-duration" aria-hidden="true" />
          <strong>5s</strong>
        </span>
        <span className="video-tutorial-parameter-demo__asset" aria-label="720P">
          <span className="video-tutorial-parameter-demo__asset-icon is-resolution" aria-hidden="true" />
          <strong>720P</strong>
        </span>
        <span className="video-tutorial-parameter-demo__asset" aria-label="4:3">
          <span className="video-tutorial-parameter-demo__asset-icon is-ratio" aria-hidden="true" />
          <strong>4:3</strong>
        </span>
      </div>
    </div>
  );
}

function VideoGenerationTutorial({ paused = false }: { paused?: boolean }) {
  const guideRef = useRef<HTMLDivElement | null>(null);
  const replayTimerRef = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const [playbackStateState, setPlaybackState] = useState<VideoTutorialPlaybackState>("idle");
  const [typedTextState, setTypedText] = useState("");
  const [isInView, setIsInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const shouldPause = paused || reducedMotion || !isInView || !pageVisible;
  const playbackState = reducedMotion ? "final" : playbackStateState;
  const typedText = reducedMotion ? videoTutorialPromptText : typedTextState;
  const promptText = reducedMotion ? videoTutorialPromptText : typedText;

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = undefined;
    }
  }, []);

  const finishTutorialCycle = useCallback(() => {
    if (shouldPause || reducedMotion || playbackStateState !== "result-playing") return;

    clearReplayTimer();
    setPlaybackState("complete");
    setTypedText(videoTutorialPromptText);
    replayTimerRef.current = window.setTimeout(() => {
      setPlaybackState("resetting");
      replayTimerRef.current = window.setTimeout(() => {
        setPlaybackState("fading-out");
        replayTimerRef.current = window.setTimeout(() => {
          replayTimerRef.current = undefined;
          setPlaybackState("idle");
          setTypedText("");
          setCycle((value) => value + 1);
        }, 520);
      }, 760);
    }, 900);
  }, [clearReplayTimer, playbackStateState, reducedMotion, shouldPause]);

  useEffect(() => {
    if (playbackStateState !== "resetting") return undefined;

    const timer = window.setTimeout(() => {
      const video = guideRef.current?.querySelector<HTMLVideoElement>(".video-tutorial-result-slot__media video");
      if (!video) return;
      try {
        video.pause();
        video.currentTime = 0.1;
      } catch {
        // The video may already be unloading between tutorial loops.
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [playbackStateState]);

  useEffect(() => {
    const node = guideRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, { threshold: 0.18 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncPageVisibility = () => setPageVisible(document.visibilityState === "visible");

    syncPageVisibility();
    document.addEventListener("visibilitychange", syncPageVisibility);
    return () => document.removeEventListener("visibilitychange", syncPageVisibility);
  }, []);

  useEffect(() => {
    if (shouldPause) {
      clearReplayTimer();
      return undefined;
    }

    let stopped = false;
    let typingTimer: number | undefined;
    const timeline = createTutorialTimeline();

    const stopTyping = () => {
      if (typingTimer) {
        window.clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };

    const wait = (callback: () => void, delay: number) => {
      timeline.wait(() => {
        if (!stopped) callback();
      }, delay);
    };

    const play = () => {
      if (stopped) return;

      stopTyping();
      clearReplayTimer();
      setPlaybackState("idle");
      setTypedText("");

      wait(() => setPlaybackState("image-entering"), 360);
      wait(() => setPlaybackState("image-touching"), 1350);
      wait(() => setPlaybackState("image-covered"), 2700);
      wait(() => {
        setPlaybackState("typing");
        setTypedText(videoTutorialPromptText.slice(0, 1));

        let index = 1;
        typingTimer = window.setInterval(() => {
          index += 1;
          setTypedText(videoTutorialPromptText.slice(0, index));

          if (index >= videoTutorialPromptText.length) {
            stopTyping();
            setTypedText(videoTutorialPromptText);
            wait(() => setPlaybackState("arrow-to-parameters"), 260);
            wait(() => setPlaybackState("parameters"), 1160);
            wait(() => setPlaybackState("arrow-to-result"), 2140);
            wait(() => setPlaybackState("result-preparing"), 2960);
            wait(() => setPlaybackState("result-entering"), 3060);
            wait(() => setPlaybackState("result-playing"), 3240);
          }
        }, 54);
      }, 2880);
    };

    play();

    return () => {
      stopped = true;
      timeline.clear();
      clearReplayTimer();
      stopTyping();
    };
  }, [clearReplayTimer, cycle, shouldPause]);

  useEffect(() => () => clearReplayTimer(), [clearReplayTimer]);

  const steps = [
    {
      id: "upload",
      title: "输入内容并确认视频场景",
      description: "上传参考图后输入提示词，让视频围绕起始画面和动作描述生成。",
      visual: <VideoTutorialInputDemo key={`input-${cycle}`} playbackState={playbackState} promptText={promptText} />,
      visualSide: "left",
    },
    {
      id: "prompt",
      title: "调整视频参数",
      description: "根据需要确认时长、清晰度和比例，让结果更贴近当前创意。",
      visual: <VideoTutorialParameterDemo playbackState={playbackState} />,
      visualSide: "right",
    },
    {
      id: "result",
      title: "生成视频并查看结果",
      description: "生成完成后在这里预览视频结果，需要时可以下载或重新生成。",
      visual: <VideoTutorialResultSlot playbackState={playbackState} paused={shouldPause} onPlaybackEnd={finishTutorialCycle} />,
      visualSide: "left",
    },
  ];
  const firstArrowDrawing = playbackState === "arrow-to-parameters";
  const firstArrowDrawn = ["parameters", "arrow-to-result", "result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);
  const secondArrowDrawing = playbackState === "arrow-to-result";
  const secondArrowDrawn = ["result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);

  return (
    <PreviewState eyebrow="快速教程" title="视频生成快速教程" description="上传参考图，输入提示词，确认比例后生成视频。">
      <div
        ref={guideRef}
        className={cn(
          "video-tutorial-guide",
          reducedMotion && "is-reduced-motion",
          firstArrowDrawing && "is-drawing-first-arrow",
          firstArrowDrawn && "is-first-arrow-drawn",
          secondArrowDrawing && "is-drawing-second-arrow",
          secondArrowDrawn && "is-second-arrow-drawn",
        )}
        data-playback-state={playbackState}
      >
        {steps.map((step, index) => (
          <article key={step.id} className={cn("video-tutorial-guide__section", step.visualSide === "right" && "is-visual-right")}>
            <div className="video-tutorial-guide__visual">
              {step.visual}
            </div>
            <div className="video-tutorial-guide__copy">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
            </div>
            {index < steps.length - 1 ? (
              <svg className="video-tutorial-guide__arrow" viewBox="0 0 64 44" aria-hidden="true" focusable="false">
                <path className="video-tutorial-guide__arrow-path" d="M7 7C22 31 41 36 55 25" />
                <path className="video-tutorial-guide__arrow-head" d="M45 23L56 25L50 35" />
              </svg>
            ) : null}
          </article>
        ))}
      </div>
    </PreviewState>
  );
}

function ToolTutorial({ kind, paused = false }: { kind: ToolTutorialKind; paused?: boolean }) {
  if (kind === "image") {
    return <ImageGenerationTutorial />;
  }

  if (kind === "image-editor") {
    return <ImageEditorTutorial />;
  }

  if (kind === "video") {
    return <VideoGenerationTutorial paused={paused} />;
  }

  const tutorial = toolTutorials[kind];

  return (
    <PreviewState eyebrow="快速教程" title={tutorial.title} description={tutorial.description}>
      <div className="studio-walkthrough">
        {tutorial.sections.map((section, index) => (
          <article key={section.title} className={cn("studio-walkthrough__section", section.mediaSide === "right" && "is-media-right")}>
            <div className={cn("studio-walkthrough__visual", section.visualClassName)}>
              <div className="studio-walkthrough__canvas" aria-hidden="true">
                {section.layers.map((layer) => (
                  layer.type === "video" ? (
                    <div key={layer.src} className={cn("studio-walkthrough__layer", layer.className)}>
                      <video src={layer.src} poster={layer.poster} autoPlay muted loop playsInline preload="metadata" />
                      {layer.poster ? <img className="studio-walkthrough__video-poster" src={layer.poster} alt="" /> : null}
                    </div>
                  ) : (
                    <img key={layer.src} src={layer.src} alt={layer.alt} className={cn("studio-walkthrough__layer", layer.className)} />
                  )
                ))}
                {section.bubbles?.map((bubble) => (
                  <span key={bubble.text} className={cn("studio-walkthrough__bubble", bubble.className)}>{bubble.text}</span>
                ))}
                {section.tags?.map((tag) => (
                  <span key={tag.text} className={cn("studio-walkthrough__tag", tag.className)}>{tag.text}</span>
                ))}
                {(section.bubbles?.length || section.visualClassName?.includes("flow")) ? (
                  <span className="studio-walkthrough__arrow" />
                ) : null}
              </div>
            </div>
            <div className="studio-walkthrough__copy">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{section.title}</h4>
              <p>{section.description}</p>
            </div>
          </article>
        ))}
      </div>
    </PreviewState>
  );
}

function ProcessingPreview({ label }: { label: string }) {
  return (
    <PreviewState eyebrow="处理中" title={label} role="status" live>
      <div className="studio-processing-state">
        <div className="studio-processing-orbit" aria-hidden="true">
          <span />
          <span />
          <Loader2 className="size-6" />
        </div>
        <p>{label}</p>
      </div>
    </PreviewState>
  );
}

function ErrorPreview({
  canRetry,
  onRetry,
  onReloadProviders,
}: {
  canRetry: boolean;
  onRetry: () => void;
  onReloadProviders?: () => Promise<void>;
}) {
  return (
    <PreviewState eyebrow="失败" title="生成失败" description="生成失败，请检查设置后重试" role="alert">
      <div className="studio-preview__empty">
        <div className="studio-actions">
          {onReloadProviders ? (
            <button type="button" className="studio-secondary-button" onClick={() => void onReloadProviders()}>
              重新加载模型
            </button>
          ) : null}
          <button type="button" className="studio-secondary-button" onClick={onRetry} disabled={!canRetry}>
            重试
          </button>
        </div>
      </div>
    </PreviewState>
  );
}

function UpscaleUnavailablePreview() {
  return (
    <PreviewState eyebrow="暂不可用" title="高清处理暂时不可用" description="高清处理暂时不可用，请稍后重试" role="alert">
      <div className="studio-preview__empty">
        <p>请稍后重试。</p>
      </div>
    </PreviewState>
  );
}

function ImageUpscaleCompareTutorial() {
  return (
    <PreviewState eyebrow="图片细节对比" title="图片细节对比" description="拖动分割线，查看高清前后的清晰度和细节变化。">
      <BeforeAfterImageCompare
        beforeSrc="/tutorial/image-upscaler/image-before.jpg"
        afterSrc="/tutorial/image-upscaler/image-after.png"
        beforeLabel="高清前"
        afterLabel="高清后"
        beforeAlt="高清前示例图"
        afterAlt="高清后示例图"
      />
    </PreviewState>
  );
}

function VideoUpscaleCompareTutorial() {
  return (
    <PreviewState eyebrow="视频细节对比" title="视频细节对比" description="拖动分割线，查看高清前后的视频清晰度和细节变化。">
      <BeforeAfterImageCompare
        beforeSrc="/tutorial/video-upscaler/video-after.mp4"
        afterSrc="/tutorial/video-upscaler/video-after.mp4"
        beforeLabel="高清前"
        afterLabel="高清后"
        beforeAlt="高清前示例视频"
        afterAlt="高清后示例视频"
        mediaType="video"
        beforeEffect="blur"
      />
    </PreviewState>
  );
}

function ImageUpscalePreviewPanel({
  state,
  output,
  canSubmit,
  onSubmit,
}: {
  state: ImageUpscaleWorkspaceState;
  output: OutputState;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const source = state.file;

  if (state.loading) {
    return <ProcessingPreview label="正在处理" />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <ImageUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview />;
  }

  if (output?.item.output?.url) {
    const params = output.item.params;
    const sourceSize = typeof params.sourceWidth === "number" && typeof params.sourceHeight === "number"
      ? `${params.sourceWidth} x ${params.sourceHeight}`
      : "未记录";
    const outputSize = typeof params.outputWidth === "number" && typeof params.outputHeight === "number"
      ? `${params.outputWidth} x ${params.outputHeight}`
      : "未记录";
    const resultScale = typeof params.scale === "number" ? `${params.scale}x` : `${state.scale}x`;
    return (
      <PreviewState eyebrow="结果" title="高清结果" description={`${state.scale}x 高清处理完成。`} badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        {source ? (
          <BeforeAfterImageCompare
            beforeSrc={source.previewUrl}
            afterSrc={output.item.output.url}
            beforeLabel="高清前"
            afterLabel="高清后"
            beforeAlt={source.file.name}
            afterAlt={output.item.title}
          />
        ) : (
          <figure className="studio-upscale-preview__figure">
            <span className="studio-upscale-preview__label">高清结果</span>
            <img src={output.item.output.url} alt={output.item.title} />
          </figure>
        )}
        <dl className="studio-upscale-stats" aria-label="图片高清结果信息">
          <div>
            <dt>原图尺寸</dt>
            <dd>{sourceSize}</dd>
          </div>
          <div>
            <dt>输出尺寸</dt>
            <dd>{outputSize}</dd>
          </div>
          <div>
            <dt>当前倍数</dt>
            <dd>{resultScale}</dd>
          </div>
        </dl>
        <div className="studio-actions">
          <a className="studio-secondary-button" href={output.item.output.url} download>
            下载结果图片
          </a>
          <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canSubmit}>
            再次增强
          </button>
        </div>
      </PreviewState>
    );
  }

  return <ImageUpscaleCompareTutorial />;
}

function VideoUpscalePreviewPanel({
  state,
  output,
  canSubmit,
  onSubmit,
}: {
  state: VideoUpscaleWorkspaceState;
  output: OutputState;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const source = state.file;

  if (state.loading || state.job?.status === "generating" || state.job?.status === "queued") {
    return <ProcessingPreview label="正在处理" />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <VideoUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview />;
  }

  if (output?.item.output?.url) {
    const params = output.item.params;
    const sourceSize = typeof params.sourceWidth === "number" && typeof params.sourceHeight === "number"
      ? `${params.sourceWidth} x ${params.sourceHeight}`
      : "未记录";
    const outputSize = typeof params.outputWidth === "number" && typeof params.outputHeight === "number"
      ? `${params.outputWidth} x ${params.outputHeight}`
      : "未记录";
    const resultScale = typeof params.scale === "number" ? `${params.scale}x` : `${state.scale}x`;
    return (
      <PreviewState eyebrow="结果" title="高清结果" description={`${state.scale}x 高清处理完成。`} badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        {source ? (
          <BeforeAfterImageCompare
            beforeSrc={source.previewUrl}
            afterSrc={output.item.output.url}
            beforeLabel="高清前"
            afterLabel="高清后"
            beforeAlt={source.file.name}
            afterAlt={output.item.title}
            mediaType="video"
          />
        ) : (
          <figure className="studio-upscale-preview__figure">
            <span className="studio-upscale-preview__label">高清结果</span>
            <video src={output.item.output.url} controls />
          </figure>
        )}
        <dl className="studio-upscale-stats" aria-label="视频高清结果信息">
          <div>
            <dt>原视频分辨率</dt>
            <dd>{sourceSize}</dd>
          </div>
          <div>
            <dt>输出分辨率</dt>
            <dd>{outputSize}</dd>
          </div>
          <div>
            <dt>当前倍数</dt>
            <dd>{resultScale}</dd>
          </div>
        </dl>
        <div className="studio-actions">
          <a className="studio-secondary-button" href={output.item.output.url} download>
            下载结果视频
          </a>
          <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canSubmit}>
            再次增强
          </button>
        </div>
      </PreviewState>
    );
  }

  return <VideoUpscaleCompareTutorial />;
}

function VideoUpscaleForm({
  state,
  canSubmit,
  onScaleChange,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onSubmit,
  registerMobileAction,
}: {
  state: VideoUpscaleWorkspaceState;
  canSubmit: boolean;
  onScaleChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: () => void;
  onFilesClear: () => void;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const file = state.file;
  const processing = state.loading || state.job?.status === "queued" || state.job?.status === "generating";

  useEffect(() => {
    registerMobileAction({
      label: processing ? "正在增强" : "开始增强",
      loading: processing,
      disabled: !canSubmit || processing,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, onSubmit, processing, registerMobileAction]);

  return (
    <FormPanel>
      <FieldFrame label="视频" required>
        <CompactDropzone
          inputRef={inputRef}
          inputId="video-upscale-input"
          accept="video/mp4,video/webm,video/quicktime"
          multiple={false}
          dragging={dragging}
          files={file ? [{
            name: file.file.name,
            size: file.file.size,
            previewUrl: file.previewUrl,
            mediaType: "video",
          }] : []}
          emptyTitle="上传视频"
          filledTitle="已选择视频"
          helpText="支持常见视频格式"
          onFiles={onFilesChange}
          onRemove={file ? () => onFileRemove() : undefined}
          onClear={file ? onFilesClear : undefined}
          onDraggingChange={setDragging}
        />
        {state.fileError ? <p className="studio-error-text" role="alert">{state.fileError}</p> : null}
      </FieldFrame>

      <StackedControl label="放大倍数" required>
        <ModeSegmentedControl
          label="放大倍数"
          labelHidden
          groupId="video-upscale-scale"
          value={state.scale}
          options={[
            ["2", "2x"],
            ["4", "4x"],
          ]}
          onChange={onScaleChange}
        />
      </StackedControl>

      {state.checked && !state.statusLoading && !state.availability?.ready ? (
        <p className="studio-error-text" role="alert">{upscaleUnavailableMessage}</p>
      ) : null}

      <StickyPrimaryAction>
        <SubmitButton disabled={!canSubmit || processing} loading={processing} loadingLabel="正在增强" onClick={onSubmit}>
          开始增强
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function LibraryWorkspace({
  items,
  totalCount,
  count,
  selectedItem,
  loading,
  error,
  isAuthenticated,
  filter,
  sort,
  search,
  deletingItemId,
  removingItemId,
  missingMediaIds,
  onFilterChange,
  onSortChange,
  onSearchChange,
  onSelectItem,
  onDelete,
  onRefresh,
  onMediaMissing,
  onLogin,
  onStartCreate,
}: {
  items: LibraryItem[];
  totalCount: number;
  count: { all: number; image: number; video: number };
  selectedItem: LibraryItem | null;
  loading: boolean;
  error: string;
  isAuthenticated: boolean;
  filter: LibraryFilter;
  sort: LibrarySort;
  search: string;
  deletingItemId: string | null;
  removingItemId: string | null;
  missingMediaIds: Set<string>;
  onFilterChange: (value: LibraryFilter) => void;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
  onSelectItem: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onMediaMissing: (id: string) => void;
  onLogin: () => void;
  onStartCreate: () => void;
}) {
  const searchActive = Boolean(search.trim());
  const filteredEmpty = !items.length && (totalCount > 0 || searchActive);

  return (
    <div className="studio-library-page">
      <header className="studio-library-page__header">
        <div>
          <h2>作品库</h2>
          <p>管理和查看你生成的全部图片与视频</p>
        </div>
        <span className="studio-library-page__count">共 {totalCount} 件作品</span>
      </header>

      <div className="studio-library-page__controls">
        <LibraryKindTabs count={count} filter={filter} onFilterChange={onFilterChange} />
        <LibraryToolbar
          sort={sort}
          search={search}
          onSortChange={onSortChange}
          onSearchChange={onSearchChange}
        />
      </div>

      {loading ? (
        <div className="studio-library-skeleton-grid" role="status" aria-label="正在加载作品">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="studio-library-skeleton-card"
              style={{ "--library-card-delay": `${index < 6 ? index * 28 : 0}ms` } as CSSProperties}
            >
              <span className="motion-skeleton-shimmer" />
              <strong className="motion-skeleton-shimmer" />
              <small className="motion-skeleton-shimmer" />
            </div>
          ))}
        </div>
      ) : error ? (
        <LibraryEmptyState
          tone="error"
          title="作品加载失败"
          description="请检查网络后重试"
          actionLabel="重新加载"
          onAction={() => void onRefresh()}
        />
      ) : !items.length ? (
        !isAuthenticated ? (
          <LibraryEmptyState
            title="登录后查看你的作品"
            description="你生成的图片和视频会自动保存在这里，方便随时预览、下载和继续创作。"
            actionLabel="登录查看作品"
            onAction={onLogin}
          />
        ) : filteredEmpty ? (
          <LibraryEmptyState
            title="没有匹配的作品"
            description={`当前${filter === "image" ? "图片" : "视频"}分类下没有找到符合条件的作品。`}
            actionLabel={searchActive ? "清空搜索" : undefined}
            onAction={searchActive ? () => onSearchChange("") : undefined}
            secondaryLabel="刷新作品库"
            onSecondary={() => void onRefresh()}
          />
        ) : (
          <LibraryEmptyState
            title="还没有生成作品"
            description="完成第一次图片或视频生成后，作品会自动出现在这里。"
            actionLabel="开始创作"
            onAction={onStartCreate}
            secondaryLabel="刷新作品库"
            onSecondary={() => void onRefresh()}
          />
        )
      ) : (
        <div className="studio-library-grid">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "studio-library-tile",
                selectedItem?.id === item.id && "is-active",
                deletingItemId === item.id && "is-deleting",
                removingItemId === item.id && "is-removing",
              )}
              style={{ "--library-card-delay": `${index < 6 ? index * 28 : 0}ms` } as CSSProperties}
            >
              <button
                type="button"
                className="studio-library-tile__preview"
                onClick={() => onSelectItem(item.id)}
                aria-label={`预览作品 ${item.title}`}
              >
                <MediaCard
                  item={item}
                  mediaMissing={missingMediaIds.has(item.id) || item.fileAvailable === false}
                  onMediaMissing={() => onMediaMissing(item.id)}
                />
              </button>
              <LibraryCardActions
                item={item}
                mediaMissing={missingMediaIds.has(item.id) || item.fileAvailable === false}
                deleting={deletingItemId === item.id}
                onPreview={() => onSelectItem(item.id)}
                onDelete={() => void onDelete(item.id)}
              />
            </div>
          ))}
        </div>
      )}

      {selectedItem ? (
        <div className="studio-library-modal" role="dialog" aria-modal="true" aria-label={selectedItem.title}>
          <div className="studio-library-modal__backdrop" onClick={() => onSelectItem(null)} />
          <div className="studio-library-detail">
            <button type="button" className="studio-icon-button studio-library-detail__close" aria-label="关闭预览" onClick={() => onSelectItem(null)}>
              <X className="size-4" aria-hidden="true" />
            </button>
            <MediaCard
              item={selectedItem}
              large
              mediaMissing={missingMediaIds.has(selectedItem.id) || selectedItem.fileAvailable === false}
              onMediaMissing={() => onMediaMissing(selectedItem.id)}
            />
            <div className="studio-actions">
              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => void onDelete(selectedItem.id)}
                disabled={deletingItemId === selectedItem.id}
              >
                {deletingItemId === selectedItem.id ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    删除中
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" aria-hidden="true" />
                    删除
                  </>
                )}
              </button>
              <button type="button" className="studio-secondary-button" onClick={() => void onRefresh()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                刷新
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LibraryDeleteConfirmDialog({
  item,
  deleting,
  onCancel,
  onConfirm,
}: {
  item: LibraryItem | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!item) return null;

  return (
    <div className="studio-library-confirm" role="dialog" aria-modal="true" aria-labelledby="library-delete-confirm-title">
      <button
        type="button"
        className="studio-library-confirm__backdrop"
        aria-label="取消删除"
        onClick={onCancel}
        disabled={deleting}
      />
      <section className="studio-library-confirm__card">
        <span className="studio-library-confirm__icon" aria-hidden="true">
          <Trash2 className="size-5" />
        </span>
        <div className="studio-library-confirm__copy">
          <p className="shell-eyebrow">删除作品</p>
          <h3 id="library-delete-confirm-title">确认删除这个作品？</h3>
          <p>
            作品「{item.title || "未命名作品"}」删除后会同步移除可删除的本地结果文件，操作完成后不能在作品库中恢复。
          </p>
        </div>
        <div className="studio-library-confirm__actions">
          <button type="button" className="studio-secondary-button" onClick={onCancel} disabled={deleting}>
            取消
          </button>
          <button type="button" className="studio-danger-button" onClick={onConfirm} disabled={deleting}>
            {deleting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                删除中
              </>
            ) : (
              <>
                <Trash2 className="size-4" aria-hidden="true" />
                确认删除
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryKindTabs({
  count,
  filter,
  onFilterChange,
}: {
  count: { all: number; image: number; video: number };
  filter: LibraryFilter;
  onFilterChange: (value: LibraryFilter) => void;
}) {
  return (
    <div className="studio-library-kind-tabs" role="group" aria-label="作品类型">
      {([
        ["image", "图片", count.image],
        ["video", "视频", count.video],
      ] as const).map(([id, label, value]) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter === id}
          className={cn("studio-library-kind-tab", filter === id && "is-active")}
          onClick={() => onFilterChange(id)}
        >
          <span>{label}</span>
          <strong>{value}</strong>
        </button>
      ))}
    </div>
  );
}

function LibraryToolbar({
  sort,
  search,
  onSortChange,
  onSearchChange,
}: {
  sort: LibrarySort;
  search: string;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="studio-library-toolbar">
      <div className="studio-library-toolbar__search">
        <Search className="size-4" aria-hidden="true" />
        <label className="studio-sr-only" htmlFor="library-search">查找作品</label>
        <input
          id="library-search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索作品"
          className="studio-input"
        />
      </div>
      <CustomSelect
        label="排序"
        value={sort}
        icon={<ArrowDownUp className="size-4" />}
        options={[
          { value: "recent", label: "最新" },
          { value: "title", label: "标题" },
        ]}
        onChange={(value) => onSortChange(value as LibrarySort)}
      />
    </div>
  );
}

function LibraryEmptyState({
  title,
  description,
  actionLabel,
  secondaryLabel,
  tone,
  onAction,
  onSecondary,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  secondaryLabel?: string;
  tone?: "error";
  onAction?: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className={cn("studio-library-empty-state", tone === "error" && "is-error")}>
      <div className="studio-library-empty-state__icon" aria-hidden="true">
        <ImageUp className="size-7" />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <div className="studio-library-empty-state__actions">
          {actionLabel && onAction ? (
            <button type="button" className="studio-primary-action studio-library-empty-state__primary" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button type="button" className="studio-secondary-button" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ImagePreviewPanel({
  mode,
  output,
  loading,
  submitError,
  isEditor,
  promptFilled,
  hasProvider,
  hasFiles,
  onSubmit,
  onReloadProviders,
  onUpscale,
}: {
  mode: WorkspaceImageMode;
  output: OutputState;
  loading: boolean;
  submitError: string;
  isEditor: boolean;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
}) {
  const canRetry = hasProvider && promptFilled && (mode === "text-to-image" || hasFiles) && !loading;

  if (loading) {
    return <ProcessingPreview label="正在生成图片" />;
  }

  if (submitError) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
      />
    );
  }

  if (output) {
    const resultContent = (
      <>
        <MediaCard item={output.item} large compact />
        <div className="studio-actions studio-actions--result">
          {output.item.output?.url ? (
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载图片
            </a>
          ) : null}
          <button
            type="button"
            className="studio-secondary-button"
            onClick={onSubmit}
            disabled={!canRetry}
          >
            再次生成
          </button>
          <button type="button" className="studio-secondary-button studio-secondary-button--accent" onClick={() => onUpscale(output.item)}>
            放大
          </button>
        </div>
      </>
    );

    return (
      <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        {isEditor ? resultContent : <ResultReveal className="studio-result-reveal">{resultContent}</ResultReveal>}
      </PreviewState>
    );
  }

  return <ToolTutorial kind={isEditor ? "image-editor" : "image"} />;
}

function VideoPreviewPanel({
  mode,
  output,
  loading,
  submitError,
  promptFilled,
  hasProvider,
  hasFiles,
  onSubmit,
  onReloadProviders,
  onUpscale,
}: {
  mode: WorkspaceVideoMode;
  output: OutputState;
  loading: boolean;
  submitError: string;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
}) {
  const canRetry = hasProvider && promptFilled && (mode === "text-to-video" || hasFiles) && !loading;

  if (loading) {
    return <ProcessingPreview label="正在生成视频" />;
  }

  if (submitError) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
      />
    );
  }

  if (output) {
    return (
      <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        <MediaCard item={output.item} large compact />
        <div className="studio-actions studio-actions--result">
          {output.item.output?.url ? (
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载视频
            </a>
          ) : null}
          <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canRetry}>
            再次生成
          </button>
          <button type="button" className="studio-secondary-button studio-secondary-button--accent" onClick={() => onUpscale(output.item)}>
            放大
          </button>
        </div>
      </PreviewState>
    );
  }

  return <ToolTutorial kind="video" paused={loading} />;
}

function OutputPanel({
  tool,
  output,
  libraryCount,
}: {
  tool: BusinessToolId;
  output: OutputState;
  libraryCount: number;
}) {
  const content = previewContent[tool];

  if (!output) {
    return (
      <PreviewState eyebrow="创作预览" title="创作预览" description={content.desc} badge={`${libraryCount} 条作品`}>
        <div className="studio-preview__media is-example">
          <span className="studio-example-badge">示例效果</span>
          <img src={content.image} alt={content.title} />
        </div>
        <div className="studio-steps">
          {content.notes.map((note, index) => (
            <div key={note} className="studio-step">
              <span>{index + 1}</span>
              <p>{note}</p>
            </div>
          ))}
        </div>
      </PreviewState>
    );
  }

  return (
    <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)}>
      <MediaCard item={output.item} large />
    </PreviewState>
  );
}

function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="studio-form-panel">
      <div className="studio-form-panel__content">{children}</div>
    </div>
  );
}

function MobileActionBar({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="studio-mobile-action">
      <button type="button" className="studio-primary-action studio-mobile-action__button" disabled={disabled} onClick={onClick}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
        {label}
      </button>
    </div>
  );
}

function FieldFrame({
  label,
  required,
  hint,
  action,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const showHint = !required && Boolean(hint);
  const hasMeta = showHint || Boolean(action);

  return (
    <div className="studio-field">
      <div className="studio-field__label">
        <span className="studio-field__label-text">
          {label}
          {required ? <span className="studio-required">*</span> : null}
        </span>
        {hasMeta ? (
          <div className="studio-field__meta">
            {showHint ? <span className="shell-chip">{hint}</span> : null}
            {action}
          </div>
        ) : null}
      </div>
      <div className="studio-field__body">{children}</div>
    </div>
  );
}

function StackedControl({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return <FieldFrame label={label} required={required}>{children}</FieldFrame>;
}

function AspectRatioSelector({
  label,
  value,
  options = ratios,
  onChange,
}: {
  label: string;
  value: string;
  options?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-ratio" role="group" aria-label={label}>
      {options.map((ratio) => (
        <button
          key={ratio}
          type="button"
          data-testid={`ratio-${ratio.replace(":", "-")}`}
          aria-pressed={value === ratio}
          onClick={() => onChange(ratio)}
          className={cn("studio-ratio__item", value === ratio && "is-active")}
        >
          <span className="studio-ratio__graphic" aria-hidden="true">
            <span className={cn("studio-ratio__shape", ratioShapeClass[ratio])} />
          </span>
          <span className="studio-ratio__label">{ratio}</span>
        </button>
      ))}
    </div>
  );
}

function CompactDropzone({
  inputRef,
  inputId,
  accept,
  multiple = true,
  dragging,
  error,
  files,
  emptyTitle,
  filledTitle,
  helpText,
  onFiles,
  onRemove,
  onClear,
  onDraggingChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputId: string;
  accept: string;
  multiple?: boolean;
  dragging?: boolean;
  error?: string;
  files: UploadFilePreview[];
  emptyTitle: string;
  filledTitle: string;
  helpText: string;
  onFiles: (files: File[]) => void;
  onRemove?: (index: number) => void;
  onClear?: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const helpId = `${inputId}-help`;
  const hasFiles = files.length > 0;
  const currentTitle = dragging ? "松开以上传" : hasFiles ? filledTitle : emptyTitle;

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onFiles(nextFiles);
  }, [onFiles]);

  return (
    <div className="studio-upload-group">
      <div
        className={cn("studio-upload", dragging && "is-dragging", hasFiles && "is-filled", error && "is-error")}
        role="button"
        tabIndex={0}
        aria-controls={inputId}
        aria-describedby={helpId}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          onDraggingChange?.(true);
        }}
        onDragLeave={() => onDraggingChange?.(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDraggingChange?.(false);
          applyFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          aria-label={currentTitle}
          aria-describedby={helpId}
          accept={accept}
          multiple={multiple}
          onChange={(event) => {
            applyFiles(event.target.files || []);
            event.currentTarget.value = "";
          }}
          className="studio-file-input"
        />
        <div className="studio-upload__icon" aria-hidden="true">
          <UploadCloud className="size-5" />
        </div>
        <div className="studio-upload__content">
          <strong>{currentTitle}</strong>
          <p id={helpId}>{helpText}</p>
          {dragging ? <span className="studio-upload__drop-hint">释放后自动读取文件</span> : null}
          {hasFiles && !dragging ? <span>点击区域可替换文件</span> : null}
        </div>
      </div>

      {hasFiles ? (
        <div className="studio-upload-list">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.size}-${index}`} className="studio-upload-item">
              {file.previewUrl ? (
                file.mediaType === "video"
                  ? <video src={file.previewUrl} controls />
                  : <img src={file.previewUrl} alt={file.name} />
              ) : (
                <span className="studio-upload-item__placeholder" aria-hidden="true">
                  <ImageUp className="size-5" />
                </span>
              )}
              <div>
                <strong>{file.name}</strong>
                <span>{formatFileSize(file.size)}</span>
              </div>
              {onRemove ? (
                <button type="button" className="studio-icon-button" aria-label={`删除 ${file.name}`} onClick={() => onRemove(index)}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {files.length > 1 && onClear ? (
            <button type="button" className="studio-secondary-button studio-upload-clear" onClick={onClear}>
              全部删除
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StickyPrimaryAction({ children, helpText }: { children: React.ReactNode; helpText?: string }) {
  return (
    <div className="studio-sticky-action">
      {children}
      {helpText ? <span className="studio-help-text">{helpText}</span> : null}
    </div>
  );
}

function PreviewState({
  title,
  description,
  badge,
  role,
  live,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  badge?: string;
  role?: "status" | "alert";
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-preview" role={role} aria-live={live ? "polite" : undefined}>
      <div className="studio-preview__top">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {badge ? <span className="shell-chip">{badge}</span> : null}
      </div>
      <div className="studio-preview__content">{children}</div>
    </div>
  );
}

function ModeSegmentedControl({
  label,
  labelHidden,
  groupId,
  value,
  options,
  onChange,
}: {
  label?: string;
  labelHidden?: boolean;
  groupId?: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-mode">
      {label ? (
        <span id={groupId ? `${groupId}-label` : undefined} className={cn("studio-label", labelHidden && "studio-sr-only")}>
          {label}
        </span>
      ) : null}
      <div className="studio-mode__options" role="group" aria-labelledby={label && groupId ? `${groupId}-label` : undefined}>
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            data-testid={`mode-${id}`}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn("studio-mode__button", value === id && "is-active")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomSelect({
  label,
  value,
  options,
  icon,
  disabled,
  placeholder = "请选择",
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  icon?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const listId = `${generatedId}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const availableBelow = window.innerHeight - rect.bottom;
      setOpenAbove(availableBelow < 280 && rect.top > availableBelow);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const enabledOptions = options.filter((option) => !option.disabled);
  const chooseOption = useCallback((option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }, [onChange]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (!enabledOptions.length) return;
    const currentValue = options[activeIndex]?.value;
    const enabledIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === currentValue));
    const nextEnabled = enabledOptions[(enabledIndex + direction + enabledOptions.length) % enabledOptions.length];
    const nextIndex = options.findIndex((option) => option.value === nextEnabled.value);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [activeIndex, enabledOptions, options]);

  return (
    <div className={cn("studio-custom-select", open && "is-open")}>
      <button
        ref={buttonRef}
        type="button"
        className="studio-custom-select__button"
        disabled={disabled || !options.length}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            const option = options[activeIndex];
            if (option) chooseOption(option);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {icon ? <span className="studio-custom-select__icon" aria-hidden="true">{icon}</span> : null}
        <span className="studio-custom-select__value">{selectedOption?.label || placeholder}</span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        ref={listRef}
        id={listId}
        className={cn("studio-custom-select__menu", openAbove && "is-above")}
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              tabIndex={open ? 0 : -1}
              className={cn("studio-custom-select__option", selected && "is-selected", active && "is-active")}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onClick={() => chooseOption(option)}
            >
              <span>{option.label}</span>
              {selected ? <Check className="size-4" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProviderSelect({
  providers,
  value,
  loading,
  error,
  onChange,
  onReload,
  label = "模型",
}: {
  providers: FrontendProvider[];
  value: string;
  loading?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReload?: () => Promise<void>;
  label?: string;
}) {
  const options = providers.map((provider) => ({
    value: provider.id,
    label: provider.displayName || provider.model,
  }));

  return (
    <FieldFrame label={label} required>
      <div className="studio-provider">
        <CustomSelect
          label={label}
          value={value}
          options={options}
          disabled={loading || Boolean(error)}
          placeholder={loading ? "正在读取模型" : "选择模型"}
          onChange={onChange}
        />
        {loading ? <p id="image-provider-status" className="studio-help-text" role="status" aria-live="polite">正在读取可用模型。</p> : null}
        {!loading && !error && !providers.length ? (
          <p id="image-provider-empty" className="studio-help-text" role="status" aria-live="polite">
            当前尚未配置可用模型。
          </p>
        ) : null}
        {error ? (
          <div id="image-provider-error" className="studio-inline-error" role="alert">
            <p>{error}</p>
            {onReload ? (
              <button type="button" className="studio-secondary-button" onClick={() => void onReload()}>
                重新加载
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </FieldFrame>
  );
}

function PromptBox({
  value,
  onChange,
  placeholder,
  required,
  optimizing,
  optimizeError,
  canUndoOptimize,
  onOptimize,
  onUndoOptimize,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  optimizing: boolean;
  optimizeError: string;
  canUndoOptimize: boolean;
  onOptimize: () => void;
  onUndoOptimize: () => void;
}) {
  return (
    <FieldFrame
      label="提示词"
      required={required}
      action={(
        <div className="studio-prompt-actions">
          <button
            type="button"
            className="studio-prompt-action studio-prompt-action--clear"
            onClick={() => onChange("")}
            disabled={!value}
            aria-label="清除提示词"
          >
            清除
          </button>
          <button
            type="button"
            className="studio-prompt-action"
            onClick={onOptimize}
            disabled={optimizing}
            aria-busy={optimizing}
          >
            {optimizing ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                正在优化…
              </>
            ) : (
              "✨ 优化提示词"
            )}
          </button>
          {canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize}>
              撤销优化
            </button>
          ) : null}
        </div>
      )}
    >
      <label className="studio-sr-only" htmlFor="image-prompt">
        提示词
      </label>
      <div className="studio-textarea-wrap">
        <textarea
          id="image-prompt"
          data-testid="prompt-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby="image-prompt-counter"
          className="studio-textarea"
        />
        <span id="image-prompt-counter" className="studio-counter">{value.length} 个字符</span>
      </div>
      {optimizeError ? <p className="studio-error-text" role="alert">{optimizeError}</p> : null}
    </FieldFrame>
  );
}

function SubmitButton({
  disabled,
  loading,
  loadingLabel,
  costLabel,
  children,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  loadingLabel?: string;
  costLabel?: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const label = loading ? loadingLabel || children : children;

  return (
    <button type="button" data-testid="primary-submit" disabled={disabled} onClick={onClick} className="studio-primary-action" aria-busy={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
      <span className="studio-primary-action__copy">
        <span>{label}</span>
        {!loading && costLabel ? <small>（{costLabel}）</small> : null}
      </span>
    </button>
  );
}

function LibraryCardActions({
  item,
  mediaMissing,
  deleting,
  onPreview,
  onDelete,
}: {
  item: LibraryItem;
  mediaMissing: boolean;
  deleting: boolean;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const canDownloadStoredFile = Boolean(item.output?.url && item.output.storedName && !mediaMissing);

  return (
    <div className="studio-library-tile__actions" aria-label="作品操作">
      <button type="button" onClick={onPreview}>
        <Eye className="size-4" aria-hidden="true" />
        预览
      </button>
      {canDownloadStoredFile ? (
        <a href={item.output?.url} download>
          <Download className="size-4" aria-hidden="true" />
          下载
        </a>
      ) : null}
      <button type="button" onClick={onDelete} disabled={deleting}>
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
        {deleting ? "删除中" : "删除"}
      </button>
    </div>
  );
}

function MediaCard({
  item,
  large = false,
  compact = false,
  mediaMissing = false,
  onMediaMissing,
}: {
  item: LibraryItem;
  large?: boolean;
  compact?: boolean;
  mediaMissing?: boolean;
  onMediaMissing?: () => void;
}) {
  const media = item.output;
  const hasMediaUrl = Boolean(media?.url) && !mediaMissing;
  const typeLabel = libraryModeLabel(item);
  const createdAt = formatDateTime(item.createdAt);
  const dimensionText = libraryDimensions(item);
  const scaleText = typeof item.params.scale === "number" || typeof item.params.scale === "string"
    ? `${item.params.scale}x`
    : "";
  const fileSizeText = typeof media?.size === "number" ? formatBytes(media.size) : "";
  const durationText = libraryDuration(item);
  const canDownloadStoredFile = Boolean(media?.storedName);
  const showActions = large && !compact;
  const showMediaControls = large;
  const showBody = !compact;
  const statusBadge = mediaMissing ? "文件失效" : libraryStatusBadgeLabel(item.status);
  return (
    <article className={cn("studio-media-card", compact && "is-compact")}>
      <div className={cn("studio-media-card__frame", large && "is-large")}>
        {hasMediaUrl && media?.url && item.type === "image" ? (
          <img src={media.url} alt={item.title} onError={onMediaMissing} />
        ) : null}
        {hasMediaUrl && media?.url && item.type === "video" ? (
          <video src={media.url} controls={showMediaControls} preload="metadata" onError={onMediaMissing} />
        ) : null}
        {!hasMediaUrl ? (
          <div className={cn("studio-media-card__missing", mediaMissing && "is-missing")}>
            <AlertTriangle className="size-5" aria-hidden="true" />
            <span>{mediaMissing ? "文件失效" : libraryStatusLabel(item.status)}</span>
          </div>
        ) : null}
        {!large && item.type === "video" && hasMediaUrl ? (
          <>
            <span className="studio-media-card__play" aria-hidden="true">
              <Play className="size-5" fill="currentColor" />
            </span>
            {durationText ? <span className="studio-media-card__duration">{durationText}</span> : null}
          </>
        ) : null}
      </div>
      {showBody ? <div className="studio-media-card__body">
        <div className="studio-media-card__head">
          <strong>{item.title}</strong>
          {statusBadge ? <span>{statusBadge}</span> : null}
        </div>
        <div className="studio-media-card__meta" aria-label="作品信息">
          <span>{typeLabel}</span>
          <span>{createdAt}</span>
          {durationText ? <span>{durationText}</span> : null}
          {scaleText ? <span>{scaleText}</span> : null}
          {dimensionText ? <span>{dimensionText}</span> : null}
          {fileSizeText ? <span>{fileSizeText}</span> : null}
        </div>
        {large && item.error ? <p>{item.error}</p> : null}
        {mediaMissing ? <p className="studio-inline-error" role="alert">结果文件不存在，作品记录仍保留，可刷新或删除。</p> : null}
        {showActions && media?.url && !mediaMissing ? (
          <div className="studio-media-card__actions">
            <a href={media.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              预览
            </a>
            {canDownloadStoredFile ? (
              <a href={media.url} download>
                <Download className="size-4" aria-hidden="true" />
                下载
              </a>
            ) : null}
          </div>
        ) : null}
      </div> : null}
    </article>
  );
}

function libraryModeLabel(item: LibraryItem) {
  if (item.mode === "text-to-image") return "图片生成";
  if (item.mode === "image-to-image") return "图片编辑";
  if (item.mode === "text-to-video") return "视频生成";
  if (item.mode === "image-to-video") return "图像生成视频";
  if (item.mode === "image-upscale") return "图片高清";
  if (item.mode === "video-upscale") return "视频高清";
  return item.type === "image" ? "图片作品" : "视频作品";
}

function libraryStatusLabel(status: LibraryItem["status"]) {
  if (status === "done") return "已完成";
  if (status === "queued") return "排队中";
  if (status === "generating") return "处理中";
  return "失败";
}

function libraryStatusBadgeLabel(status: LibraryItem["status"]) {
  return status === "done" ? undefined : libraryStatusLabel(status);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function libraryDimensions(item: LibraryItem) {
  const width = Number(item.params.outputWidth || item.params.sourceWidth || 0);
  const height = Number(item.params.outputHeight || item.params.sourceHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  return `${Math.round(width)}×${Math.round(height)}`;
}

function libraryDuration(item: LibraryItem) {
  const raw = item.params.durationSeconds || item.params.duration || item.params.videoDuration;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!minutes) return `0:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatElapsedClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ImageGenerationProgressToast({
  progress,
  tick,
  stacked,
  onClose,
}: {
  progress: NonNullable<ImageGenerationProgressState>;
  tick: number;
  stacked?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (progress.status === "running") return undefined;
    const timer = window.setTimeout(onClose, 5200);
    return () => window.clearTimeout(timer);
  }, [onClose, progress.status]);

  const total = Math.max(progress.total, 1);
  const completed = Math.min(Math.max(progress.current, 0), total);
  const activeIndex = progress.status === "running" ? Math.min(completed + 1, total) : completed;
  const elapsedMs = (progress.completedAt ?? tick) - progress.startedAt;
  const progressRatio = progress.status === "done"
    ? 1
    : Math.min(Math.max(completed / total, 0), 1);
  const title = progress.status === "done"
    ? "生成已完成"
    : progress.status === "failed"
      ? "生成失败"
      : "图片生成中";
  const statusText = progress.status === "running"
    ? `第 ${activeIndex} / ${total} 张`
    : progress.status === "done"
      ? `已完成 ${total} 张`
      : `已完成 ${completed} / ${total} 张`;

  return (
    <div
      className={cn(
        "image-generation-progress",
        `is-${progress.status}`,
        stacked && "is-stacked",
      )}
      role="status"
      aria-live="polite"
    >
      <span className="image-generation-progress__icon" aria-hidden="true">
        {progress.status === "done" ? <Check className="size-4" /> : null}
        {progress.status === "failed" ? <AlertTriangle className="size-4" /> : null}
        {progress.status === "running" ? <Loader2 className="size-4" /> : null}
      </span>
      <span className="image-generation-progress__body">
        <span className="image-generation-progress__head">
          <strong>{title}</strong>
          <button type="button" aria-label="关闭生成进度" onClick={onClose}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
        <small>{progress.message || statusText}</small>
        <span className="image-generation-progress__meta">
          <span>{statusText}</span>
          <span>用时 {formatElapsedClock(elapsedMs)}</span>
        </span>
        <span className="image-generation-progress__track" aria-hidden="true">
          <span style={{ width: `${Math.round(progressRatio * 100)}%` }} />
        </span>
      </span>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="studio-toast" role="status" aria-live="polite">
      <span className="studio-toast__icon" aria-hidden="true">
        <AlertTriangle className="size-4" />
      </span>
      <span className="studio-toast__body">
        <strong>{message}</strong>
        <small>请根据提示处理当前操作，必要时稍后再试。</small>
      </span>
    </div>
  );
}

const previewContent: Record<
  BusinessToolId,
  { title: string; desc: string; image: string; notes: string[] }
> = {
  image: {
    title: "AI 图像生成器",
    desc: "输入提示词并选择模型，生成结果会在这里显示。",
    image: "/images/reference/hero-cover.png",
    notes: ["填写提示词", "选择参考图或比例", "结果会保存在作品库"],
  },
  video: {
    title: "AI 视频生成器",
    desc: "输入视频描述，生成任务完成后会在这里显示。",
    image: "/images/reference/sample-1.png",
    notes: ["填写视频描述", "选择比例和时长", "轮询任务后展示结果"],
  },
  "image-upscale": {
    title: "图片高清",
    desc: "上传图像后选择倍数，结果会在这里显示。",
    image: "/images/reference/sample-2.png",
    notes: ["上传图像", "选择 2x 或 4x", "处理后进入作品库"],
  },
  "video-upscale": {
    title: "视频高清",
    desc: "上传视频后选择倍数，结果会在这里播放。",
    image: "/images/reference/sample-3.png",
    notes: ["上传视频", "选择 2x 或 4x", "处理后刷新作品库"],
  },
  library: {
    title: "作品库",
    desc: "历史结果、下载和删除逻辑保持不变。",
    image: "/images/reference/hero-cover.png",
    notes: ["查看历史", "下载结果", "删除不需要的作品"],
  },
};
