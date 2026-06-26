"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CalendarCheck, Check, Crown, CreditCard, ExternalLink, History, Sparkles, WalletCards } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { ImageGenerator } from "@/components/studio/image-generator";
import { jsonFetch } from "@/components/studio/json-fetch";
import { LibraryDeleteConfirmDialog, LibraryWorkspace } from "@/components/studio/library-view";
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
  formatQuotaUnits,
  grokVideo10Ratios,
  grokVideo15Ratios,
  grokVideoDurations,
  jimengVideoRatios,
  maxImageUpscaleSize,
  maxReferenceImageCount,
  maxReferenceImageSize,
  maxVideoFirstFrameCount,
  maxVideoUpscaleSize,
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
} from "@/components/studio/types";
import { ImageUpscaleForm, VideoUpscaleForm } from "@/components/studio/upscale-form";
import { VideoGenerator } from "@/components/studio/video-generator";
import { WorkspaceAccountPanel } from "@/components/workspace-account-panel";
import {
  getCheckInStatusDisplay,
  getPlanStatusDisplay,
  type CheckInStatus,
  type PlanStatus,
} from "@/lib/account-status";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import {
  estimateImageGenerationQuota,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
} from "@/lib/generation-quota";
import {
  templateById,
  templateTabHref,
} from "@/lib/template-catalog";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { BillingOrder } from "@/lib/server/billing";
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
    scale: "1",
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
  const accountPlanStatus = useMemo<PlanStatus>(() => {
    if (sessionLoading) return { status: "loading" };
    return { status: "unavailable" };
  }, [sessionLoading]);
  const accountCheckInStatus = useMemo<CheckInStatus>(() => {
    if (sessionLoading) return "loading";
    return "unavailable";
  }, [sessionLoading]);

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
        setAccountDataError("account-data-unavailable");
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
    <div className="workspace-account-chip hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/68 md:flex">
      <span>{sessionUser ? sessionUser.display_name : "未登录"}</span>
      <span className="text-white/38">/</span>
      <strong className="text-white">{sessionLoading || accountLoading ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} ✦` : "—"}</strong>
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
        accountPointsLabel={sessionLoading || accountLoading ? "加载中" : quotaSnapshot ? `${formatQuotaUnits(quotaSnapshot.quota_units)} ✦` : "—"}
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
              loading={sessionLoading || accountLoading}
              billingOrders={billingOrders}
              accountView={accountView}
              planStatus={accountPlanStatus}
              checkInStatus={accountCheckInStatus}
              onViewChange={setAccountView}
              onPaymentUnavailable={handlePaymentUnavailable}
              onCheckInUnavailable={handleCheckInUnavailable}
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
  const pointsStatusLabel = quota ? `${formatQuotaUnits(quota.quota_units)} ✦` : "—";
  const planStatusLabel = getPlanStatusDisplay(planStatus).label;
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
