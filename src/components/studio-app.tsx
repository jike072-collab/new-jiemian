"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageUp, Loader2, RefreshCw, UploadCloud, Wand2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { cn } from "@/lib/utils";
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
};

type ImageWorkspaceState = {
  mode: WorkspaceImageMode;
  providerId: string;
  ratio: string;
  quality: string;
  prompt: string;
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
  mode: WorkspaceVideoMode;
  providerId: string;
  ratio: string;
  duration: number;
  prompt: string;
  files: VideoWorkspaceFile[];
  fileError: string;
  submitError: string;
  loading: boolean;
  job: JobRecord | null;
};

const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4"];

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
    subtitle: "输入提示词并选择模型。",
    submitLabel: "生成图片",
    loadingLabel: "正在生成",
    promptPlaceholder: "描述你要生成的画面、风格、主体和氛围。",
    guideTitle: "准备开始生成",
    guideDescription: "先选模型、比例和清晰度，再写清楚你想生成什么。",
    guideNotes: ["确认模型可用", "填写提示词", "结果会自动进入作品库"],
  },
  "image-to-image": {
    title: "AI 图片编辑器",
    subtitle: "上传参考图并输入修改要求。",
    submitLabel: "开始编辑",
    loadingLabel: "正在编辑",
    promptPlaceholder: "描述你要如何修改这张图，保留哪些元素、替换哪些内容。",
    guideTitle: "准备开始编辑",
    guideDescription: "先上传参考图，再补充你要修改的内容和保留的细节。",
    guideNotes: ["上传参考图", "写清修改要求", "结果会自动进入作品库"],
  },
};

const allowedReferenceImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxReferenceImageSize = 10 * 1024 * 1024;
const maxReferenceImageCount = 10;

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
    uploadLabel: "首帧图片",
    uploadRequired: false,
    uploadEmptyTitle: "文生视频不需要首帧图片",
    uploadFilledTitle: "首帧图片已在本地保留",
    uploadHelpText: "当前模型数据没有暴露参考图能力字段，文生视频请求不会发送图片。",
    promptLabel: "视频提示词",
    promptPlaceholder: "描述主体、动作、场景、镜头、运镜、光线和氛围。例如：雨夜霓虹街道，低机位缓慢推进，人物回头看向镜头。",
    guideDescription: "描述你想生成的视频画面、动作和镜头。",
    guideEmpty: "描述你想生成的视频画面、动作和镜头，真实视频结果会显示在这里。",
    guideReady: "提示词已填写，可以提交真实视频任务。",
    guideNotes: ["选择已启用的视频模型", "描述画面动作和镜头运动", "结果会进入作品库"],
  },
  "image-to-video": {
    submitLabel: "生成视频",
    loadingLabel: "正在生成视频",
    uploadLabel: "首帧图片",
    uploadRequired: true,
    uploadEmptyTitle: "上传首帧图片",
    uploadFilledTitle: "已选择首帧图片",
    uploadHelpText: "支持 PNG、JPEG 和 WebP，最多 10 张，单张不超过 10MB。",
    promptLabel: "动态描述",
    promptPlaceholder: "描述图片中的主体如何运动、镜头如何推进/拉远/环绕、背景如何变化，以及哪些元素必须保持一致。",
    guideDescription: "上传首帧图片，再描述希望画面如何运动。",
    guideEmpty: "先上传首帧图片，再补充动态描述。这里不会用假视频冒充结果。",
    guideReady: "首帧图片已准备好，补充动态描述后可以提交真实视频任务。",
    guideNotes: ["上传首帧图片", "描述运动和镜头变化", "结果会进入作品库"],
  },
};

function createImageWorkspaceFiles(files: File[]) {
  const nextFiles = files.slice(0, maxReferenceImageCount);
  if (files.length > maxReferenceImageCount) {
    throw new Error(`最多上传 ${maxReferenceImageCount} 张参考图片。`);
  }
  for (const file of nextFiles) {
    if (!allowedReferenceImageTypes.has(file.type)) {
      throw new Error("参考图片仅支持 PNG、JPEG 和 WebP。");
    }
    if (file.size > maxReferenceImageSize) {
      throw new Error("单张参考图片不能超过 10MB。");
    }
  }
  return nextFiles.map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

function createVideoWorkspaceFiles(files: File[]) {
  return createImageWorkspaceFiles(files).map((item) => ({
    file: item.file,
    previewUrl: item.previewUrl,
  }));
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

export function StudioApp() {
  const router = useRouter();
  const [activeWorkspaceToolId, setActiveWorkspaceToolId] = useState<WorkspaceToolId>("image");
  const [providers, setProviders] = useState<EnabledProviders>({ image: [], video: [] });
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("");
  const [outputs, setOutputs] = useState<Partial<Record<BusinessToolId, OutputState>>>({});
  const [mobileAction, setMobileAction] = useState<MobileActionState>(null);
  const [libraryFilter, setLibraryFilter] = useState<"all" | "image" | "video">("all");
  const [librarySort, setLibrarySort] = useState<"recent" | "title">("recent");
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [imageWorkspace, setImageWorkspace] = useState<ImageWorkspaceState>({
    mode: "text-to-image",
    providerId: "",
    ratio: "1:1",
    quality: "1k",
    prompt: "",
    files: [],
    fileError: "",
    submitError: "",
    loading: false,
  });
  const [videoWorkspace, setVideoWorkspace] = useState<VideoWorkspaceState>({
    mode: "text-to-video",
    providerId: "",
    ratio: "16:9",
    duration: 5,
    prompt: "",
    files: [],
    fileError: "",
    submitError: "",
    loading: false,
    job: null,
  });
  const imageWorkspaceFilesRef = useRef<ImageWorkspaceFile[]>([]);
  const videoWorkspaceFilesRef = useRef<VideoWorkspaceFile[]>([]);

  const refreshLibrary = useCallback(async () => {
    const data = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
    setLibrary(data.items);
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
      } catch (error) {
        if (!cancelled) {
          const text = error instanceof Error ? error.message : "加载失败。";
          setProvidersError(text);
          setMessage(text);
        }
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    imageWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    videoWorkspaceFilesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
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
      setImageWorkspace((prev) => (
        prev.mode === nextImageMode ? prev : { ...prev, mode: nextImageMode, submitError: "" }
      ));
    }

    const nextVideoMode = action.mode === "text-to-video" || action.mode === "image-to-video" ? action.mode : null;
    if (action.toolId === "video" && nextVideoMode) {
      setVideoWorkspace((prev) => (
        prev.mode === nextVideoMode ? prev : { ...prev, mode: nextVideoMode, fileError: "", submitError: "" }
      ));
    }

    setActiveWorkspaceToolId(tool);
  }, [router]);

  const activeWorkspaceTool = workspaceToolById(activeWorkspaceToolId) || workspaceToolEntries[0];
  const activeAction = activeWorkspaceTool.action.kind === "workspace" ? activeWorkspaceTool.action : null;
  const activeBusinessTool = activeAction?.toolId || "library";
  const activeOutput = outputs[activeBusinessTool] || null;
  const activeImageMode: WorkspaceImageMode = imageWorkspace.mode;
  const activeVideoMode: WorkspaceVideoMode = videoWorkspace.mode;
  const currentLibraryItems = useMemo(() => {
    const filtered = library.filter((item) => {
      if (libraryFilter === "all") return true;
      return item.type === libraryFilter;
    });
    const sorted = [...filtered];
    if (librarySort === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    } else {
      sorted.sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
    }
    return sorted;
  }, [library, libraryFilter, librarySort]);

  const selectedLibraryItem = useMemo(
    () => currentLibraryItems.find((item) => item.id === selectedLibraryItemId) || currentLibraryItems[0] || null,
    [currentLibraryItems, selectedLibraryItemId],
  );

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
  const imageWorkspaceCanSubmit = Boolean(selectedImageProvider)
    && !providersLoading
    && !imageWorkspace.loading
    && Boolean(imageWorkspacePrompt)
    && (activeImageMode === "text-to-image" || imageWorkspaceHasFiles);

  const updateImageWorkspace = useCallback((patch: Partial<ImageWorkspaceState>) => {
    setImageWorkspace((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleImageModeChange = useCallback((mode: WorkspaceImageMode) => {
    setImageWorkspace((prev) => (
      prev.mode === mode
        ? prev
        : {
            ...prev,
            mode,
            fileError: mode === "text-to-image" ? "" : prev.fileError,
            submitError: "",
          }
    ));
    if (activeWorkspaceToolId === "image-editor" && mode === "text-to-image") {
      setActiveWorkspaceToolId("image");
    }
  }, [activeWorkspaceToolId]);

  const replaceImageWorkspaceFiles = useCallback((files: File[]) => {
    let nextFiles: ImageWorkspaceFile[];
    try {
      nextFiles = createImageWorkspaceFiles(files);
    } catch (error) {
      setImageWorkspace((prev) => ({
        ...prev,
        fileError: error instanceof Error ? error.message : "参考图片读取失败。",
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
    if (activeImageMode === "image-to-image" && !imageWorkspaceHasFiles) {
      setImageWorkspace((prev) => ({
        ...prev,
        fileError: "图片编辑需要先上传参考图片。",
        submitError: "图片编辑需要先上传参考图片。",
      }));
      return;
    }
    if (imageWorkspace.loading) return;

    setImageWorkspace((prev) => ({
      ...prev,
      loading: true,
      submitError: "",
      fileError: "",
    }));
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
    imageWorkspaceHasFiles,
    imageWorkspacePrompt,
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
  const videoWorkspaceCanSubmit = Boolean(selectedVideoProvider)
    && !providersLoading
    && !videoWorkspace.loading
    && Boolean(videoWorkspacePrompt)
    && (!videoWorkspaceNeedsFile || videoWorkspaceHasFiles);

  const updateVideoWorkspace = useCallback((patch: Partial<VideoWorkspaceState>) => {
    setVideoWorkspace((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleVideoModeChange = useCallback((mode: WorkspaceVideoMode) => {
    setVideoWorkspace((prev) => (
      prev.mode === mode
        ? prev
        : {
            ...prev,
            mode,
            fileError: "",
            submitError: "",
          }
    ));
  }, []);

  const replaceVideoWorkspaceFiles = useCallback((files: File[]) => {
    let nextFiles: VideoWorkspaceFile[];
    try {
      nextFiles = createVideoWorkspaceFiles(files);
    } catch (error) {
      setVideoWorkspace((prev) => ({
        ...prev,
        fileError: error instanceof Error ? error.message : "首帧图片读取失败。",
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
      updateVideoWorkspace({ submitError: "请输入视频提示词。" });
      return;
    }
    if (videoWorkspaceNeedsFile && !videoWorkspaceHasFiles) {
      const text = "图生视频需要先上传首帧图片。";
      updateVideoWorkspace({ fileError: text, submitError: text });
      return;
    }
    if (videoWorkspace.loading) return;

    updateVideoWorkspace({
      loading: true,
      submitError: "",
      fileError: "",
    });
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
    videoWorkspaceNeedsFile,
    videoWorkspacePrompt,
  ]);

  const handleImageUpscaleResult = useCallback((item: LibraryItem, job?: JobRecord | null) => {
    setOutputs((prev) => ({ ...prev, "image-upscale": { item, job, title: "图片高清结果", tool: "image-upscale" } }));
  }, []);

  const handleVideoUpscaleResult = useCallback((item: LibraryItem, job?: JobRecord | null) => {
    setOutputs((prev) => ({ ...prev, "video-upscale": { item, job, title: "视频高清结果", tool: "video-upscale" } }));
  }, []);

  const parameterSlot = (
    <>
      {activeBusinessTool === "image" ? (
        <ImageGenerator
          mode={activeImageMode}
          providers={providers.image}
          providersLoading={providersLoading}
          providersError={providersError}
          selectedProvider={selectedImageProvider}
          state={imageWorkspace}
          canSubmit={imageWorkspaceCanSubmit}
          onModeChange={handleImageModeChange}
          onProviderChange={(value) => updateImageWorkspace({ providerId: value })}
          onRatioChange={(value) => updateImageWorkspace({ ratio: value })}
          onQualityChange={(value) => updateImageWorkspace({ quality: value })}
          onPromptChange={(value) => updateImageWorkspace({ prompt: value, submitError: "" })}
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
          onModeChange={handleVideoModeChange}
          onProviderChange={(value) => updateVideoWorkspace({ providerId: value, submitError: "" })}
          onRatioChange={(value) => updateVideoWorkspace({ ratio: value })}
          onDurationChange={(value) => updateVideoWorkspace({ duration: value })}
          onPromptChange={(value) => updateVideoWorkspace({ prompt: value, submitError: "" })}
          onFilesChange={replaceVideoWorkspaceFiles}
          onFileRemove={removeVideoWorkspaceFile}
          onFilesClear={clearVideoWorkspaceFiles}
          onReloadProviders={refreshProviders}
          onSubmit={submitVideoWorkspace}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "image-upscale" ? (
        <UpscaleForm
          kind="image"
          onDone={refreshLibrary}
          onResult={handleImageUpscaleResult}
          setMessage={setMessage}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "video-upscale" ? (
        <UpscaleForm
          kind="video"
          onDone={refreshLibrary}
          onResult={handleVideoUpscaleResult}
          setMessage={setMessage}
          registerMobileAction={setMobileAction}
        />
      ) : null}
      {activeBusinessTool === "library" ? (
        <LibrarySidebar
          count={libraryCounts}
          filter={libraryFilter}
          sort={librarySort}
          onFilterChange={setLibraryFilter}
          onSortChange={setLibrarySort}
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
        toolDescription={activeWorkspaceTool.description}
        parameterSlot={parameterSlot}
        previewSlot={
          activeBusinessTool === "library" ? (
            <LibraryWorkspace
              items={currentLibraryItems}
              selectedItem={selectedLibraryItem}
              onSelectItem={setSelectedLibraryItemId}
              onDelete={async (id) => {
                try {
                  await jsonFetch("/api/library", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id }),
                  });
                  await refreshLibrary();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "删除失败。");
                }
              }}
              onRefresh={refreshLibrary}
            />
          ) : (
            activeBusinessTool === "image" ? (
              <ImagePreviewPanel
                mode={activeImageMode}
                output={activeOutput}
                loading={imageWorkspace.loading}
                submitError={imageWorkspace.submitError}
                promptFilled={Boolean(imageWorkspacePrompt)}
                hasProvider={Boolean(selectedImageProvider)}
                hasFiles={imageWorkspaceHasFiles}
                libraryCount={library.length}
                onSubmit={submitImageWorkspace}
                onReloadProviders={refreshProviders}
                onOpenLibrary={() => setActiveWorkspaceToolId("library")}
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
                libraryCount={library.length}
                onSubmit={submitVideoWorkspace}
                onReloadProviders={refreshProviders}
                onOpenLibrary={() => setActiveWorkspaceToolId("library")}
                firstFrame={videoWorkspace.files[0] || null}
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
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  state,
  canSubmit,
  onModeChange,
  onProviderChange,
  onRatioChange,
  onQualityChange,
  onPromptChange,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceImageMode;
  providers: PublicProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: PublicProvider | null;
  state: ImageWorkspaceState;
  canSubmit: boolean;
  onModeChange: (mode: WorkspaceImageMode) => void;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onPromptChange: (value: string) => void;
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
      <ImageModeSwitch mode={mode} onModeChange={onModeChange} />

      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      <ReferenceImageInput
        mode={mode}
        files={state.files}
        error={state.fileError}
        onChange={onFilesChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
      />
      <StackedControl label="图片比例" required>
        <AspectRatioSelector label="图片比例" value={state.ratio} onChange={onRatioChange} />
      </StackedControl>
      <StackedControl label="清晰度" required>
        <ModeSegmentedControl
          label="清晰度"
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

function ImageModeSwitch({
  mode,
  onModeChange,
}: {
  mode: WorkspaceImageMode;
  onModeChange: (mode: WorkspaceImageMode) => void;
}) {
  return (
    <ModeSegmentedControl
      label="图像模式"
      groupId="image-mode"
      value={mode}
      options={[
        ["text-to-image", "文生图"],
        ["image-to-image", "图生图"],
      ]}
      onChange={(value) => onModeChange(value as WorkspaceImageMode)}
    />
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
  const required = mode === "image-to-image";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onChange(nextFiles);
  }, [onChange]);

  return (
    <FieldFrame label="参考图片" required={required} hint={required ? undefined : "可选"}>
      <CompactDropzone
        inputRef={fileInputRef}
        inputId="reference-image-input"
        accept="image/png,image/jpeg,image/webp"
        multiple
        required={required}
        dragging={dragging}
        error={error}
        files={files.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
        }))}
        emptyTitle={required ? "上传参考图片开始编辑" : "可上传参考图片辅助生成"}
        filledTitle="已选择参考图片"
        helpText="支持 PNG、JPEG、WebP，最多 10 张，单张不超过 10MB。"
        chooseLabel={files.length ? "替换图片" : "选择图片"}
        onFiles={applyFiles}
        onRemove={onRemove}
        onClear={files.length ? onClear : undefined}
        onDraggingChange={setDragging}
      />
      {error ? <p id="reference-image-error" className="studio-error-text" role="alert">{error}</p> : null}
      {!error && required && !files.length ? <p className="studio-help-text" role="status" aria-live="polite">图片编辑必须先上传参考图片。</p> : null}
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
  onModeChange,
  onProviderChange,
  onRatioChange,
  onDurationChange,
  onPromptChange,
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
  onModeChange: (mode: WorkspaceVideoMode) => void;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onPromptChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = videoWorkspaceModeMeta[mode];
  const hasFiles = state.files.length > 0;
  const showUpload = mode === "image-to-video";

  useEffect(() => {
    registerMobileAction({
      label: meta.submitLabel,
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, meta.submitLabel, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <ModeSegmentedControl
        label="视频模式"
        groupId="video-mode"
        value={mode}
        options={[
          ["text-to-video", "文生视频"],
          ["image-to-video", "图生视频"],
        ]}
        onChange={(value) => onModeChange(value as WorkspaceVideoMode)}
      />
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      {showUpload ? (
        <VideoReferenceInput
          files={state.files}
          required={meta.uploadRequired}
          error={state.fileError}
          label={meta.uploadLabel}
          emptyTitle={meta.uploadEmptyTitle}
          filledTitle={meta.uploadFilledTitle}
          helpText={meta.uploadHelpText}
          onChange={onFilesChange}
          onRemove={onFileRemove}
          onClear={onFilesClear}
        />
      ) : null}
      <StackedControl label="视频比例" required>
        <AspectRatioSelector label="视频比例" value={state.ratio} onChange={onRatioChange} />
      </StackedControl>
      <FieldFrame label="视频时长" required>
        <select
          value={state.duration}
          onChange={(event) => onDurationChange(Number(event.target.value))}
          className="studio-select"
        >
          {[5, 8, 10, 15].map((value) => (
            <option key={value} value={value}>
              {value} 秒
            </option>
          ))}
        </select>
      </FieldFrame>
      <VideoPromptBox
        label={meta.promptLabel}
        value={state.prompt}
        onChange={onPromptChange}
        required
        placeholder={meta.promptPlaceholder}
      />
      {state.submitError ? <p className="studio-error-text" role="alert">{state.submitError}</p> : null}
      <StickyPrimaryAction>
        <SubmitButton disabled={!canSubmit} loading={state.loading} onClick={onSubmit}>
          {state.loading ? meta.loadingLabel : meta.submitLabel}
        </SubmitButton>
        {!hasFiles && meta.uploadRequired ? <span className="studio-help-text">上传首帧图片后才能生成视频。</span> : null}
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function VideoReferenceInput({
  files,
  required,
  error,
  label,
  emptyTitle,
  filledTitle,
  helpText,
  onChange,
  onRemove,
  onClear,
}: {
  files: VideoWorkspaceFile[];
  required: boolean;
  error: string;
  label: string;
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
    <FieldFrame label={label} required={required}>
      <CompactDropzone
        inputRef={inputRef}
        inputId="video-first-frame-input"
        accept="image/png,image/jpeg,image/webp"
        required={required}
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
        chooseLabel={files.length ? "替换图片" : "选择图片"}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  const descriptionId = "video-prompt-counter";

  return (
    <FieldFrame label={label} required={required}>
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
    </FieldFrame>
  );
}

function UpscaleForm({
  kind,
  onDone,
  onResult,
  setMessage,
  registerMobileAction,
}: {
  kind: UpscaleKind;
  onDone: () => Promise<void>;
  onResult: (item: LibraryItem, job?: JobRecord | null) => void;
  setMessage: (value: string) => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const isVideo = kind === "video";
  const [scale, setScale] = useState("2");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [availability, setAvailability] = useState<UpscaleAvailability | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);

  async function checkAvailability() {
    setStatusLoading(true);
    try {
      const data = await jsonFetch<UpscaleStatusResponse>("/api/upscale/status");
      setAvailability(data[kind]);
    } catch (error) {
      setAvailability(null);
      setMessage(error instanceof Error ? error.message : "本机高清依赖检测失败。");
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    jsonFetch<UpscaleStatusResponse>("/api/upscale/status")
      .then((data) => {
        if (!cancelled) setAvailability(data[kind]);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAvailability(null);
          setMessage(error instanceof Error ? error.message : "本机高清依赖检测失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, setMessage]);

  useEffect(() => {
    if (!isVideo || !job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await jsonFetch<{ job: JobRecord | null }>(`/api/jobs/${job.id}`);
        if (data.job) setJob(data.job);
        const libraryData = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
        const updatedItem = libraryData.items.find((item) => item.id === job.libraryItemId);
        if (updatedItem) onResult(updatedItem, data.job || job);
        await onDone();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "高清任务查询失败。");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isVideo, job, onDone, onResult, setMessage]);

  const submit = useCallback(async () => {
    if (!file) {
      setMessage(`请选择一个${isVideo ? "视频" : "图片"}文件。`);
      return;
    }
    if (!availability?.ready) {
      setMessage(availability?.detail || `本机${isVideo ? "视频" : "图片"}放大工具还没有准备好。`);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("scale", scale);
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>(`/api/upscale/${kind}`, {
        method: "POST",
        body: form,
      });
      setJob(data.job);
      onResult(data.item, data.job);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${isVideo ? "视频" : "图片"}高清处理失败。`);
    } finally {
      setLoading(false);
    }
  }, [availability?.detail, availability?.ready, file, isVideo, kind, onDone, onResult, scale, setMessage]);

  const accept = isVideo ? "video/mp4,video/webm,video/quicktime,.mov" : "image/png,image/jpeg,image/webp";

  useEffect(() => {
    registerMobileAction({
      label: "开始增强",
      loading,
      disabled: loading || statusLoading,
      onClick: submit,
    });
    return () => registerMobileAction(null);
  }, [loading, registerMobileAction, statusLoading, submit]);

  return (
    <FormPanel>
      <FileInput
        label={isVideo ? "源视频" : "源图片"}
        optional={false}
        accept={accept}
        multiple={false}
        files={file ? [file] : []}
        onChange={(nextFiles) => setFile(nextFiles[0] || null)}
      />

      <StackedControl label="放大倍数" required>
        <ModeSegmentedControl
          label="放大倍数"
          groupId="upscale-scale"
          value={scale}
          options={[
            ["2", "2x"],
            ["4", "4x"],
          ]}
          onChange={setScale}
        />
      </StackedControl>

      <div
        className={cn(
          "studio-status",
          availability?.ready ? "is-ready" : "is-warning",
        )}
      >
        <div className="min-w-0">
          <strong className="block">
            {statusLoading ? "正在检测本机依赖..." : availability?.ready ? "本机依赖已就绪" : "本机依赖未检测到"}
          </strong>
          {!statusLoading ? <p className="mt-1 break-all text-xs opacity-75">{availability?.detail || "请先安装并配置对应的本地高清处理依赖。"}</p> : null}
        </div>
        <button
          type="button"
          onClick={checkAvailability}
          disabled={statusLoading}
          className="studio-icon-button"
          aria-label="重新检测本机依赖"
        >
          <RefreshCw className={cn("size-4", statusLoading && "animate-spin")} />
        </button>
      </div>

      <StickyPrimaryAction helpText="本机增强，不需要 Key">
        <SubmitButton disabled={loading || statusLoading} loading={loading} onClick={submit}>
          开始增强
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function LibrarySidebar({
  count,
  filter,
  sort,
  onFilterChange,
  onSortChange,
}: {
  count: { all: number; image: number; video: number };
  filter: "all" | "image" | "video";
  sort: "recent" | "title";
  onFilterChange: (value: "all" | "image" | "video") => void;
  onSortChange: (value: "recent" | "title") => void;
}) {
  return (
    <div className="studio-library-sidebar">
      <StackedControl label="分类">
        <ModeSegmentedControl
          label="作品分类"
          groupId="library-filter"
          value={filter}
          options={[
            ["all", `全部 ${count.all}`],
            ["image", `图片 ${count.image}`],
            ["video", `视频 ${count.video}`],
          ]}
          onChange={(value) => onFilterChange(value as "all" | "image" | "video")}
        />
      </StackedControl>
      <StackedControl label="排序">
        <ModeSegmentedControl
          label="作品排序"
          groupId="library-sort"
          value={sort}
          options={[
            ["recent", "最新"],
            ["title", "标题"],
          ]}
          onChange={(value) => onSortChange(value as "recent" | "title")}
        />
      </StackedControl>
      <p className="studio-help-text">点击作品后会在右侧预览区显示详情。</p>
    </div>
  );
}

function LibraryWorkspace({
  items,
  selectedItem,
  onSelectItem,
  onDelete,
  onRefresh,
}: {
  items: LibraryItem[];
  selectedItem: LibraryItem | null;
  onSelectItem: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  if (!items.length) {
    return <section className="studio-empty">作品库还是空的。生成图片或视频后会自动出现在这里。</section>;
  }

  return (
    <div className="studio-library-workspace">
      <div className="studio-library-grid">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("studio-library-tile", selectedItem?.id === item.id && "is-active")}
            onClick={() => onSelectItem(item.id)}
          >
            <MediaCard item={item} />
          </button>
        ))}
      </div>

      {selectedItem ? (
        <div className="studio-library-detail">
          <MediaCard item={selectedItem} large />
          <div className="studio-actions">
            <button type="button" className="studio-secondary-button" onClick={() => onDelete(selectedItem.id)}>
              删除
            </button>
            <button type="button" className="studio-secondary-button" onClick={onRefresh}>
              刷新
            </button>
          </div>
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
  promptFilled,
  hasProvider,
  hasFiles,
  libraryCount,
  onSubmit,
  onReloadProviders,
  onOpenLibrary,
}: {
  mode: WorkspaceImageMode;
  output: OutputState;
  loading: boolean;
  submitError: string;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  libraryCount: number;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onOpenLibrary: () => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];

  if (loading) {
    return (
      <PreviewState eyebrow="处理中" title="创作预览" description={meta.loadingLabel} badge="请稍候" role="status" live>
        <div className="studio-preview__empty">
          <p>正在处理请求，生成完成后会在这里显示结果。</p>
        </div>
      </PreviewState>
    );
  }

  if (submitError) {
    return (
      <PreviewState eyebrow="失败" title="生成结果" description={submitError} badge="请重试" role="alert">
        <div className="studio-preview__empty">
          <p>参数会保留，你可以先修改模型、提示词或参考图片，再重新提交。</p>
          <div className="studio-actions">
            {!hasProvider ? (
              <button type="button" className="studio-secondary-button" onClick={() => void onReloadProviders()}>
                重新加载模型
              </button>
            ) : null}
            <button
              type="button"
              className="studio-secondary-button"
              onClick={onSubmit}
              disabled={!hasProvider || !promptFilled || (mode === "image-to-image" && !hasFiles)}
            >
              重试
            </button>
            <button type="button" className="studio-secondary-button" onClick={onOpenLibrary}>
              进入作品库
            </button>
          </div>
        </div>
      </PreviewState>
    );
  }

  if (output) {
    return (
      <PreviewState eyebrow="结果" title="生成结果" description="生成完成后，这里就是你的真实结果，支持直接查看和下载。" badge={output.job?.status || output.item.status} role="status" live>
        <MediaCard item={output.item} large />
        <div className="studio-actions">
          {output.item.output?.url ? (
            <a className="studio-secondary-button" href={output.item.output.url} target="_blank" rel="noreferrer">
              查看原图
            </a>
          ) : null}
          <button
            type="button"
            className="studio-secondary-button"
            onClick={onSubmit}
            disabled={!hasProvider || !promptFilled || (mode === "image-to-image" && !hasFiles) || loading}
          >
            再次生成
          </button>
          <button type="button" className="studio-secondary-button" onClick={onOpenLibrary}>
            进入作品库
          </button>
        </div>
      </PreviewState>
    );
  }

  const content = imageWorkspaceModeMeta[mode];

  return (
    <PreviewState eyebrow="创作预览" title="创作预览" description={content.guideDescription} badge={`${libraryCount} 条作品`}>
      <div className="studio-preview__empty">
        <p>上传素材开始创作，结果会在这里显示。</p>
      </div>
      <div className="studio-steps">
        {content.guideNotes.map((note, index) => (
          <div key={note} className="studio-step">
            <span>{index + 1}</span>
            <p>{note}</p>
          </div>
        ))}
      </div>
    </PreviewState>
  );
}

function VideoPreviewPanel({
  mode,
  output,
  loading,
  submitError,
  promptFilled,
  hasProvider,
  hasFiles,
  libraryCount,
  onSubmit,
  onReloadProviders,
  onOpenLibrary,
  firstFrame,
}: {
  mode: WorkspaceVideoMode;
  output: OutputState;
  loading: boolean;
  submitError: string;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  libraryCount: number;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onOpenLibrary: () => void;
  firstFrame: VideoWorkspaceFile | null;
}) {
  const meta = videoWorkspaceModeMeta[mode];
  const canRetry = hasProvider && promptFilled && (mode === "text-to-video" || hasFiles) && !loading;

  if (loading) {
    return (
      <PreviewState eyebrow="处理中" title="创作预览" description={meta.loadingLabel} badge="请稍候" role="status" live>
        <div className="studio-preview__empty">
          <p>真实视频任务正在运行，供应商返回结果后会显示在这里。</p>
        </div>
      </PreviewState>
    );
  }

  if (submitError) {
    return (
      <PreviewState eyebrow="失败" title="生成结果" description={submitError} badge="可重试" role="alert">
        <div className="studio-preview__empty">
          <p>参数会保留。你可以调整模型、提示词、时长、比例或首帧图片后重试。</p>
          <div className="studio-actions">
            {!hasProvider ? (
              <button type="button" className="studio-secondary-button" onClick={() => void onReloadProviders()}>
                重新加载模型
              </button>
            ) : null}
            <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canRetry}>
              重试
            </button>
            <button type="button" className="studio-secondary-button" onClick={onOpenLibrary}>
              进入作品库
            </button>
          </div>
        </div>
      </PreviewState>
    );
  }

  if (output) {
    return (
      <PreviewState eyebrow="结果" title="生成结果" description="这里只显示真实供应商返回的视频结果。" badge={output.job?.status || output.item.status} role="status" live>
        <MediaCard item={output.item} large />
        <div className="studio-actions">
          <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canRetry}>
            再次生成
          </button>
          <button type="button" className="studio-secondary-button" onClick={onOpenLibrary}>
            进入作品库
          </button>
        </div>
      </PreviewState>
    );
  }

  return (
    <PreviewState eyebrow="创作预览" title="创作预览" description={meta.guideDescription} badge={`${libraryCount} 条作品`}>
      {mode === "image-to-video" && firstFrame ? (
        <div className="studio-preview__media is-example">
          <span className="studio-example-badge">首帧图片</span>
          <img src={firstFrame.previewUrl} alt={firstFrame.file.name} />
        </div>
      ) : (
        <div className="studio-preview__empty">
          <p>{promptFilled && (mode === "text-to-video" || hasFiles) ? meta.guideReady : meta.guideEmpty}</p>
        </div>
      )}
      <div className="studio-steps">
        {meta.guideNotes.map((note, index) => (
          <div key={note} className="studio-step">
            <span>{index + 1}</span>
            <p>{note}</p>
          </div>
        ))}
      </div>
    </PreviewState>
  );
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
    <PreviewState eyebrow="结果" title="生成结果" description="生成完成后，这里就是你的真实结果，支持直接查看和下载。" badge={output.job?.status || output.item.status}>
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
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-field">
      <div className="studio-field__label">
        <span>{label}</span>
        {required ? <span className="studio-required">*</span> : hint ? <span className="shell-chip">{hint}</span> : null}
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
  required,
  dragging,
  error,
  files,
  emptyTitle,
  filledTitle,
  helpText,
  chooseLabel,
  onFiles,
  onRemove,
  onClear,
  onDraggingChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputId: string;
  accept: string;
  multiple?: boolean;
  required?: boolean;
  dragging?: boolean;
  error?: string;
  files: UploadFilePreview[];
  emptyTitle: string;
  filledTitle: string;
  helpText: string;
  chooseLabel?: string;
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
          aria-label={required ? emptyTitle : chooseLabel || emptyTitle}
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
        </div>
      </div>

      <div className="studio-upload__actions">
        <button
          type="button"
          className="studio-secondary-button"
          onClick={() => inputRef.current?.click()}
        >
          {chooseLabel || (files.length ? "替换文件" : "选择文件")}
        </button>
        {files.length && onClear ? (
          <button type="button" className="studio-secondary-button" onClick={onClear}>
            全部删除
          </button>
        ) : null}
      </div>

      {files.length ? (
        <div className="studio-upload-list">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.size}-${index}`} className="studio-upload-item">
              {file.previewUrl ? (
                <img src={file.previewUrl} alt={file.name} />
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
  groupId,
  value,
  options,
  onChange,
}: {
  label?: string;
  groupId?: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-mode">
      {label ? <span id={groupId ? `${groupId}-label` : undefined} className="studio-label">{label}</span> : null}
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

function ProviderSelect({
  providers,
  value,
  loading,
  error,
  onChange,
  onReload,
}: {
  providers: PublicProvider[];
  value: string;
  loading?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReload?: () => Promise<void>;
}) {
  return (
    <FieldFrame label="模型" required>
      <div className="studio-provider">
        <label className="studio-sr-only" htmlFor="image-provider-select">
          模型
        </label>
        <select
          id="image-provider-select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="studio-select"
          disabled={loading || !providers.length}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "image-provider-error" : loading ? "image-provider-status" : !providers.length ? "image-provider-empty" : undefined}
        >
          {loading ? (
            <option value="">正在加载模型</option>
          ) : providers.length ? (
            providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.model} · {provider.title}
              </option>
            ))
          ) : (
            <option value="">当前尚未配置可用模型</option>
          )}
        </select>
        {loading ? <p id="image-provider-status" className="studio-help-text" role="status" aria-live="polite">正在读取后台已启用的图片模型。</p> : null}
        {!loading && !error && !providers.length ? (
          <p id="image-provider-empty" className="studio-help-text" role="status" aria-live="polite">
            当前尚未配置可用模型，请到 <a href="/admin/providers">后台设置</a> 启用对应模型。
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

function FileInput({
  label,
  optional,
  accept,
  multiple = true,
  files,
  onChange,
}: {
  label: string;
  optional: boolean;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = `${label.replace(/\s+/g, "-")}-file-input`;

  return (
    <FieldFrame label={label} required={!optional} hint={optional ? "可选" : undefined}>
      <CompactDropzone
        inputRef={inputRef}
        inputId={inputId}
        accept={accept}
        multiple={multiple}
        required={!optional}
        dragging={dragging}
        files={files.map((file) => ({
          name: file.name,
          size: file.size,
        }))}
        emptyTitle={optional ? `可上传${label}` : `上传${label}`}
        filledTitle={`已选择${label}`}
        helpText={`支持真实接口允许的${label}文件。`}
        chooseLabel={files.length ? "替换文件" : "选择文件"}
        onFiles={(nextFiles) => onChange(multiple ? nextFiles : nextFiles.slice(0, 1))}
        onRemove={(index) => onChange(files.filter((_, currentIndex) => currentIndex !== index))}
        onClear={files.length ? () => onChange([]) : undefined}
        onDraggingChange={setDragging}
      />
    </FieldFrame>
  );
}

function PromptBox({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <FieldFrame label="提示词" required={required}>
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

function MediaCard({ item, large = false }: { item: LibraryItem; large?: boolean }) {
  const media = item.output;
  return (
    <article className="studio-media-card">
      <div className={cn("studio-media-card__frame", large && "is-large")}>
        {media?.url && item.type === "image" ? <img src={media.url} alt={item.title} /> : null}
        {media?.url && item.type === "video" ? <video src={media.url} controls /> : null}
        {!media?.url ? <span>{item.status}</span> : null}
      </div>
      <div className="studio-media-card__body">
        <div className="studio-media-card__head">
          <strong>{item.title}</strong>
          <span>{item.status}</span>
        </div>
        <p>{item.prompt}</p>
        {media?.url ? (
          <a href={media.url} download>
            下载结果
          </a>
        ) : null}
      </div>
    </article>
  );
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
    desc: "本机 Upscayl 放大能力继续通过原接口处理。",
    image: "/images/reference/sample-2.png",
    notes: ["上传图片", "选择 2x 或 4x", "处理后进入作品库"],
  },
  "video-upscale": {
    title: "视频高清",
    desc: "本机 Video2X 增强能力继续通过原接口处理。",
    image: "/images/reference/sample-3.png",
    notes: ["上传视频", "检测本机依赖", "处理后刷新作品库"],
  },
  library: {
    title: "作品库",
    desc: "历史结果、下载和删除逻辑保持不变。",
    image: "/images/reference/hero-cover.png",
    notes: ["查看历史", "下载结果", "删除不需要的作品"],
  },
};
