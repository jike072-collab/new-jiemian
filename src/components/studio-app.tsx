"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownUp, Check, ChevronDown, Download, ExternalLink, ImageUp, ListFilter, Loader2, RefreshCw, Search, Trash2, UploadCloud, Wand2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { TemplateRail } from "@/components/template-center";
import { cn } from "@/lib/utils";
import {
  featuredImagePromptTemplates,
  featuredVideoPromptTemplates,
  templateById,
  templateTabHref,
} from "@/lib/template-catalog";
import type { JobRecord, LibraryItem, PublicProvider } from "@/lib/server/types";
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
  image: PublicProvider[];
  video: PublicProvider[];
};

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

const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
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
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data
      ? String((data as { error?: string }).error)
      : "请求失败。";
    throw new Error(error);
  }
  return data as T;
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

export function StudioApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toolParam = searchParams.get("tool");
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
  const [message, setMessage] = useState("");
  const [outputs, setOutputs] = useState<Partial<Record<BusinessToolId, OutputState>>>({});
  const [mobileAction, setMobileAction] = useState<MobileActionState>(null);
  const [mobilePreviewSignal, setMobilePreviewSignal] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("image");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("recent");
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [deletingLibraryItemId, setDeletingLibraryItemId] = useState<string | null>(null);
  const [missingLibraryMediaIds, setMissingLibraryMediaIds] = useState<Set<string>>(() => new Set());
  const [imageWorkspace, setImageWorkspace] = useState<ImageWorkspaceState>({
    providerId: "",
    ratio: "1:1",
    quality: "1k",
    templateId: featuredImagePromptTemplates[0]?.id || "",
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
    templateId: featuredVideoPromptTemplates[0]?.id || "",
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

    return () => {
      cancelled = true;
    };
  }, []);

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
  const markLibraryMediaMissing = useCallback((id: string) => {
    setMissingLibraryMediaIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const handleDeleteLibraryItem = useCallback(async (id: string) => {
    if (deletingLibraryItemId) return;
    const item = library.find((entry) => entry.id === id);
    const confirmed = window.confirm(`确认删除作品「${item?.title || "未命名作品"}」？删除后会同步移除可删除的本地结果文件。`);
    if (!confirmed) return;

    setDeletingLibraryItemId(id);
    setLibraryError("");
    try {
      await jsonFetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshLibrary();
      setSelectedLibraryItemId((current) => (current === id ? null : current));
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除失败。";
      setLibraryError(text);
      setMessage(text);
    } finally {
      setDeletingLibraryItemId(null);
    }
  }, [deletingLibraryItemId, library, refreshLibrary]);

  const libraryCounts = useMemo(() => ({
    all: library.length,
    image: library.filter((item) => item.type === "image").length,
    video: library.filter((item) => item.type === "video").length,
  }), [library]);

  const handleImageResult = useCallback((item: LibraryItem) => {
    setOutputs((prev) => ({ ...prev, image: { item, title: "图片结果", tool: "image" } }));
  }, []);

  const selectedImageProvider = useMemo(() => {
    if (!providers.image.length) return null;
    return providers.image.find((provider) => provider.id === imageWorkspace.providerId) || providers.image[0];
  }, [imageWorkspace.providerId, providers.image]);

  const imageWorkspaceFiles = imageWorkspace.files;
  const imageWorkspaceHasFiles = imageWorkspaceFiles.length > 0;
  const imageWorkspacePrompt = imageWorkspace.prompt.trim();
  const imageWorkspaceRequiresFile = activeImageTemplate?.scope === "image" && activeImageTemplate.requiresImage;
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
      updateImageWorkspace({
        promptOptimizeError: "请先填写提示词。",
        promptOptimizeUndo: "",
      });
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
          tool: activeImageMode,
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
    } catch {
      updateImageWorkspace({
        promptOptimizing: false,
        promptOptimizeUndo: "",
        promptOptimizeError: "优化失败，请稍后重试",
      });
    }
  }, [
    activeImageMode,
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

    setImageWorkspace((prev) => ({
      ...prev,
      loading: true,
      submitError: "",
      fileError: "",
    }));
    setMobilePreviewSignal((value) => value + 1);
    setMessage("");
    try {
      const form = new FormData();
      form.set("providerId", selectedImageProvider.id);
      form.set("mode", activeImageMode);
      form.set("ratio", imageWorkspace.ratio);
      form.set("quality", imageWorkspace.quality);
      form.set("prompt", imageWorkspace.prompt);
      imageWorkspace.files.forEach((attachment) => form.append("files", attachment.file));
      const data = await jsonFetch<{ item: LibraryItem }>("/api/generate/image", {
        method: "POST",
        body: form,
      });
      handleImageResult(data.item);
      await refreshLibrary();
    } catch (error) {
      const text = error instanceof Error ? error.message : "图片生成失败。";
      setImageWorkspace((prev) => ({
        ...prev,
        submitError: text,
      }));
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
    imageWorkspacePrompt,
    imageWorkspaceHasFiles,
    imageWorkspaceRequiresFile,
    refreshLibrary,
    selectedImageProvider,
    setMessage,
  ]);

  const handleVideoResult = useCallback((item: LibraryItem, job?: JobRecord | null) => {
    setOutputs((prev) => ({ ...prev, video: { item, job, title: "视频结果", tool: "video" } }));
  }, []);

  const selectedVideoProvider = useMemo(() => {
    if (!providers.video.length) return null;
    return providers.video.find((provider) => provider.id === videoWorkspace.providerId) || providers.video[0];
  }, [providers.video, videoWorkspace.providerId]);

  const videoWorkspaceFiles = videoWorkspace.files;
  const videoWorkspaceHasFiles = videoWorkspaceFiles.length > 0;
  const videoWorkspacePrompt = videoWorkspace.prompt.trim();
  const videoWorkspaceNeedsFile = activeVideoMode === "image-to-video";
  const videoWorkspaceRequiresFile = activeVideoTemplate?.scope === "video" && activeVideoTemplate.requiresImage;
  const videoWorkspaceCanSubmit = Boolean(selectedVideoProvider)
    && !providersLoading
    && !videoWorkspace.loading
    && Boolean(videoWorkspacePrompt)
    && (!videoWorkspaceNeedsFile || videoWorkspaceHasFiles)
    && (!videoWorkspaceRequiresFile || videoWorkspaceHasFiles);

  const updateVideoWorkspace = useCallback((patch: Partial<VideoWorkspaceState>) => {
    setVideoWorkspace((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyVideoPromptTemplate = useCallback((templateId: string) => {
    applyTemplatePreset(templateId);
  }, [applyTemplatePreset]);

  const optimizeVideoPrompt = useCallback(async () => {
    const prompt = videoWorkspace.prompt.trim();
    if (!prompt) {
      updateVideoWorkspace({
        promptOptimizeError: "请先填写提示词。",
        promptOptimizeUndo: "",
      });
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
    } catch {
      updateVideoWorkspace({
        promptOptimizing: false,
        promptOptimizeUndo: "",
        promptOptimizeError: "优化失败，请稍后重试",
      });
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
        fileError: "",
        submitError: "",
      };
    });
  }, []);

  const clearVideoWorkspaceFiles = useCallback(() => {
    videoWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    videoWorkspaceFilesRef.current = [];
    setVideoWorkspace((prev) => ({
      ...prev,
      files: [],
      fileError: "",
      submitError: "",
    }));
  }, []);

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
    if (videoWorkspace.loading) return;
    if ((videoWorkspaceRequiresFile || videoWorkspaceNeedsFile) && !videoWorkspaceHasFiles) {
      setVideoWorkspace((prev) => ({
        ...prev,
        fileError: "请先上传图像。",
      }));
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
      if (activeVideoMode === "image-to-video") {
        videoWorkspace.files.forEach((attachment) => form.append("files", attachment.file));
      }
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", {
        method: "POST",
        body: form,
      });
      updateVideoWorkspace({ job: data.job });
      handleVideoResult(data.item, data.job);
      await refreshLibrary();
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
    refreshLibrary,
    selectedVideoProvider,
    setMessage,
    updateVideoWorkspace,
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
          state={imageWorkspace}
          canSubmit={imageWorkspaceCanSubmit}
          onProviderChange={(value) => updateImageWorkspace({ providerId: value })}
          onRatioChange={(value) => updateImageWorkspace({ ratio: value })}
          onQualityChange={(value) => updateImageWorkspace({ quality: value })}
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
          state={videoWorkspace}
          canSubmit={videoWorkspaceCanSubmit}
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
      {activeBusinessTool === "library" ? (
        <LibrarySidebar
          count={libraryCounts}
          filter={libraryFilter}
          onFilterChange={setLibraryFilter}
        />
      ) : null}
    </>
  );

  return (
    <>
      <WorkbenchShell
        state={{ activeToolId: activeWorkspaceToolId }}
        onToolAction={handleToolAction}
        isAuthenticated={false}
        toolTitle={activeWorkspaceTool.label}
        parameterSlot={parameterSlot}
        mobilePreviewSignal={mobilePreviewSignal}
        previewSlot={
          activeBusinessTool === "library" ? (
            <LibraryWorkspace
              items={currentLibraryItems}
              totalCount={library.length}
              selectedItem={selectedLibraryItem}
              loading={libraryLoading}
              error={libraryError}
              filter={libraryFilter}
              sort={librarySort}
              search={librarySearch}
              deletingItemId={deletingLibraryItemId}
              missingMediaIds={missingLibraryMediaIds}
              onFilterChange={setLibraryFilter}
              onSortChange={setLibrarySort}
              onSearchChange={setLibrarySearch}
              onSelectItem={setSelectedLibraryItemId}
              onDelete={handleDeleteLibraryItem}
              onRefresh={refreshLibrary}
              onMediaMissing={markLibraryMediaMissing}
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
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
    </>
  );
}

function ImageGenerator({
  mode,
  showTemplates,
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  state,
  canSubmit,
  onProviderChange,
  onRatioChange,
  onQualityChange,
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
  providers: PublicProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: PublicProvider | null;
  state: ImageWorkspaceState;
  canSubmit: boolean;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
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
          viewAllHref={templateTabHref("image")}
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
      <StackedControl label="清晰度" required>
        <ModeSegmentedControl
          label="清晰度"
          labelHidden
          groupId="image-quality"
          value={state.quality}
          options={[
            ["1k", "1K"],
            ["2k", "2K"],
          ]}
          onChange={onQualityChange}
        />
      </StackedControl>
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
        <SubmitButton disabled={!canSubmit} loading={state.loading} loadingLabel={meta.loadingLabel} onClick={onSubmit}>
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
  state,
  canSubmit,
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
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceVideoMode;
  providers: PublicProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: PublicProvider | null;
  state: VideoWorkspaceState;
  canSubmit: boolean;
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
        viewAllHref={templateTabHref("video")}
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
        onChange={onFilesChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
      />
      <StackedControl label="比例" required>
        <AspectRatioSelector label="比例" value={state.ratio} onChange={onRatioChange} />
      </StackedControl>
      <FieldFrame label="时长" required>
        <CustomSelect
          label="时长"
          value={String(state.duration)}
          options={[5, 8, 10, 15].map((value) => ({
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
        <SubmitButton disabled={!canSubmit} loading={state.loading} onClick={onSubmit}>
          {state.loading ? meta.loadingLabel : meta.submitLabel}
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
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <FieldFrame label={label} hint={mode === "image-to-video" ? "已上传" : "可选"}>
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

function ToolTutorial({ kind }: { kind: ToolTutorialKind }) {
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
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <ToolTutorial kind="image-upscale" />;
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
        <div className="studio-upscale-preview">
          {source ? (
            <figure className="studio-upscale-preview__figure">
              <span className="studio-upscale-preview__label">原图</span>
              <img src={source.previewUrl} alt={source.file.name} />
            </figure>
          ) : null}
          <figure className="studio-upscale-preview__figure">
            <span className="studio-upscale-preview__label">高清结果</span>
            <img src={output.item.output.url} alt={output.item.title} />
          </figure>
        </div>
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

  return <ToolTutorial kind="image-upscale" />;
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
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <ToolTutorial kind="video-upscale" />;
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
        <div className="studio-upscale-preview">
          {source ? (
            <figure className="studio-upscale-preview__figure">
              <span className="studio-upscale-preview__label">原视频</span>
              <video src={source.previewUrl} controls />
            </figure>
          ) : null}
          <figure className="studio-upscale-preview__figure">
            <span className="studio-upscale-preview__label">高清结果</span>
            <video src={output.item.output.url} controls />
          </figure>
        </div>
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

  return <ToolTutorial kind="video-upscale" />;
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

function LibrarySidebar({
  count,
  filter,
  onFilterChange,
}: {
  count: { all: number; image: number; video: number };
  filter: LibraryFilter;
  onFilterChange: (value: LibraryFilter) => void;
}) {
  return (
    <div className="studio-library-sidebar">
      <div className="studio-library-kind" role="group" aria-label="作品类型">
        {([
          ["image", "图片", count.image],
          ["video", "视频", count.video],
        ] as const).map(([id, label, value]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            className={cn("studio-library-kind__button", filter === id && "is-active")}
            onClick={() => onFilterChange(id)}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function LibraryWorkspace({
  items,
  totalCount,
  selectedItem,
  loading,
  error,
  filter,
  sort,
  search,
  deletingItemId,
  missingMediaIds,
  onFilterChange,
  onSortChange,
  onSearchChange,
  onSelectItem,
  onDelete,
  onRefresh,
  onMediaMissing,
}: {
  items: LibraryItem[];
  totalCount: number;
  selectedItem: LibraryItem | null;
  loading: boolean;
  error: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  search: string;
  deletingItemId: string | null;
  missingMediaIds: Set<string>;
  onFilterChange: (value: LibraryFilter) => void;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
  onSelectItem: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onMediaMissing: (id: string) => void;
}) {
  if (loading) {
    return (
      <PreviewState eyebrow="加载中" title="作品库" description="正在读取本地作品记录。" badge="请稍候" role="status" live>
        <div className="studio-preview__empty">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          <p>正在加载真实作品。</p>
        </div>
      </PreviewState>
    );
  }

  if (error) {
    return (
      <PreviewState eyebrow="加载失败" title="作品库" description={error} badge="可重试" role="alert">
        <div className="studio-preview__empty">
          <p>作品记录没有被替换成示例数据，你可以重新读取本地记录。</p>
          <button type="button" className="studio-secondary-button" onClick={() => void onRefresh()}>
            重新加载
          </button>
        </div>
      </PreviewState>
    );
  }

  if (!items.length) {
    const hasFilter = totalCount > 0 || Boolean(search.trim());
    return (
      <PreviewState
        eyebrow="空作品库"
        title="作品库"
        description={hasFilter ? "当前条件下没有作品。" : "生成或高清处理成功后，真实结果会自动出现在这里。"}
        badge={`${totalCount} 条作品`}
      >
        <LibraryToolbar
          filter={filter}
          sort={sort}
          search={search}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onSearchChange={onSearchChange}
        />
        <div className="studio-preview__empty">
          <p>{hasFilter ? "可以更换类型或搜索关键词。" : "这里不会展示静态示例作品。"}</p>
          <button type="button" className="studio-secondary-button" onClick={() => void onRefresh()}>
            刷新作品库
          </button>
        </div>
      </PreviewState>
    );
  }

  return (
    <PreviewState eyebrow="作品库" title="作品库" description="真实作品按条件展示，可预览、下载和删除。" badge={`${items.length} 条作品`}>
      <div className="studio-library-workspace">
        <LibraryToolbar
          filter={filter}
          sort={sort}
          search={search}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onSearchChange={onSearchChange}
        />
        <div className="studio-library-grid">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn("studio-library-tile", selectedItem?.id === item.id && "is-active")}
              onClick={() => onSelectItem(item.id)}
            >
              <MediaCard
                item={item}
                mediaMissing={missingMediaIds.has(item.id) || item.fileAvailable === false}
                onMediaMissing={() => onMediaMissing(item.id)}
              />
            </button>
          ))}
        </div>

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
    </PreviewState>
  );
}

function LibraryToolbar({
  filter,
  sort,
  search,
  onFilterChange,
  onSortChange,
  onSearchChange,
}: {
  filter: LibraryFilter;
  sort: LibrarySort;
  search: string;
  onFilterChange: (value: LibraryFilter) => void;
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
          placeholder="按标题查找"
          className="studio-input"
        />
      </div>
      <CustomSelect
        label="作品类型"
        value={filter}
        icon={<ListFilter className="size-4" />}
        options={[
          { value: "image", label: "图片" },
          { value: "video", label: "视频" },
        ]}
        onChange={(value) => onFilterChange(value as LibraryFilter)}
      />
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
    return (
      <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
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

  return <ToolTutorial kind="video" />;
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

function AspectRatioSelector({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="studio-ratio" role="group" aria-label={label}>
      {ratios.map((ratio) => (
        <button
          key={ratio}
          type="button"
          data-testid={`ratio-${ratio.replace(":", "-")}`}
          aria-pressed={value === ratio}
          onClick={() => onChange(ratio)}
          className={cn("studio-ratio__item", value === ratio && "is-active")}
        >
          <span className="studio-ratio__graphic" aria-hidden="true">
            <span className={cn("studio-ratio__shape", `ratio-${ratio.replace(":", "-")}`)} />
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

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onFiles(nextFiles);
  }, [onFiles]);

  return (
    <div className="studio-upload-group">
      <div
        className={cn("studio-upload", dragging && "is-dragging", error && "is-error")}
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
          aria-label={files.length ? filledTitle : emptyTitle}
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
          <strong>{files.length ? filledTitle : emptyTitle}</strong>
          <p id={helpId}>{helpText}</p>
          {files.length ? <span>点击区域可替换文件</span> : null}
        </div>
      </div>

      {files.length ? (
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
  eyebrow,
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
  const showEyebrow = eyebrow !== title;

  return (
    <div className="studio-preview" role={role} aria-live={live ? "polite" : undefined}>
      <div className="studio-preview__top">
        <div>
          {showEyebrow ? <p className="shell-eyebrow">{eyebrow}</p> : null}
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
    <div className="studio-custom-select">
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
      {open ? (
        <div
          ref={listRef}
          id={listId}
          className={cn("studio-custom-select__menu", openAbove && "is-above")}
          role="listbox"
          aria-label={label}
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
      ) : null}
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
  providers: PublicProvider[];
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
  children,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  loadingLabel?: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" data-testid="primary-submit" disabled={disabled} onClick={onClick} className="studio-primary-action" aria-busy={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
      <span>{loading ? loadingLabel || children : children}</span>
    </button>
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
  const canDownloadStoredFile = Boolean(media?.storedName);
  const showActions = large && !compact;
  const showMediaControls = large;
  const showOverlay = !large && !compact;
  const showBody = !compact && !showOverlay;
  const statusBadge = mediaMissing ? "文件失效" : libraryStatusBadgeLabel(item.status);
  const overlayMeta = [typeLabel, createdAt, scaleText, dimensionText, fileSizeText].filter(Boolean);
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
        {showOverlay ? (
          <div className="studio-media-card__overlay">
            <div className="studio-media-card__overlay-head">
              <strong>{item.title}</strong>
              {statusBadge ? <span>{statusBadge}</span> : null}
            </div>
            <div className="studio-media-card__overlay-meta" aria-label="作品信息">
              {overlayMeta.map((text) => <span key={text}>{text}</span>)}
            </div>
          </div>
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

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="studio-toast">
      {message}
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
