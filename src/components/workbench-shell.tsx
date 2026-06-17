"use client";

import Link from "next/link";
import { type ComponentType, type RefObject, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Menu,
  Maximize2,
  PanelLeft,
  PanelRight,
  Settings,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

type ToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";
type ShellPane = "parameters" | "preview";
type ShellViewportMode = "desktop" | "tablet" | "mobile";

type ToolMeta = {
  label: string;
  description: string;
  section: string;
  preview: string;
};

const navItems: Array<{
  id: ToolId;
  label: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "image", label: "AI 图像生成器", desc: "文字转图 / 图转图", icon: ImageIcon },
  { id: "video", label: "AI 视频生成器", desc: "文生视频 / 图生视频", icon: Film },
  { id: "image-upscale", label: "图片高清", desc: "本机 2x / 4x", icon: Maximize2 },
  { id: "video-upscale", label: "视频高清", desc: "本机增强", icon: Sparkles },
  { id: "library", label: "作品库", desc: "历史结果", icon: FolderOpen },
];

const navGroups = [
  { title: "创建与增强", items: navItems.slice(0, 4) },
  { title: "作品", items: navItems.slice(4) },
] as const;

const toolMeta: Record<ToolId, ToolMeta> = {
  image: {
    label: "AI 图像生成器",
    description: "保留容器、路由和切换逻辑，后续工具表单由下一模块接入。",
    section: "图像工作台壳层",
    preview: "右侧预留引导与结果容器。",
  },
  video: {
    label: "AI 视频生成器",
    description: "桌面三列和手机切换保持统一，业务表单暂不渲染。",
    section: "视频工作台壳层",
    preview: "右侧预留引导区、结果区和空状态区。",
  },
  "image-upscale": {
    label: "图片高清",
    description: "保留本机工具入口与布局容器，不接入处理接口。",
    section: "增强工具壳层",
    preview: "右侧后续承接增强结果与说明插槽。",
  },
  "video-upscale": {
    label: "视频高清",
    description: "保持与桌面和手机断点一致的壳层行为。",
    section: "增强工具壳层",
    preview: "右侧后续承接增强结果与说明插槽。",
  },
  library: {
    label: "作品库",
    description: "保留历史结果入口，当前只展示壳层和占位状态。",
    section: "作品工作台壳层",
    preview: "右侧后续承接作品预览与详情插槽。",
  },
};

export function WorkbenchShell() {
  const [activeTool, setActiveTool] = useState<ToolId>("image");
  const [pane, setPane] = useState<ShellPane>("parameters");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [viewportMode, setViewportMode] = useState<ShellViewportMode>("mobile");
  const parameterScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const activeMeta = toolMeta[activeTool];

  useEffect(() => {
    const updateViewportMode = () => {
      setViewportMode(getViewportMode(window.innerWidth));
    };

    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);

  useEffect(() => {
    parameterScrollRef.current?.scrollTo({ top: 0 });
    previewScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTool]);

  const handleSelectTool = (tool: ToolId) => {
    parameterScrollRef.current?.scrollTo({ top: 0 });
    previewScrollRef.current?.scrollTo({ top: 0 });
    setPane("parameters");
    setDrawerOpen(false);
    setAccountOpen(false);
    setActiveTool(tool);
  };

  useEffect(() => {
    if (!drawerOpen && !accountOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, accountOpen]);

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-hidden bg-[#050507] text-white">
      <TopBar
        mode={viewportMode}
        drawerOpen={drawerOpen}
        loggedIn={loggedIn}
        accountOpen={accountOpen}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
        onToggleAccount={() => setAccountOpen((value) => !value)}
        onLogIn={() => setLoggedIn(true)}
        onLogOut={() => setLoggedIn(false)}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {viewportMode === "desktop" ? (
          <div className="grid min-h-0 w-full grid-cols-[240px_minmax(0,392px)_minmax(0,1fr)] gap-3 px-4 py-4">
            <DesktopSidebar activeTool={activeTool} onSelectTool={handleSelectTool} />
            <ParameterPanel activeMeta={activeMeta} scrollRef={parameterScrollRef} />
            <PreviewPanel
              activeMeta={activeMeta}
              activeTool={activeTool}
              scrollRef={previewScrollRef}
            />
          </div>
        ) : viewportMode === "tablet" ? (
          <div className="grid min-h-0 w-full grid-cols-[88px_minmax(340px,360px)_minmax(0,1fr)] gap-3 px-4 py-4">
            <DesktopSidebar compact activeTool={activeTool} onSelectTool={handleSelectTool} />
            <ParameterPanel activeMeta={activeMeta} scrollRef={parameterScrollRef} />
            <PreviewPanel
              activeMeta={activeMeta}
              activeTool={activeTool}
              scrollRef={previewScrollRef}
            />
          </div>
        ) : (
          <div className="flex min-h-0 w-full flex-col px-3 pt-3 pb-[calc(96px+env(safe-area-inset-bottom))]">
            <MobileShellTabs pane={pane} onChangePane={setPane} activeMeta={activeMeta} />
            <div className="mt-3 min-h-0 flex-1">
              {pane === "parameters" ? (
                <ParameterPanel activeMeta={activeMeta} scrollRef={parameterScrollRef} className="h-full" />
              ) : (
                <PreviewPanel
                  activeMeta={activeMeta}
                  activeTool={activeTool}
                  scrollRef={previewScrollRef}
                  className="h-full"
                />
              )}
            </div>
          </div>
        )}
      </main>

      {viewportMode === "mobile" ? (
        <>
          <MobileDrawer
            activeTool={activeTool}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSelectTool={handleSelectTool}
          />
          <MobileActionBar activeMeta={activeMeta} />
        </>
      ) : null}
    </div>
  );
}

function TopBar({
  mode,
  drawerOpen,
  loggedIn,
  accountOpen,
  onToggleDrawer,
  onToggleAccount,
  onLogIn,
  onLogOut,
}: {
  mode: ShellViewportMode;
  drawerOpen: boolean;
  loggedIn: boolean;
  accountOpen: boolean;
  onToggleDrawer: () => void;
  onToggleAccount: () => void;
  onLogIn: () => void;
  onLogOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050507]/96 backdrop-blur-xl">
      <div className={cn("flex items-center justify-between gap-3 px-3 sm:px-4", mode === "mobile" ? "h-14" : "h-[60px] px-4")}>
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleDrawer}
            className={cn(
              "size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/70 transition hover:border-white/20 hover:text-white",
              mode === "mobile" ? "inline-flex" : "hidden",
            )}
            aria-label={drawerOpen ? "关闭导航" : "打开导航"}
          >
            {drawerOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>

          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo className={cn("shrink-0 text-white", mode === "mobile" ? "size-9" : "size-10")} />
            <div className="min-w-0">
              <span className={cn("block truncate font-semibold text-white", mode === "mobile" ? "text-[18px]" : "text-[20px]")}>
                奥皇 AI
              </span>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2">
          {!loggedIn ? (
            <button
              type="button"
              onClick={onLogIn}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/70 transition hover:border-fuchsia-400/40 hover:text-white"
            >
              <UserRound className="size-4" />
              登录
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleAccount}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/75 transition hover:border-fuchsia-400/40 hover:text-white"
            >
              <span className="grid size-6 place-items-center rounded-full bg-fuchsia-500/15 text-[11px] font-semibold text-fuchsia-200">
                OA
              </span>
              奥皇 AI
              <ChevronDown className="size-4 text-white/45" />
            </button>
          )}

          {loggedIn && accountOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#0f0f0f] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white/70 hover:bg-white/[0.04] hover:text-white"
              >
                <UserRound className="size-4" />
                账户入口
              </button>
              <Link
                href="/admin/providers"
                className="flex items-center gap-2 px-4 py-3 text-sm text-white/70 hover:bg-white/[0.04] hover:text-white"
              >
                <Settings className="size-4" />
                后台设置
              </Link>
              <button
                type="button"
                onClick={onLogOut}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white/70 hover:bg-white/[0.04] hover:text-white"
              >
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function DesktopSidebar({
  activeTool,
  compact = false,
  onSelectTool,
}: {
  activeTool: ToolId;
  compact?: boolean;
  onSelectTool: (tool: ToolId) => void;
}) {
  return (
    <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f0f0f]", compact ? "p-2" : "p-3")}>
      <div className={cn("flex items-center justify-between pb-3", compact ? "px-1" : "px-1")}>
        {compact ? (
          <BrandLogo className="size-8 shrink-0 text-white" />
        ) : (
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">工作区导航</p>
            <p className="mt-1 text-sm text-white/52">左侧导航与路由入口</p>
          </div>
        )}
        <Link
          href="/admin/providers"
          aria-label="后台设置"
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-fuchsia-400/40 hover:text-white",
            compact ? "size-10 justify-center text-white/60" : "px-3 py-2 text-xs text-white/60",
          )}
        >
          <Settings className="size-4" />
          <span className={cn(compact && "sr-only")}>后台设置</span>
        </Link>
      </div>

      <div className={cn("grid min-h-0 overflow-y-auto pr-1", compact ? "gap-2" : "gap-4")}>
        {navGroups.map((group) => (
          <section key={group.title} className="grid gap-2">
            <h2 className={cn("px-2 text-[11px] uppercase tracking-[0.2em] text-white/32", compact && "sr-only")}>
              {group.title}
            </h2>
            <div className={cn("grid", compact ? "gap-2" : "gap-2")}>
              {group.items.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={activeTool === item.id}
                  compact={compact}
                  onClick={() => onSelectTool(item.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function ParameterPanel({
  activeMeta,
  scrollRef,
  className,
}: {
  activeMeta: ToolMeta;
  scrollRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f0f0f]", className)}>
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-[11px] uppercase tracking-[0.24em] text-fuchsia-300/70">参数区</p>
        <h2 className="mt-1 text-[22px] font-semibold text-white">{activeMeta.label}</h2>
        <p className="mt-2 text-[14px] leading-6 text-white/52">{activeMeta.description}</p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-6">
          <SectionCard
            title="标题区域"
            lines={["后续工具表单会在这里挂载。", "当前只保留容器、滚动和断点。"]}
          />
          <SectionCard
            title="可滚动内容区域"
            lines={["这里预留模型、素材、参数与状态。", "切换工具时会回到顶部。", "手机端只显示一页，不压缩成桌面列。"]}
          />
          <SectionCard
            title="底部操作区占位"
            lines={["预留 sticky 能力，后续模块接入主操作。", "当前只显示壳层，不接真实生成逻辑。"]}
          />
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-xs text-white/45">
          <span>参数壳层就绪</span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{activeMeta.section}</span>
        </div>
      </div>
    </section>
  );
}

function PreviewPanel({
  activeMeta,
  activeTool,
  scrollRef,
  className,
}: {
  activeMeta: ToolMeta;
  activeTool: ToolId;
  scrollRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f0f0f]", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/34">工作区</p>
          <h2 className="mt-1 text-[22px] font-semibold text-white">默认引导与结果容器</h2>
          <p className="mt-2 text-[14px] leading-6 text-white/52">{activeMeta.preview}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/45">
          {activeTool}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-4">
          <SectionCard
            title="默认引导容器"
            lines={["后续可放引导插槽、指引箭头与导向信息。", "当前仅保留占位层和独立滚动。"]}
          />
          <ShellPreviewStage />
          <SectionCard
            title="结果容器 / 空状态容器"
            lines={["后续可接缩略图和空状态。", "当前不显示旧输出标题，也不放真实媒体。"]}
          />
        </div>
      </div>
    </section>
  );
}

function MobileShellTabs({
  pane,
  onChangePane,
  activeMeta,
}: {
  pane: ShellPane;
  onChangePane: (value: ShellPane) => void;
  activeMeta: ToolMeta;
}) {
  return (
    <div>
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/34">当前工具</p>
          <p className="mt-1 truncate text-sm text-white">{activeMeta.label}</p>
        </div>
        <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onChangePane("parameters")}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition",
              pane === "parameters" ? "bg-white/[0.08] text-white" : "text-white/45",
            )}
          >
            <PanelLeft className="size-4" />
            参数
          </button>
          <button
            type="button"
            onClick={() => onChangePane("preview")}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition",
              pane === "preview" ? "bg-white/[0.08] text-white" : "text-white/45",
            )}
          >
            <PanelRight className="size-4" />
            预览
          </button>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/40">手机工具导航在抽屉内切换。</div>
    </div>
  );
}

function MobileDrawer({
  activeTool,
  open,
  onClose,
  onSelectTool,
}: {
  activeTool: ToolId;
  open: boolean;
  onClose: () => void;
  onSelectTool: (tool: ToolId) => void;
}) {
  return (
    <div className={cn("fixed inset-0 z-50", open ? "pointer-events-auto" : "pointer-events-none")}>
      <div
        className={cn("absolute inset-0 bg-black/60 transition-opacity", open ? "opacity-100" : "opacity-0")}
        onClick={onClose}
      />
      <aside
        className={cn(
          "absolute left-0 top-0 h-full w-[280px] border-r border-white/10 bg-[#0f0f0f] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.42)] transition-transform",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-3">
            <BrandLogo className="size-9 text-white" />
            <div>
              <p className="text-[18px] font-semibold">奥皇 AI</p>
              <p className="text-[12px] text-white/38">手机抽屉导航</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/65"
            aria-label="关闭导航"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-4 overflow-y-auto pb-4">
          {navGroups.map((group) => (
            <section key={group.title} className="grid gap-2">
              <h2 className="px-2 text-[11px] uppercase tracking-[0.2em] text-white/32">{group.title}</h2>
              <div className="grid gap-2">
                {group.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeTool === item.id}
                    onClick={() => {
                      onSelectTool(item.id);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </section>
          ))}

          <Link
            href="/admin/providers"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/65"
          >
            <Settings className="size-4" />
            后台设置
          </Link>
        </div>
      </aside>
    </div>
  );
}

function MobileActionBar({ activeMeta }: { activeMeta: ToolMeta }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#050507]/96 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      <div className="flex h-12 items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0f0f0f] px-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/32">底部操作区</p>
          <p className="truncate text-sm text-white/65">{activeMeta.label} 的生成入口将在后续模块接入</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/45">
          safe-area
        </span>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  compact,
  onClick,
}: {
  item: (typeof navItems)[number];
  active: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      title={item.label}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
        compact && "justify-center gap-0 px-2 py-3",
        active
          ? "border-fuchsia-400/30 bg-[rgba(255,10,108,0.14)] text-white"
          : "border-white/10 bg-white/[0.03] text-white/62 hover:border-white/20 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      <Icon className={cn("size-5 shrink-0", active ? "text-fuchsia-300" : "text-white/60")} />
      <span className={cn("min-w-0", compact && "sr-only")}>
        <span className="block text-[14px] font-medium leading-5">{item.label}</span>
        <span className="block text-[12px] leading-5 text-white/42">{item.desc}</span>
      </span>
    </button>
  );
}

function SectionCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-fuchsia-400/80" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={`${title}-${index}`} className="h-3 rounded-full bg-white/[0.08]" />
        ))}
      </div>
      <p className="text-sm leading-6 text-white/45">{lines[0]}</p>
    </section>
  );
}

function ShellPreviewStage() {
  return (
    <section className="grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-white/45" />
        <h3 className="text-sm font-semibold text-white">结果容器</h3>
      </div>
      <div className="grid gap-3">
        <div className="h-48 rounded-xl border border-dashed border-white/10 bg-black/30" />
        <div className="grid gap-2">
          <div className="h-3 w-4/5 rounded-full bg-white/[0.08]" />
          <div className="h-3 w-3/5 rounded-full bg-white/[0.08]" />
          <div className="h-3 w-2/5 rounded-full bg-white/[0.08]" />
        </div>
      </div>
    </section>
  );
}

function getViewportMode(width: number): ShellViewportMode {
  if (width >= 1180) return "desktop";
  if (width >= 768) return "tablet";
  return "mobile";
}
