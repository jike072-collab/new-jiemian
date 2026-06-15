"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import type { JobRecord, LibraryItem, PublicProvider } from "@/lib/server/types";

type ToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";

type EnabledProviders = {
  image: PublicProvider[];
  video: PublicProvider[];
};

type UpscaleKind = "image" | "video";

type UpscaleAvailability = {
  ready: boolean;
  detail: string;
};

type UpscaleStatusResponse = Record<UpscaleKind, UpscaleAvailability>;

const navItems: Array<{ id: ToolId; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "image", label: "图片生成", desc: "文生图 / 图生图", icon: ImageIcon },
  { id: "video", label: "视频生成", desc: "文生视频 / 图生视频", icon: Film },
  { id: "image-upscale", label: "图片高清", desc: "本地 2x / 4x", icon: Maximize2 },
  { id: "video-upscale", label: "视频高清", desc: "本地 2x / 4x", icon: Sparkles },
  { id: "library", label: "作品库", desc: "本地历史", icon: FolderOpen },
];

const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4"];

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
  const [activeTool, setActiveTool] = useState<ToolId>("image");
  const [providers, setProviders] = useState<EnabledProviders>({ image: [], video: [] });
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("");

  async function refreshProviders() {
    const data = await jsonFetch<{ providers: EnabledProviders }>("/api/providers/enabled");
    setProviders(data.providers);
  }

  async function refreshLibrary() {
    const data = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
    setLibrary(data.items);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshProviders().catch((error: Error) => setMessage(error.message));
    refreshLibrary().catch(() => undefined);
  }, []);

  const activeMeta = useMemo(
    () => navItems.find((item) => item.id === activeTool) || navItems[0],
    [activeTool],
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#030305] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_62%_0%,rgba(236,0,122,0.24),transparent_32%),radial-gradient(circle_at_20%_20%,rgba(112,48,255,0.18),transparent_28%)]" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[292px] border-r border-white/10 bg-black/80 px-4 py-5 backdrop-blur-xl lg:block">
        <BrandBlock />
        <nav className="mt-8 grid gap-2">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTool === item.id}
              onClick={() => setActiveTool(item.id)}
            />
          ))}
        </nav>
        <a
          href="/admin/providers"
          className="absolute inset-x-4 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition hover:border-fuchsia-400/50 hover:text-white"
        >
          <Settings className="size-4" />
          供应商设置
        </a>
      </aside>

      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-black/80 px-4 backdrop-blur-xl lg:hidden">
        <BrandBlock compact />
        <a href="/admin/providers" className="rounded-full bg-white/10 p-2 text-white/80">
          <Settings className="size-5" />
        </a>
      </header>

      <main className="relative z-10 px-4 pb-24 pt-20 lg:ml-[292px] lg:px-8 lg:pb-10 lg:pt-8">
        <section className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-fuchsia-300/80">AOHUANG AI STUDIO</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">{activeMeta.label}</h1>
              <p className="mt-3 max-w-2xl text-white/55">
                本地优先的 AI 创作工作台。密钥只保存在本机，前台只显示已经启用的模型。
              </p>
            </div>
            <div className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
              {providers.image.length} 个图片模型 · {providers.video.length} 个视频模型
            </div>
          </div>

          {message ? (
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {message}
            </div>
          ) : null}

          {activeTool === "image" ? (
            <ImageGenerator providers={providers.image} onDone={refreshLibrary} setMessage={setMessage} />
          ) : null}
          {activeTool === "video" ? (
            <VideoGenerator providers={providers.video} onDone={refreshLibrary} setMessage={setMessage} />
          ) : null}
          {activeTool === "image-upscale" ? (
            <UpscaleForm kind="image" onDone={refreshLibrary} setMessage={setMessage} />
          ) : null}
          {activeTool === "video-upscale" ? (
            <UpscaleForm kind="video" onDone={refreshLibrary} setMessage={setMessage} />
          ) : null}
          {activeTool === "library" ? (
            <LibraryView items={library} refresh={refreshLibrary} setMessage={setMessage} />
          ) : null}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-black/90 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTool(item.id)}
              className={cn(
                "grid place-items-center gap-1 rounded-2xl px-1 py-2 text-[11px] text-white/55",
                activeTool === item.id && "bg-fuchsia-500/15 text-fuchsia-200",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function BrandBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-[0_0_36px_rgba(217,70,239,0.32)]">
        <BrandLogo className="size-7" />
      </div>
      <div>
        <strong className={cn("block font-black tracking-tight", compact ? "text-base" : "text-xl")}>奥皇 AI</strong>
        <small className="text-xs text-white/45">图片与视频生成工作台</small>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: (typeof navItems)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition",
        active
          ? "bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white shadow-[0_16px_40px_rgba(192,38,211,0.22)]"
          : "text-white/62 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <Icon className="size-5" />
      <span>
        <span className="block text-sm font-bold">{item.label}</span>
        <span className="text-xs opacity-65">{item.desc}</span>
      </span>
    </button>
  );
}

function ImageGenerator({
  providers,
  onDone,
  setMessage,
}: {
  providers: PublicProvider[];
  onDone: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<"text-to-image" | "image-to-image">("text-to-image");
  const [providerId, setProviderId] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("1k");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LibraryItem | null>(null);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providerId, providers]);

  async function submit() {
    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("providerId", providerId);
      form.set("mode", mode);
      form.set("ratio", ratio);
      form.set("quality", quality);
      form.set("prompt", prompt);
      Array.from(files || []).forEach((file) => form.append("files", file));
      const data = await jsonFetch<{ item: LibraryItem }>("/api/generate/image", {
        method: "POST",
        body: form,
      });
      setResult(data.item);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <GeneratorGrid
      form={(
        <Panel title="图片生成器" subtitle="输入提示词，可选择上传参考图做图片编辑。">
          <ModeSwitch
            value={mode}
            options={[
              ["text-to-image", "文生图"],
              ["image-to-image", "图生图 / 编辑"],
            ]}
            onChange={(value) => setMode(value as typeof mode)}
          />
          <ProviderSelect providers={providers} value={providerId} onChange={setProviderId} />
          <FileInput
            label="参考图片"
            optional={mode === "text-to-image"}
            accept="image/png,image/jpeg,image/webp"
            files={files}
            onChange={setFiles}
          />
          <RatioPicker value={ratio} onChange={setRatio} />
          <ModeSwitch
            label="清晰度"
            value={quality}
            options={[
              ["1k", "1K"],
              ["2k", "2K"],
            ]}
            onChange={setQuality}
          />
          <PromptBox value={prompt} onChange={setPrompt} placeholder="描述你想生成或修改的画面，例如：把人物换到赛博朋克城市夜景中，保留服装轮廓。" />
          <SubmitButton disabled={!providers.length || loading} loading={loading} onClick={submit}>
            立即生成图片
          </SubmitButton>
        </Panel>
      )}
      preview={<ResultPreview item={result} emptyTitle="等待图片生成" />}
    />
  );
}

function VideoGenerator({
  providers,
  onDone,
  setMessage,
}: {
  providers: PublicProvider[];
  onDone: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<"text-to-video" | "image-to-video">("text-to-video");
  const [providerId, setProviderId] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LibraryItem | null>(null);
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
        if (updatedItem) setResult(updatedItem);
        await onDone();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "任务查询失败。");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [job, onDone, setMessage]);

  async function submit() {
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
      setResult(data.item);
      setJob(data.job);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频生成失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <GeneratorGrid
      form={(
        <Panel title="视频生成器" subtitle="支持纯提示词生成，也支持上传参考图进行图生视频。">
          <ModeSwitch
            value={mode}
            options={[
              ["text-to-video", "文生视频"],
              ["image-to-video", "图生视频"],
            ]}
            onChange={(value) => setMode(value as typeof mode)}
          />
          <ProviderSelect providers={providers} value={providerId} onChange={setProviderId} />
          <FileInput
            label="参考图片"
            optional={mode === "text-to-video"}
            accept="image/png,image/jpeg,image/webp"
            files={files}
            onChange={setFiles}
          />
          <RatioPicker value={ratio} onChange={setRatio} />
          <label className="grid min-w-0 gap-2 text-sm text-white/70">
            时长
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="h-12 rounded-2xl border border-white/10 bg-black/45 px-4 text-white outline-none focus:border-fuchsia-400"
            >
              {[5, 8, 10, 15].map((value) => <option key={value} value={value}>{value} 秒</option>)}
            </select>
          </label>
          <PromptBox value={prompt} onChange={setPrompt} placeholder="描述视频画面、运动、镜头和氛围，例如：未来感产品展示，缓慢推进镜头，霓虹灯反射。" />
          <SubmitButton disabled={!providers.length || loading} loading={loading} onClick={submit}>
            立即生成视频
          </SubmitButton>
        </Panel>
      )}
      preview={<ResultPreview item={result} job={job} emptyTitle="等待视频生成" />}
    />
  );
}

function GeneratorGrid({ form, preview }: { form: React.ReactNode; preview: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      {form}
      {preview}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[2rem] border border-white/10 bg-[#101012]/90 p-5 shadow-2xl shadow-black/30">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-white/48">{subtitle}</p>
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
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
    <div className="grid gap-2">
      {label ? <span className="text-sm text-white/70">{label}</span> : null}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/35 p-1">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-bold text-white/55 transition",
              value === id && "bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20",
            )}
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
  onChange,
}: {
  providers: PublicProvider[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm text-white/70">
      模型
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-2xl border border-white/10 bg-black/45 px-4 text-white outline-none focus:border-fuchsia-400"
      >
        {providers.length ? providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.model} · {provider.title}
          </option>
        )) : <option value="">后台尚未启用模型</option>}
      </select>
    </label>
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
    <label className="grid gap-2 text-sm text-white/70">
      {label} {optional ? <span className="text-white/35">可选</span> : <span className="text-fuchsia-300">*</span>}
      <input
        type="file"
        accept={accept}
        multiple
        onChange={(event) => onChange(event.target.files)}
        className="rounded-2xl border border-dashed border-white/15 bg-black/35 p-4 text-sm text-white/55 file:mr-4 file:rounded-xl file:border-0 file:bg-fuchsia-500 file:px-3 file:py-2 file:text-white"
      />
      {files?.length ? <span className="text-xs text-fuchsia-200">已选择 {files.length} 个文件</span> : null}
    </label>
  );
}

function RatioPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm text-white/70">比例</span>
      <div className="grid min-w-0 grid-cols-5 gap-1.5 sm:gap-2">
        {ratios.map((ratio) => (
          <button
            key={ratio}
            type="button"
            onClick={() => onChange(ratio)}
            className={cn(
              "min-w-0 rounded-2xl border border-white/10 px-0.5 py-3 text-xs font-bold text-white/55 transition hover:border-fuchsia-300/40 sm:px-2 sm:text-sm",
              value === ratio && "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100",
            )}
          >
            {ratio}
          </button>
        ))}
      </div>
    </div>
  );
}

function PromptBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-white/70">
      提示词
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={3000}
        placeholder={placeholder}
        className="min-h-36 resize-none rounded-2xl border border-white/10 bg-black/45 p-4 text-white outline-none placeholder:text-white/25 focus:border-fuchsia-400"
      />
      <span className="text-right text-xs text-white/35">{value.length}/3000</span>
    </label>
  );
}

function SubmitButton({
  disabled,
  loading,
  children,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 px-5 font-black text-white shadow-[0_20px_50px_rgba(219,39,119,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
      {children}
    </button>
  );
}

function ResultPreview({
  item,
  job,
  emptyTitle,
}: {
  item: LibraryItem | null;
  job?: JobRecord | null;
  emptyTitle: string;
}) {
  return (
    <section className="min-w-0 min-h-[520px] rounded-[2rem] border border-white/10 bg-[#0b0b0d]/85 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black">结果预览</h2>
          <p className="text-sm text-white/45">{job ? `任务状态：${job.status}` : "生成完成后会自动保存到作品库。"}</p>
        </div>
      </div>
      {!item ? (
        <div className="grid h-[420px] place-items-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] text-center text-white/35">
          <div>
            <Sparkles className="mx-auto mb-3 size-8 text-fuchsia-300/70" />
            {emptyTitle}
          </div>
        </div>
      ) : (
        <MediaCard item={item} large />
      )}
    </section>
  );
}

function UpscaleForm({
  kind,
  onDone,
  setMessage,
}: {
  kind: UpscaleKind;
  onDone: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const isVideo = kind === "video";
  const [scale, setScale] = useState("2");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [availability, setAvailability] = useState<UpscaleAvailability | null>(null);
  const [result, setResult] = useState<LibraryItem | null>(null);
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
        if (updatedItem) setResult(updatedItem);
        await onDone();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "高清任务查询失败。");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isVideo, job, onDone, setMessage]);

  async function submit() {
    if (!file) {
      setMessage(`请选择一个${isVideo ? "视频" : "图片"}文件。`);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("scale", scale);
      const data = await jsonFetch<{ item: LibraryItem; job: JobRecord | null }>(
        `/api/upscale/${kind}`,
        {
          method: "POST",
          body: form,
        },
      );
      setResult(data.item);
      setJob(data.job);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${isVideo ? "视频" : "图片"}高清处理失败。`);
    } finally {
      setLoading(false);
    }
  }

  const title = isVideo ? "视频高清" : "图片高清";
  const accept = isVideo
    ? "video/mp4,video/webm,video/quicktime,.mov"
    : "image/png,image/jpeg,image/webp";

  return (
    <GeneratorGrid
      form={(
        <Panel
          title={title}
          subtitle={`上传单个${isVideo ? "视频" : "图片"}，使用本机工具放大到原始尺寸的 2x 或 4x。`}
        >
          <label className="grid gap-2 text-sm text-white/70">
            {isVideo ? "源视频" : "源图片"} <span className="text-fuchsia-300">*</span>
            <input
              type="file"
              accept={accept}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="w-full min-w-0 max-w-full rounded-2xl border border-dashed border-white/15 bg-black/35 p-4 text-sm text-white/55 file:mr-4 file:rounded-xl file:border-0 file:bg-fuchsia-500 file:px-3 file:py-2 file:text-white"
            />
            {file ? <span className="truncate text-xs text-fuchsia-200">已选择：{file.name}</span> : null}
          </label>

          <ModeSwitch
            label="放大倍数"
            value={scale}
            options={[
              ["2", "2x"],
              ["4", "4x"],
            ]}
            onChange={setScale}
          />

          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-sm",
              availability?.ready
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                : "border-amber-400/30 bg-amber-500/10 text-amber-100",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block">
                  {statusLoading
                    ? "正在检测本机依赖..."
                    : availability?.ready
                      ? "本机依赖已就绪"
                      : "本机依赖未检测到"}
                </strong>
                {!statusLoading ? (
                  <p className="mt-1 break-all text-xs opacity-75">
                    {availability?.detail || "请先安装并配置对应的本地高清处理依赖。"}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={checkAvailability}
                disabled={statusLoading}
                className="shrink-0 rounded-xl border border-current/20 p-2 transition hover:bg-white/10 disabled:opacity-50"
                aria-label="重新检测本机依赖"
              >
                <RefreshCw className={cn("size-4", statusLoading && "animate-spin")} />
              </button>
            </div>
          </div>

          <SubmitButton
            disabled={!file || loading || statusLoading || !availability?.ready}
            loading={loading}
            onClick={submit}
          >
            开始{title}
          </SubmitButton>
        </Panel>
      )}
      preview={(
        <ResultPreview
          item={result}
          job={job}
          emptyTitle={`等待${title}处理`}
        />
      )}
    />
  );
}

function LibraryView({
  items,
  refresh,
  setMessage,
}: {
  items: LibraryItem[];
  refresh: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  async function remove(id: string) {
    try {
      await jsonFetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败。");
    }
  }

  if (!items.length) {
    return (
      <section className="rounded-[2rem] border border-white/10 bg-[#101012]/90 p-10 text-center text-white/45">
        作品库还是空的。生成图片或视频后会自动出现在这里。
      </section>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-[1.5rem] border border-white/10 bg-[#101012]/90 p-3">
          <MediaCard item={item} />
          <button
            type="button"
            onClick={() => remove(item.id)}
            className="mt-3 w-full rounded-2xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:border-red-400/40 hover:text-red-100"
          >
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

function MediaCard({ item, large = false }: { item: LibraryItem; large?: boolean }) {
  const media = item.output;
  return (
    <article className="overflow-hidden rounded-[1.2rem] bg-black/35">
      <div className={cn("grid place-items-center bg-black", large ? "min-h-[440px]" : "aspect-video")}>
        {media?.url && item.type === "image" ? (
          <img src={media.url} alt={item.title} className="max-h-full w-full object-contain" />
        ) : null}
        {media?.url && item.type === "video" ? (
          <video src={media.url} controls className="max-h-full w-full" />
        ) : null}
        {!media?.url ? <span className="text-white/35">{item.status}</span> : null}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="line-clamp-1 text-sm">{item.title}</strong>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/55">{item.status}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-white/45">{item.prompt}</p>
        {media?.url ? (
          <a href={media.url} download className="mt-3 inline-flex text-sm font-bold text-fuchsia-200">
            下载结果
          </a>
        ) : null}
      </div>
    </article>
  );
}
