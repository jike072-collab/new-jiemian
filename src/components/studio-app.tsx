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
  UserRound,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import type { JobRecord, LibraryItem, PublicProvider } from "@/lib/server/types";

type ToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";
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
  tool: ToolId;
} | null;

const navItems: Array<{
  id: ToolId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "image", label: "图片生成", desc: "文生图 / 图生图", icon: ImageIcon },
  { id: "video", label: "视频生成", desc: "文生视频 / 图生视频", icon: Film },
  { id: "image-upscale", label: "图片放大", desc: "本机 2x / 4x", icon: Maximize2 },
  { id: "video-upscale", label: "视频放大", desc: "本机增强", icon: Sparkles },
  { id: "library", label: "作品库", desc: "历史结果", icon: FolderOpen },
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

  async function refreshLibrary() {
    const data = await jsonFetch<{ items: LibraryItem[] }>("/api/library");
    setLibrary(data.items);
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [providersData, libraryData] = await Promise.all([
          jsonFetch<{ providers: EnabledProviders }>("/api/providers/enabled"),
          jsonFetch<{ items: LibraryItem[] }>("/api/library"),
        ]);
        if (cancelled) return;
        setProviders(providersData.providers);
        setLibrary(libraryData.items);
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "加载失败。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-shell h-screen w-screen bg-[#050507] text-white">
      <div className="grain-layer fixed" />
      <span className="particle particle-slow left-[10%] top-[16%] size-2" />
      <span className="particle particle-fast left-[76%] top-[12%] size-1.5" />
      <span className="particle particle-slow left-[58%] top-[76%] size-2" />

      <main id="top" className="relative z-10 h-full w-full min-w-0 overflow-hidden">
        <GeneratorShell
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          providers={providers}
          library={library}
          refreshLibrary={refreshLibrary}
          setMessage={setMessage}
        />
      </main>

      <nav data-testid="mobile-tool-nav" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-white/10 bg-black/90 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl xl:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              data-testid={`mobile-tool-${item.id}`}
              onClick={() => setActiveTool(item.id)}
              className={cn(
                "clickable grid place-items-center gap-1 rounded-2xl px-1 py-2 text-[11px] text-white/52 transition",
                activeTool === item.id && "bg-fuchsia-500/15 text-fuchsia-200",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
    </div>
  );
}

function GeneratorShell({
  activeTool,
  setActiveTool,
  providers,
  library,
  refreshLibrary,
  setMessage,
}: {
  activeTool: ToolId;
  setActiveTool: (value: ToolId) => void;
  providers: EnabledProviders;
  library: LibraryItem[];
  refreshLibrary: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const activeMeta = useMemo(
    () => navItems.find((item) => item.id === activeTool) || navItems[0],
    [activeTool],
  );
  const [outputs, setOutputs] = useState<Partial<Record<ToolId, OutputState>>>({});
  const activeOutput = outputs[activeTool] || null;

  return (
    <section id="generate" className="app-shell">
      <aside className="app-sidebar rounded-[2rem] border border-white/10 bg-black/45 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-3 px-2 pt-1">
          <div className="grid size-11 place-items-center rounded-2xl bg-white/10">
            <BrandLogo className="size-7" />
          </div>
          <div>
            <h1 className="text-lg font-black">奥皇 AI</h1>
            <p className="text-xs text-white/42">图片与视频工作台</p>
          </div>
        </div>
        <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
          左边选功能，中间填信息，右边看结果。
        </div>
        <nav className="mt-4 grid gap-2">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              testIdPrefix="tool"
              active={activeTool === item.id}
              onClick={() => setActiveTool(item.id)}
            />
          ))}
        </nav>
        <div className="mt-auto grid gap-3 px-1">
          <div className="grid grid-cols-2 gap-2">
            <HeroStat label="图片" value={providers.image.length ? `${providers.image.length} 个入口` : "待配置"} />
            <HeroStat label="视频" value={providers.video.length ? `${providers.video.length} 个入口` : "待配置"} />
          </div>
          <a
            href="/admin/providers"
            className="clickable flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition hover:border-fuchsia-400/50 hover:text-white"
          >
            <Settings className="size-4" />
            后台设置
          </a>
          <a
            href="/login"
            className="clickable flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/15"
          >
            <UserRound className="size-4" />
            客户登录
          </a>
        </div>
      </aside>

      <section className="app-tool-panel soft-card flex flex-col rounded-[2rem] border border-white/10 bg-[#0d0d11]/94 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/75">Input</p>
            <h2 className="mt-1 text-2xl font-black">{activeMeta.label}</h2>
            <p className="mt-1 text-sm text-white/50">{activeMeta.desc}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">积分位预留</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">当前可直接使用</span>
            <a href="/login" className="clickable rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-cyan-100">
              客户登录
            </a>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
          {activeTool === "image" ? (
            <ImageGenerator
              providers={providers.image}
              onDone={refreshLibrary}
              onResult={(item) => setOutputs((prev) => ({ ...prev, image: { item, title: "图片结果", tool: "image" } }))}
              setMessage={setMessage}
            />
          ) : null}
          {activeTool === "video" ? (
            <VideoGenerator
              providers={providers.video}
              onDone={refreshLibrary}
              onResult={(item, job) => setOutputs((prev) => ({ ...prev, video: { item, job, title: "视频结果", tool: "video" } }))}
              setMessage={setMessage}
            />
          ) : null}
          {activeTool === "image-upscale" ? (
            <UpscaleForm
              kind="image"
              onDone={refreshLibrary}
              onResult={(item, job) => setOutputs((prev) => ({ ...prev, "image-upscale": { item, job, title: "图片放大结果", tool: "image-upscale" } }))}
              setMessage={setMessage}
            />
          ) : null}
          {activeTool === "video-upscale" ? (
            <UpscaleForm
              kind="video"
              onDone={refreshLibrary}
              onResult={(item, job) => setOutputs((prev) => ({ ...prev, "video-upscale": { item, job, title: "视频放大结果", tool: "video-upscale" } }))}
              setMessage={setMessage}
            />
          ) : null}
          {activeTool === "library" ? (
            <LibraryView items={library} refresh={refreshLibrary} setMessage={setMessage} />
          ) : null}
        </div>
      </section>

      <aside className="app-workspace workspace-card soft-card flex flex-col rounded-[2rem] border border-white/10 bg-black/45 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 md:px-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">Output</p>
            <h2 className="mt-1 text-xl font-black">展示区</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/45">
            {library.length} 条作品
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          <OutputPanel tool={activeTool} output={activeOutput} />
        </div>
      </aside>
    </section>
  );
}

function ImageGenerator({
  providers,
  onDone,
  onResult,
  setMessage,
}: {
  providers: PublicProvider[];
  onDone: () => Promise<void>;
  onResult: (item: LibraryItem) => void;
  setMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<"text-to-image" | "image-to-image">("text-to-image");
  const [providerId, setProviderId] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("1k");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providerId, providers]);

  async function submit() {
    if (!providerId) {
      setMessage("请先到后台设置里启用图片生成入口。");
      return;
    }

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
      onResult(data.item);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Panel title="图片生成器" subtitle="先输入内容，再选比例和清晰度。">
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
        <StackedControl label="图片比例" required>
          <RatioPicker value={ratio} onChange={setRatio} />
        </StackedControl>
        <StackedControl label="清晰度" required>
          <ModeSwitch
            value={quality}
            options={[
              ["1k", "1K · 4 积分"],
              ["2k", "2K · 8 积分"],
            ]}
            onChange={setQuality}
          />
        </StackedControl>
        <PromptBox
          value={prompt}
          onChange={setPrompt}
          required
          placeholder="描述你想生成或修改的画面，例如：把人物换到赛博朋克城市夜景中，保留服装轮廓。"
        />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={loading} loading={loading} onClick={submit}>
            立即生成图片
          </SubmitButton>
          <span className="text-sm text-white/45">清晰度位置已预留积分提示</span>
        </div>
      </Panel>
    </div>
  );
}

function VideoGenerator({
  providers,
  onDone,
  onResult,
  setMessage,
}: {
  providers: PublicProvider[];
  onDone: () => Promise<void>;
  onResult: (item: LibraryItem, job?: JobRecord | null) => void;
  setMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<"text-to-video" | "image-to-video">("text-to-video");
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

  async function submit() {
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
  }

  return (
    <div className="grid gap-4">
      <Panel title="视频生成器" subtitle="先写你要的视频，再选尺寸和时长。">
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
        <StackedControl label="视频比例" required>
          <RatioPicker value={ratio} onChange={setRatio} />
        </StackedControl>
        <FieldFrame label="时长" required>
          <select
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="h-12 w-full rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
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
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={loading} loading={loading} onClick={submit}>
            立即生成视频
          </SubmitButton>
          <span className="text-sm text-white/45">同样预留积分位</span>
        </div>
      </Panel>
    </div>
  );
}

function UpscaleForm({
  kind,
  onDone,
  onResult,
  setMessage,
}: {
  kind: UpscaleKind;
  onDone: () => Promise<void>;
  onResult: (item: LibraryItem, job?: JobRecord | null) => void;
  setMessage: (value: string) => void;
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

  async function submit() {
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
  }

  const title = isVideo ? "视频放大" : "图片放大";
  const accept = isVideo ? "video/mp4,video/webm,video/quicktime,.mov" : "image/png,image/jpeg,image/webp";

  return (
    <div className="grid gap-4">
      <Panel title={title} subtitle={`上传单个${isVideo ? "视频" : "图片"}，使用本机工具放大到原始尺寸的 2x 或 4x。`}>
        <FieldFrame label={isVideo ? "源视频" : "源图片"} required>
          <input
            type="file"
            accept={accept}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="w-full min-w-0 max-w-full rounded-[1.25rem] border border-dashed border-white/15 bg-black/35 p-4 text-sm text-white/55 file:mr-4 file:rounded-xl file:border-0 file:bg-fuchsia-500 file:px-3 file:py-2 file:text-white"
          />
          {file ? <span className="mt-2 block truncate text-xs text-fuchsia-200">已选择：{file.name}</span> : null}
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
            "rounded-2xl border px-4 py-3 text-sm transition",
            availability?.ready
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
              : "border-amber-400/30 bg-amber-500/10 text-amber-100",
          )}
        >
          <div className="flex items-start justify-between gap-3">
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
              className="shrink-0 rounded-xl border border-current/20 p-2 transition hover:bg-white/10 disabled:opacity-50"
              aria-label="重新检测本机依赖"
            >
              <RefreshCw className={cn("size-4", statusLoading && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={loading || statusLoading} loading={loading} onClick={submit}>
            开始处理
          </SubmitButton>
          <span className="text-sm text-white/45">本机增强，不需要 Key</span>
        </div>
      </Panel>
    </div>
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
      <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
        作品库还是空的。生成图片或视频后会自动出现在这里。
      </section>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3">
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
        {media?.url && item.type === "image" ? <img src={media.url} alt={item.title} className="max-h-full w-full object-contain" /> : null}
        {media?.url && item.type === "video" ? <video src={media.url} controls className="max-h-full w-full" /> : null}
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

function OutputPanel({ tool, output }: { tool: ToolId; output: OutputState }) {
  const content = previewContent[tool];

  if (!output) {
    return (
      <div className="grid gap-4">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/70">Output</p>
              <h3 className="mt-1 text-xl font-black">先这样，再这样，就能看到结果</h3>
              <p className="mt-1 text-sm leading-6 text-white/52">
                你还没生成内容时，这里先用教学方式告诉你下一步做什么；生成以后会直接换成真实结果。
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-white/45">
              {content.title}
            </span>
          </div>

          <div className="grid gap-4 p-4">
            <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/35">
              <img src={content.image} alt={content.title} className="aspect-[4/3] w-full object-cover" />
            </div>
            <div className="grid gap-3">
              {content.notes.map((note, index) => (
                <div key={note} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-xs font-bold text-fuchsia-100">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/90">{index === 0 ? "先这样" : index === 1 ? "再这样" : "就能这样"}</p>
                    <p className="mt-1 text-sm leading-6 text-white/55">{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">当前工具</strong>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">
              {navItems.find((item) => item.id === tool)?.label}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStep label="先填内容" desc="把主体、画面和风格说清楚。" />
            <MiniStep label="再选参数" desc="比例、清晰度、时长都在这里。" />
            <MiniStep label="最后生成" desc="点按钮后，结果直接出现在右边。" />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/70">Output</p>
            <h3 className="mt-1 text-xl font-black">{output.title}</h3>
            <p className="mt-1 text-sm leading-6 text-white/52">
              生成完成后，这里就是你的真实结果，支持直接查看和下载。
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-white/45">
            {output.job?.status || output.item.status}
          </span>
        </div>

        <div className="p-4">
          <MediaCard item={output.item} large />
        </div>
      </section>

      <section className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStep label="结果已到位" desc="不用往下找，预览就在右边。" />
          <MiniStep label="继续微调" desc="改内容后再点一次，就会刷新。" />
          <MiniStep label="随时下载" desc="结果一出来就能直接保存。" />
        </div>
      </section>
    </div>
  );
}

function MiniStep({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <p className="text-sm font-semibold text-white/90">{label}</p>
      <p className="mt-1 text-sm leading-6 text-white/55">{desc}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-white/48">{subtitle}</p>
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
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
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-white/70">{label}</span>
        {required ? (
          <span className="shrink-0 text-[11px] font-black leading-none text-red-400">*</span>
        ) : hint ? (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">{hint}</span>
        ) : null}
      </div>
      <div className="min-w-0 rounded-[1.6rem] border border-white/10 bg-black/20 p-2">{children}</div>
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
    <div className="grid gap-2">
      {label ? <span className="text-sm text-white/70">{label}</span> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            data-testid={`mode-${id}`}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-2xl border border-white/10 px-3 py-3 text-sm font-semibold text-white/68 transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-400/40 hover:bg-white/5",
              value === id && "border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100 shadow-[0_12px_24px_rgba(217,70,239,0.14)]",
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
    <FieldFrame label="模型" required>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
      >
        {providers.length ? (
          providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.model} · {provider.title}
            </option>
          ))
        ) : (
          <option value="">后台尚未启用模型</option>
        )}
      </select>
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
        className="w-full rounded-[1.25rem] border border-dashed border-white/15 bg-black/30 p-4 text-sm text-white/55 file:mr-4 file:rounded-xl file:border-0 file:bg-fuchsia-500 file:px-3 file:py-2 file:text-white"
      />
      {files?.length ? <span className="mt-2 block text-xs text-fuchsia-200">已选择 {files.length} 个文件</span> : null}
    </FieldFrame>
  );
}

function RatioPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-white/70">比例</span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">上面有对应框的样子</span>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-5">
        {ratios.map((ratio) => (
          <button
            key={ratio}
            type="button"
            data-testid={`ratio-${ratio.replace(":", "-")}`}
            onClick={() => onChange(ratio)}
            className={cn(
              "flex h-14 min-w-0 flex-col items-center justify-center rounded-[1.1rem] border border-white/10 bg-black/20 text-sm font-semibold text-white/60 transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-300/40 hover:bg-white/[0.06]",
              value === ratio && "border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100 shadow-[0_14px_30px_rgba(217,70,239,0.12)]",
            )}
          >
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">Size</span>
            <span className="text-sm">{ratio}</span>
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
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <FieldFrame label="提示词" required={required}>
      <textarea
        data-testid="prompt-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={3000}
        placeholder={placeholder}
        className="min-h-36 w-full resize-none rounded-[1.25rem] border border-white/10 bg-black/30 p-4 text-white outline-none placeholder:text-white/25 transition duration-200 focus:border-fuchsia-400 focus:bg-black/45"
      />
      <span className="mt-2 block text-right text-xs text-white/35">{value.length}/3000</span>
    </FieldFrame>
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
      data-testid="primary-submit"
      disabled={disabled}
      onClick={onClick}
      className="group flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 px-5 font-semibold text-white shadow-[0_16px_32px_rgba(168,85,247,0.25)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(168,85,247,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4 transition group-hover:rotate-12" />}
      {children}
    </button>
  );
}

function NavButton({
  item,
  testIdPrefix,
  active,
  onClick,
}: {
  item: (typeof navItems)[number];
  testIdPrefix: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-label={item.label}
      data-testid={`${testIdPrefix}-${item.id}`}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5",
        active
          ? "bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white shadow-[0_16px_40px_rgba(192,38,211,0.22)]"
          : "border border-white/10 bg-white/[0.03] text-white/62 hover:border-fuchsia-400/40 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="size-5" />
      <span>
        <span className="block text-sm font-semibold">{item.label}</span>
        <span className="text-xs opacity-65">{item.desc}</span>
      </span>
    </button>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white/88">{value}</p>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-20 right-4 z-[60] max-w-sm rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-100 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      {message}
    </div>
  );
}

const previewContent: Record<
  ToolId,
  { title: string; desc: string; image: string; notes: string[] }
> = {
  image: {
    title: "图片生成右侧示例",
    desc: "让用户一眼看到效果，再去写提示词。",
    image: "/images/reference/hero-cover.png",
    notes: ["适合直接替换为你的真实生成图", "比例和清晰度区会更像参考站", "首屏先像产品页，再像工具页"],
  },
  video: {
    title: "视频生成右侧示例",
    desc: "先放预览封面，后面可以接结果视频。",
    image: "/images/reference/sample-1.png",
    notes: ["后面可换成视频帧截图", "右侧预览维持参考站的节奏", "生成前就让人知道结果长什么样"],
  },
  "image-upscale": {
    title: "图片放大说明",
    desc: "把本机增强作为一个明确能力，不让用户猜。",
    image: "/images/reference/sample-2.png",
    notes: ["展示 Upscayl 本机增强", "提示不需要 Key", "把处理结果放进作品库"],
  },
  "video-upscale": {
    title: "视频放大说明",
    desc: "把 Video2X 放在更容易懂的位置。",
    image: "/images/reference/sample-3.png",
    notes: ["展示 Video2X 视频增强", "保留依赖检测状态", "保持和图片放大同一套节奏"],
  },
  library: {
    title: "作品库示例",
    desc: "把历史结果做成一眼能扫的卡片。",
    image: "/images/reference/hero-cover.png",
    notes: ["历史结果、状态和下载都保留", "库里也要像产品页一样清楚", "不要让用户猜每张卡的用途"],
  },
};
