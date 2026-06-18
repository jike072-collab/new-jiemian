"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Wand2, X } from "lucide-react";
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
  workspaceToolIdForImageMode,
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

type ImageWorkspaceState = {
  providerId: string;
  ratio: string;
  quality: string;
  prompt: string;
  files: ImageWorkspaceFile[];
  fileError: string;
  submitError: string;
  loading: boolean;
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
    providerId: "",
    ratio: "1:1",
    quality: "1k",
    prompt: "",
    files: [],
    fileError: "",
    submitError: "",
    loading: false,
  });
  const imageWorkspaceFilesRef = useRef<ImageWorkspaceFile[]>([]);

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

  const handleToolAction = useCallback((action: WorkspaceAction, tool: WorkspaceToolId) => {
    if (action.kind === "route") {
      router.push(action.href);
      return;
    }

    setActiveWorkspaceToolId(tool);
  }, [router]);

  const activeWorkspaceTool = workspaceToolById(activeWorkspaceToolId) || workspaceToolEntries[0];
  const activeAction = activeWorkspaceTool.action.kind === "workspace" ? activeWorkspaceTool.action : null;
  const activeBusinessTool = activeAction?.toolId || "library";
  const activeOutput = outputs[activeBusinessTool] || null;
  const activeImageMode: WorkspaceImageMode = activeWorkspaceToolId === "image-editor" ? "image-to-image" : "text-to-image";
  const activeVideoMode: WorkspaceVideoMode = activeBusinessTool === "video" && activeAction?.mode === "image-to-video" ? "image-to-video" : "text-to-video";
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
          onModeChange={(mode) => setActiveWorkspaceToolId(workspaceToolIdForImageMode(mode))}
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
          initialMode={activeVideoMode}
          providers={providers.video}
          onDone={refreshLibrary}
          onResult={handleVideoResult}
          setMessage={setMessage}
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
                activeLabel={activeWorkspaceTool.label}
                onSubmit={submitImageWorkspace}
                onReloadProviders={refreshProviders}
                onOpenLibrary={() => setActiveWorkspaceToolId("library")}
              />
            ) : (
              <OutputPanel tool={activeBusinessTool} output={activeOutput} libraryCount={library.length} activeLabel={activeWorkspaceTool.label} />
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
    <FormPanel title={meta.title} subtitle={meta.subtitle}>
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
        <RatioPicker value={state.ratio} onChange={onRatioChange} />
      </StackedControl>
      <StackedControl label="清晰度" required>
        <ModeSwitch
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
      {state.submitError ? <p className="studio-error-text">{state.submitError}</p> : null}

      <div className="studio-actions">
        <SubmitButton disabled={!canSubmit} loading={state.loading} loadingLabel={meta.loadingLabel} onClick={onSubmit}>
          {meta.submitLabel}
        </SubmitButton>
      </div>
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
    <ModeSwitch
      value={mode}
      options={[
        ["text-to-image", "文生图"],
        ["image-to-image", "图片编辑"],
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
      <div
        className={cn("studio-upload", dragging && "is-dragging", error && "is-error")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          applyFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => {
            applyFiles(event.target.files || []);
            event.currentTarget.value = "";
          }}
          className="studio-file-input"
        />
        <div className="studio-upload__body">
          <strong>{files.length ? "已选择参考图片" : required ? "上传参考图片开始编辑" : "可上传参考图片辅助生成"}</strong>
          <p>支持 PNG、JPEG、WebP，最多 10 张，单张不超过 10MB。</p>
          <div className="studio-upload__actions">
            <button type="button" className="studio-secondary-button" onClick={() => fileInputRef.current?.click()}>
              {files.length ? "替换图片" : "选择图片"}
            </button>
            {files.length ? (
              <button type="button" className="studio-secondary-button" onClick={onClear}>
                全部删除
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {files.length ? (
        <div className="studio-upload-list">
          {files.map((item, index) => (
            <div key={`${item.file.name}-${item.file.lastModified}-${index}`} className="studio-upload-item">
              <img src={item.previewUrl} alt={item.file.name} />
              <div>
                <strong>{item.file.name}</strong>
                <span>{formatFileSize(item.file.size)}</span>
              </div>
              <button type="button" className="studio-icon-button" aria-label={`删除 ${item.file.name}`} onClick={() => onRemove(index)}>
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="studio-error-text">{error}</p> : null}
      {!error && required && !files.length ? <p className="studio-help-text">图片编辑必须先上传参考图片。</p> : null}
    </FieldFrame>
  );
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function VideoGenerator({
  initialMode,
  providers,
  onDone,
  onResult,
  setMessage,
  registerMobileAction,
}: {
  initialMode: WorkspaceVideoMode;
  providers: PublicProvider[];
  onDone: () => Promise<void>;
  onResult: (item: LibraryItem, job?: JobRecord | null) => void;
  setMessage: (value: string) => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const [mode, setMode] = useState<WorkspaceVideoMode>(initialMode);
  const [providerId, setProviderId] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<JobRecord | null>(null);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providerId, providers]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await jsonFetch<{ job: JobRecord | null }>(`/api/jobs/${job.id}`);
        if (data.job) setJob(data.job);
        const libraryData = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
        const updatedItem = libraryData.items.find((item) => item.id === job.libraryItemId);
        if (updatedItem) onResult(updatedItem, data.job || job);
        await onDone();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "任务查询失败。");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [job, onDone, onResult, setMessage]);

  const submit = useCallback(async () => {
    if (!providerId) {
      setMessage("请先到后台设置里启用视频生成入口。");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("providerId", providerId);
      form.set("mode", mode);
      form.set("ratio", ratio);
      form.set("duration", String(duration));
      form.set("prompt", prompt);
      Array.from(files || []).forEach((file) => form.append("files", file));
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", {
        method: "POST",
        body: form,
      });
      setJob(data.job);
      onResult(data.item, data.job);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频生成失败。");
    } finally {
      setLoading(false);
    }
  }, [duration, files, mode, onDone, onResult, prompt, providerId, ratio, setMessage]);

  useEffect(() => {
    registerMobileAction({
      label: "生成视频",
      loading,
      disabled: loading,
      onClick: submit,
    });
    return () => registerMobileAction(null);
  }, [loading, registerMobileAction, submit]);

  return (
    <FormPanel title="AI 视频生成器" subtitle="先写你要的视频，再选尺寸和时长。">
      <ModeSwitch
        value={mode}
        options={[
          ["text-to-video", "文生视频"],
          ["image-to-video", "图生视频"],
        ]}
        onChange={(value) => setMode(value as WorkspaceVideoMode)}
      />
      <ProviderSelect providers={providers} value={providerId} onChange={setProviderId} />
      <FileInput
        label="参考图片"
        optional={mode === "text-to-video"}
        accept="image/png,image/jpeg,image/webp"
        files={files}
        onChange={setFiles}
      />
      <StackedControl label="视频比例" required>
        <RatioPicker value={ratio} onChange={setRatio} />
      </StackedControl>
      <FieldFrame label="时长" required>
        <select
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          className="studio-select"
        >
          {[5, 8, 10, 15].map((value) => (
            <option key={value} value={value}>
              {value} 秒
            </option>
          ))}
        </select>
      </FieldFrame>
      <PromptBox
        value={prompt}
        onChange={setPrompt}
        required
        placeholder="描述视频画面、运动、镜头和氛围，例如：未来感产品展示，缓慢推进镜头，霓虹灯反射。"
      />
      <div className="studio-actions">
        <SubmitButton disabled={loading} loading={loading} onClick={submit}>
          生成视频
        </SubmitButton>
      </div>
    </FormPanel>
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

  const title = isVideo ? "视频高清" : "图片高清";
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
    <FormPanel title={title} subtitle={`上传单个${isVideo ? "视频" : "图片"}，使用本机工具放大到原始尺寸的 2x 或 4x。`}>
      <FieldFrame label={isVideo ? "源视频" : "源图片"} required>
        <input
          type="file"
          accept={accept}
          onChange={(event) => setFile(event.target.files?.[0] || null)}
          className="studio-file"
        />
        {file ? <span className="studio-help-text">已选择：{file.name}</span> : null}
      </FieldFrame>

      <StackedControl label="放大倍数" required>
        <ModeSwitch
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

      <div className="studio-actions">
        <SubmitButton disabled={loading || statusLoading} loading={loading} onClick={submit}>
          开始增强
        </SubmitButton>
        <span className="studio-help-text">本机增强，不需要 Key</span>
      </div>
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
        <ModeSwitch
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
        <ModeSwitch
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
  activeLabel,
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
  activeLabel: string;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onOpenLibrary: () => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];

  if (loading) {
    return (
      <div className="studio-preview">
        <div className="studio-preview__top">
          <div>
            <p className="shell-eyebrow">处理中</p>
            <h3>{meta.title}</h3>
            <p>{meta.loadingLabel}</p>
          </div>
          <span className="shell-chip">请稍候</span>
        </div>
        <div className="studio-preview__empty">
          <p>正在处理请求，生成完成后会在这里显示结果。</p>
        </div>
      </div>
    );
  }

  if (submitError) {
    return (
      <div className="studio-preview">
        <div className="studio-preview__top">
          <div>
            <p className="shell-eyebrow">失败</p>
            <h3>{meta.title}</h3>
            <p>{submitError}</p>
          </div>
          <span className="shell-chip">请重试</span>
        </div>
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
      </div>
    );
  }

  if (output) {
    return (
      <div className="studio-preview">
        <div className="studio-preview__top">
          <div>
            <p className="shell-eyebrow">结果</p>
            <h3>{output.title}</h3>
            <p>生成完成后，这里就是你的真实结果，支持直接查看和下载。</p>
          </div>
          <span className="shell-chip">{output.job?.status || output.item.status}</span>
        </div>
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
      </div>
    );
  }

  const content = imageWorkspaceModeMeta[mode];

  return (
    <div className="studio-preview">
      <div className="studio-preview__top">
        <div>
          <p className="shell-eyebrow">创作预览</p>
          <h3>{activeLabel || content.guideTitle}</h3>
          <p>{content.guideDescription}</p>
        </div>
        <span className="shell-chip">{libraryCount} 条作品</span>
      </div>
      <div className="studio-preview__empty">
        <p>上传素材开始创作，生成结果将在这里显示。</p>
      </div>
      <div className="studio-steps">
        {content.guideNotes.map((note, index) => (
          <div key={note} className="studio-step">
            <span>{index + 1}</span>
            <p>{note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutputPanel({
  tool,
  output,
  libraryCount,
  activeLabel,
}: {
  tool: BusinessToolId;
  output: OutputState;
  libraryCount: number;
  activeLabel: string;
}) {
  const content = previewContent[tool];

  if (!output) {
    return (
      <div className="studio-preview">
        <div className="studio-preview__top">
          <div>
            <p className="shell-eyebrow">创作预览</p>
            <h3>{activeLabel || content.title}</h3>
            <p>{content.desc}</p>
          </div>
          <span className="shell-chip">{libraryCount} 条作品</span>
        </div>
        <div className="studio-preview__media">
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
      </div>
    );
  }

  return (
    <div className="studio-preview">
      <div className="studio-preview__top">
        <div>
          <p className="shell-eyebrow">结果</p>
          <h3>{output.title}</h3>
          <p>生成完成后，这里就是你的真实结果，支持直接查看和下载。</p>
        </div>
        <span className="shell-chip">{output.job?.status || output.item.status}</span>
      </div>
      <MediaCard item={output.item} large />
    </div>
  );
}

function FormPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="studio-form-panel">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
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
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
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

function ModeSwitch({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-mode">
      {label ? <span className="studio-label">{label}</span> : null}
      <div className="studio-mode__options">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            data-testid={`mode-${id}`}
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
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="studio-select"
          disabled={loading || !providers.length}
          aria-invalid={Boolean(error)}
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
        {loading ? <p className="studio-help-text">正在读取后台已启用的图片模型。</p> : null}
        {!loading && !error && !providers.length ? (
          <p className="studio-help-text">
            当前尚未配置可用模型，请到 <a href="/admin/providers">后台设置</a> 启用对应模型。
          </p>
        ) : null}
        {error ? (
          <div className="studio-inline-error">
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
  files,
  onChange,
}: {
  label: string;
  optional: boolean;
  accept: string;
  files: FileList | null;
  onChange: (files: FileList | null) => void;
}) {
  return (
    <FieldFrame label={label} required={!optional} hint={optional ? "可选" : undefined}>
      <input
        type="file"
        accept={accept}
        multiple
        onChange={(event) => onChange(event.target.files)}
        className="studio-file"
      />
      {files?.length ? <span className="studio-help-text">已选择 {files.length} 个文件</span> : null}
    </FieldFrame>
  );
}

function RatioPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="studio-ratio">
      {ratios.map((ratio) => (
        <button
          key={ratio}
          type="button"
          data-testid={`ratio-${ratio.replace(":", "-")}`}
          onClick={() => onChange(ratio)}
          className={cn("studio-ratio__item", value === ratio && "is-active")}
        >
          <span className={cn("studio-ratio__shape", `ratio-${ratio.replace(":", "-")}`)} />
          <span className="studio-ratio__label">{ratio}</span>
        </button>
      ))}
    </div>
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
          className="studio-textarea"
        />
        <span className="studio-counter">{value.length}</span>
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
    <button type="button" data-testid="primary-submit" disabled={disabled} onClick={onClick} className="studio-primary-action">
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
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
