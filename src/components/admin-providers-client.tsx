"use client";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Database,
  Eye,
  EyeOff,
  Gauge,
  HelpCircle,
  ImageIcon,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import type { EndpointType, ProviderKind, PublicProvider } from "@/lib/server/types";

type EditableProvider = PublicProvider & {
  newApiKey: string;
  clearApiKey: boolean;
};

type NavItem = {
  id: string;
  label: string;
  sectionId: string;
  icon: LucideIcon;
};

const endpointOptions: Array<{ value: EndpointType; label: string; short: string }> = [
  { value: "images-generations", label: "图片生成接口", short: "图片生成" },
  { value: "images-edits", label: "图片编辑接口", short: "图片编辑" },
  { value: "videos-generations", label: "视频生成接口", short: "视频生成" },
  { value: "upscayl-cli", label: "本机图片放大工具", short: "图片放大" },
  { value: "video2x-cli", label: "本机视频放大工具", short: "视频放大" },
];

const navGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "创作工具",
    items: [
      { id: "image", label: "图片生成", sectionId: "dashboard-overview", icon: ImageIcon },
      { id: "video", label: "视频生成", sectionId: "dashboard-overview", icon: Video },
      { id: "upscale", label: "放大工具", sectionId: "service-map", icon: Sparkles },
    ],
  },
  {
    title: "管理中心",
    items: [
      { id: "dashboard", label: "今日总览", sectionId: "dashboard-overview", icon: BarChart3 },
      { id: "keys", label: "Key 管理", sectionId: "key-management", icon: KeyRound },
      { id: "usage", label: "使用记录", sectionId: "future-logs", icon: ClipboardList },
      { id: "tasks", label: "任务记录", sectionId: "future-logs", icon: ListChecks },
    ],
  },
  {
    title: "客户中心",
    items: [
      { id: "customers", label: "客户账号", sectionId: "customer-center", icon: Users },
      { id: "credits", label: "积分管理", sectionId: "credit-center", icon: Wallet },
      { id: "models", label: "模型价格", sectionId: "model-pricing", icon: Layers },
    ],
  },
  {
    title: "个人中心",
    items: [
      { id: "wallet", label: "积分钱包", sectionId: "credit-center", icon: Wallet },
      { id: "settings", label: "后台设置", sectionId: "service-connection", icon: Settings },
    ],
  },
];

const kindLabels: Record<ProviderKind, string> = {
  image: "图片生成",
  video: "视频生成",
  "image-upscale": "图片放大",
  "video-upscale": "视频放大",
};

const helpItems = [
  {
    title: "客户积分什么时候显示？",
    body: "等后面接入账号和积分系统后，这里会显示每个客户的余额、消耗和充值记录。",
  },
  {
    title: "模型价格现在能设置吗？",
    body: "当前先把位置做好，后面可以按不同模型、清晰度和时长填写对应积分。",
  },
  {
    title: "Key 会不会直接显示出来？",
    body: "不会。页面默认只显示安全预览，新填写的 Key 保存后也会重新隐藏。",
  },
];

function endpointOptionsFor(provider: EditableProvider) {
  if (provider.kind === "image") return endpointOptions.filter((option) => option.value.startsWith("images-"));
  if (provider.kind === "video") return endpointOptions.filter((option) => option.value === "videos-generations");
  if (provider.kind === "image-upscale") return endpointOptions.filter((option) => option.value === "upscayl-cli");
  return endpointOptions.filter((option) => option.value === "video2x-cli");
}

function isLocalCli(endpointType: EndpointType) {
  return endpointType === "upscayl-cli" || endpointType === "video2x-cli";
}

function maskKey(value: string) {
  if (!value) return "未配置";
  return value.replace("••••", "sk-••••••••");
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: string }).error)
        : "请求失败。",
    );
  }
  return data as { providers: PublicProvider[] };
}

export function AdminProvidersClient() {
  const [providers, setProviders] = useState<EditableProvider[]>([]);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("输入管理密码后读取配置；未设置密码时可直接读取。");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [activeNav, setActiveNav] = useState("dashboard");
  const [lastLoadedAt, setLastLoadedAt] = useState("");

  const stats = useMemo(() => {
    const enabled = providers.filter((provider) => provider.enabled).length;
    const configured = providers.filter((provider) => provider.configured || isLocalCli(provider.endpointType)).length;
    const local = providers.filter((provider) => isLocalCli(provider.endpointType)).length;
    const remote = providers.filter((provider) => !isLocalCli(provider.endpointType)).length;
    const missing = providers.filter((provider) => provider.enabled && !provider.configured && !isLocalCli(provider.endpointType)).length;
    const disabled = providers.filter((provider) => !provider.enabled).length;
    return { enabled, configured, disabled, local, missing, remote, total: providers.length };
  }, [providers]);

  const providerByKind = useMemo(() => {
    const next = new Map<ProviderKind, EditableProvider>();
    providers.forEach((provider) => next.set(provider.kind, provider));
    return next;
  }, [providers]);

  const modelRows = useMemo(() => {
    const orderedKinds: ProviderKind[] = ["image", "video", "image-upscale", "video-upscale"];
    return orderedKinds.map((kind) => {
      const provider = providerByKind.get(kind);
      return {
        kind,
        title: kindLabels[kind],
        model: provider?.model || "读取配置后显示",
        unit: kind === "video" ? "每次 / 按时长" : kind.includes("upscale") ? "每次放大" : "每次生成",
        cost: "待设置",
        note: kind.includes("upscale") ? "本机处理，可后续设为 0 或内部价格" : "后续按清晰度、数量和时长细化",
        ready: Boolean(provider && (provider.configured || isLocalCli(provider.endpointType))),
      };
    });
  }, [providerByKind]);

  function headers() {
    return {
      "Content-Type": "application/json",
      ...(password ? { "x-admin-password": password } : {}),
    };
  }

  function hydrate(nextProviders: PublicProvider[]) {
    setProviders(nextProviders.map((provider) => ({
      ...provider,
      newApiKey: "",
      clearApiKey: false,
    })));
  }

  async function load() {
    setLoading(true);
    setStatus("正在读取配置...");
    try {
      const response = await fetch("/api/admin/providers", { headers: headers() });
      const data = await readJson(response);
      hydrate(data.providers);
      setExpandedId(data.providers[0]?.id || null);
      setLastLoadedAt(new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date()));
      setStatus(`已读取 ${data.providers.length} 条配置。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取失败。");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setStatus("正在保存配置...");
    try {
      const response = await fetch("/api/admin/providers", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          providers: providers.map((provider) => ({
            id: provider.id,
            apiUrl: provider.apiUrl,
            model: provider.model,
            endpointType: provider.endpointType,
            enabled: provider.enabled,
            ...(provider.newApiKey ? { apiKey: provider.newApiKey } : {}),
            ...(provider.clearApiKey ? { clearApiKey: true } : {}),
          })),
        }),
      });
      const data = await readJson(response);
      hydrate(data.providers);
      setStatus("配置已保存。工作台会自动使用已启用且完整的配置。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setLoading(false);
    }
  }

  function update(id: string, patch: Partial<EditableProvider>) {
    setProviders((current) => current.map((provider) => (
      provider.id === id ? { ...provider, ...patch } : provider
    )));
  }

  async function copyValue(value: string) {
    if (!value) {
      setStatus("这条配置现在没有可复制的内容。");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus("已复制到剪贴板。");
    } catch {
      setStatus("浏览器没有允许自动复制，请手动选中后复制。");
    }
  }

  function clearProviderKey(provider: EditableProvider) {
    update(provider.id, { clearApiKey: true, newApiKey: "" });
    setStatus(`${provider.title} 保存后会清除密钥。`);
  }

  function jumpTo(item: NavItem) {
    setActiveNav(item.id);
    setStatus(`已切换到「${item.label}」。`);
    document.getElementById(item.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen bg-[#08090d] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.04)_0,transparent_30%,rgba(56,189,248,0.04)_100%)]" />
      <div className="relative grid min-h-screen grid-rows-[auto_1fr]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d0e13]/95 px-3 py-3 backdrop-blur-xl lg:px-5">
          <div className="mx-auto flex max-w-[1880px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-4">
              <Link href="/" className="flex min-w-0 items-center gap-3" data-testid="admin-home-logo">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10">
                  <BrandLogo className="size-7" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-black">奥皇 AI</p>
                  <p className="text-xs text-white/45">控制台</p>
                </div>
              </Link>
              <nav className="hidden items-center gap-1 md:flex">
                <Link href="/" className="admin-top-link" data-testid="admin-top-home">
                  首页
                </Link>
                <button type="button" className="admin-top-link admin-top-link-active" onClick={() => jumpTo(navGroups[1].items[0])} data-testid="admin-top-console">
                  控制台
                </button>
                <button type="button" className="admin-top-link" onClick={() => jumpTo(navGroups[2].items[2])} data-testid="admin-top-models">
                  模型选择
                </button>
                <button type="button" className="admin-top-link" onClick={() => jumpTo({ id: "help", label: "使用帮助", sectionId: "future-logs", icon: HelpCircle })} data-testid="admin-top-docs">
                  文档
                </button>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" className="admin-icon-button" aria-label="搜索" onClick={() => setStatus("搜索入口已预留，后续接入客户、任务和订单搜索。")} data-testid="admin-search">
                <Search className="size-4" />
              </button>
              <button type="button" className="admin-icon-button" aria-label="通知" onClick={() => setStatus("通知中心已预留，后续显示客户充值、任务失败和系统公告。")} data-testid="admin-bell">
                <Bell className="size-4" />
              </button>
              <Link href="/login" className="hidden admin-secondary clickable sm:flex">
                <Users className="size-4" />
                客户登录
              </Link>
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-sm text-white/72 sm:flex">
                <span className="grid size-8 place-items-center rounded-full bg-cyan-500/90 text-xs font-black">J</span>
                jike072
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 lg:grid-cols-[244px_minmax(0,1fr)]">
          <aside className="hidden border-r border-white/10 bg-[#0b0c11]/88 p-3 lg:flex lg:flex-col">
            <div className="space-y-5 overflow-y-auto pb-4">
              {navGroups.map((group) => (
                <div key={group.title}>
                  <p className="px-3 pb-2 text-xs font-bold text-white/34">{group.title}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <SidebarButton
                        key={item.id}
                        item={item}
                        active={activeNav === item.id}
                        onClick={() => jumpTo(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-auto flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white/58 transition hover:text-white"
              onClick={() => setStatus("侧边栏收起入口已预留，后续可做成可折叠。")}
              data-testid="admin-collapse-sidebar"
            >
              <ChevronDown className="size-4 rotate-90" />
              收起侧边栏
            </button>
          </aside>

          <section className="min-w-0 overflow-y-auto px-3 py-3 lg:px-5 lg:py-4">
            <div className="mb-3 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.035] p-2 lg:hidden">
              {navGroups.flatMap((group) => group.items).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpTo(item)}
                  data-testid={`admin-mobile-nav-${item.id}`}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                    activeNav === item.id ? "bg-cyan-500/20 text-cyan-100" : "text-white/58 hover:text-white",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mx-auto grid max-w-[1880px] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                <section id="dashboard-overview" className="admin-panel p-4 md:p-5">
                  <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                    <div>
                      <p className="text-sm font-semibold text-cyan-200/75">晚上好，jike072</p>
                      <h1 className="mt-2 text-2xl font-black md:text-3xl">后台控制台</h1>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/52">
                        这里会集中看 Key、客户、积分、模型价格和任务情况。当前先接真实配置状态，客户和积分数据先做好位置。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href="/" className="admin-secondary" data-testid="admin-back-workspace">
                        <ArrowLeft className="size-4" />
                        返回工作台
                      </Link>
                      <button type="button" onClick={load} disabled={loading} data-testid="admin-load" className="admin-secondary">
                        <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                        读取配置
                      </button>
                      <button type="button" onClick={save} disabled={loading || !providers.length} data-testid="admin-save" className="admin-primary">
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        保存配置
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    <OverviewCard
                      icon={Database}
                      label="账户数据"
                      value={providers.length ? `${stats.configured}/${stats.total}` : "待读取"}
                      detail="已完整配置 / 全部能力"
                      tone="cyan"
                    />
                    <OverviewCard
                      icon={Activity}
                      label="使用统计"
                      value="待接入"
                      detail="客户生成次数和任务数量会放这里"
                      tone="emerald"
                    />
                    <OverviewCard
                      icon={Wallet}
                      label="积分消耗"
                      value="待接入"
                      detail="后续显示今日消耗、余额和充值"
                      tone="amber"
                    />
                    <OverviewCard
                      icon={Gauge}
                      label="运行状态"
                      value={stats.missing ? `${stats.missing} 项待补` : providers.length ? "正常" : "未读取"}
                      detail={lastLoadedAt ? `最近读取：${lastLoadedAt}` : "读取配置后显示实时状态"}
                      tone={stats.missing ? "amber" : "violet"}
                    />
                  </div>
                </section>

                <section id="service-map" className="grid gap-4 2xl:grid-cols-[1fr_0.82fr]">
                  <div className="admin-panel overflow-hidden">
                    <SectionTitle
                      icon={BarChart3}
                      eyebrow="使用概览"
                      title="功能使用分析"
                      action="先看结构，后续接真实用量"
                    />
                    <div className="grid gap-4 p-4 md:grid-cols-[1fr_220px] md:p-5">
                      <div className="min-h-[300px] rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-black">积分花在哪里</h3>
                            <p className="mt-1 text-sm text-white/45">当前是结构预览，后续会变成真实消耗图。</p>
                          </div>
                          <div className="flex gap-2 text-xs text-white/45">
                            <span className="admin-dot bg-cyan-300" /> 图片
                            <span className="admin-dot bg-amber-300" /> 视频
                            <span className="admin-dot bg-emerald-300" /> 放大
                          </div>
                        </div>
                        <div className="mt-8 grid h-56 grid-cols-7 items-end gap-3 border-b border-l border-white/10 px-4 pb-3">
                          {[26, 42, 36, 58, 46, 72, 54].map((height, index) => (
                            <div key={index} className="flex h-full items-end">
                              <div
                                className="w-full rounded-t-lg border border-cyan-300/25 bg-cyan-400/25 transition hover:bg-cyan-300/35"
                                style={{ height: `${height}%` }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-2 text-center text-xs text-white/35">
                          <span>周一</span>
                          <span>周二</span>
                          <span>周三</span>
                          <span>周四</span>
                          <span>周五</span>
                          <span>周六</span>
                          <span>周日</span>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        {["图片生成", "视频生成", "图片放大", "视频放大"].map((label, index) => {
                          const provider = providers[index];
                          const ready = provider ? provider.configured || isLocalCli(provider.endpointType) : false;
                          return (
                            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                              <p className="text-sm font-bold text-white/82">{label}</p>
                              <p className="mt-2 text-xs text-white/42">{provider?.model || "读取配置后显示当前模型"}</p>
                              <div className="mt-4 flex items-center justify-between">
                                <span className={cn("rounded-full px-2.5 py-1 text-xs", ready ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.06] text-white/45")}>
                                  {ready ? "可用" : "待确认"}
                                </span>
                                <span className="text-xs text-white/35">积分待设置</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div id="customer-center" className="admin-panel p-4 md:p-5">
                    <SectionHeading icon={Users} title="客户账号" note="先做好管理台位置，后续接客户系统。" />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <ReservedMetric label="客户总数" value="待接入" />
                      <ReservedMetric label="活跃客户" value="待接入" />
                      <ReservedMetric label="剩余积分" value="待接入" />
                      <ReservedMetric label="充值记录" value="待接入" />
                    </div>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/18 p-4">
                      <p className="text-sm font-bold text-white/78">客户列表预留</p>
                      <div className="mt-3 space-y-2 text-sm text-white/46">
                        <PlaceholderRow left="客户昵称 / 手机 / 邮箱" right="后续显示账号状态" />
                        <PlaceholderRow left="剩余积分 / 已用积分" right="后续显示积分明细" />
                        <PlaceholderRow left="最近生成 / 失败任务" right="后续显示使用记录" />
                      </div>
                    </div>
                  </div>
                </section>

                <section id="credit-center" className="grid gap-4 2xl:grid-cols-[0.86fr_1fr]">
                  <div className="admin-panel p-4 md:p-5">
                    <SectionHeading icon={Wallet} title="积分管理" note="先预留余额、消耗、充值和流水。" />
                    <div className="mt-4 grid gap-3">
                      <CreditBlock title="今日消耗" value="待接入" note="按客户、任务和模型拆开" />
                      <CreditBlock title="客户余额" value="待接入" note="后续支持查看每个客户剩余积分" />
                      <CreditBlock title="积分流水" value="待接入" note="充值、赠送、扣除都会进入这里" />
                    </div>
                  </div>

                  <div id="model-pricing" className="admin-panel overflow-hidden">
                    <SectionTitle
                      icon={Layers}
                      eyebrow="积分规则"
                      title="模型价格"
                      action="规则先占位，后续可直接填"
                    />
                    <div className="overflow-auto">
                      <div className="min-w-[760px]">
                        <div className="grid grid-cols-[1fr_1.2fr_110px_100px_1.2fr] border-b border-white/10 bg-white/[0.035] px-4 py-3 text-xs font-bold text-white/48">
                          <span>功能</span>
                          <span>当前模型</span>
                          <span>计费方式</span>
                          <span>积分</span>
                          <span>说明</span>
                        </div>
                        {modelRows.map((row) => (
                          <div key={row.kind} className="grid grid-cols-[1fr_1.2fr_110px_100px_1.2fr] items-center border-b border-white/8 px-4 py-3 text-sm">
                            <span className="font-bold text-white/82">{row.title}</span>
                            <span className="truncate text-white/55">{row.model}</span>
                            <span className="text-white/48">{row.unit}</span>
                            <span className="w-fit rounded-full bg-amber-500/12 px-3 py-1 text-xs text-amber-200">{row.cost}</span>
                            <span className="truncate text-white/42">{row.note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section id="key-management" className="admin-panel min-h-[520px] overflow-hidden">
                  <SectionTitle
                    icon={KeyRound}
                    eyebrow="核心配置"
                    title="Key 管理"
                    action="展开一行即可编辑详细信息"
                  />

                  <div className="min-h-0 overflow-auto">
                    <div className="min-w-[1180px]">
                      <div className="grid grid-cols-[44px_1.1fr_110px_130px_1.15fr_1.2fr_120px_110px_230px] items-center border-b border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/58">
                        <span />
                        <span>名称</span>
                        <span>状态</span>
                        <span>分组</span>
                        <span>密钥</span>
                        <span>接口 / 路径</span>
                        <span>可用模型</span>
                        <span>IP限制</span>
                        <span>操作</span>
                      </div>

                      {providers.length ? providers.map((provider) => {
                        const open = expandedId === provider.id;
                        const local = isLocalCli(provider.endpointType);
                        const ready = provider.configured || local;
                        const visibleKey = Boolean(visibleKeys[provider.id]);
                        return (
                          <article key={provider.id} className={cn("border-b border-white/8 transition duration-200", open ? "bg-white/[0.045]" : "bg-white/[0.015] hover:bg-white/[0.035]")}>
                            <div className="grid grid-cols-[44px_1.1fr_110px_130px_1.15fr_1.2fr_120px_110px_230px] items-center px-4 py-3 text-sm">
                              <button
                                type="button"
                                aria-label={`${open ? "收起" : "展开"}${provider.title}`}
                                onClick={() => setExpandedId(open ? null : provider.id)}
                                data-testid={`admin-expand-${provider.id}`}
                                className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/45 transition hover:border-cyan-400/40 hover:text-white"
                              >
                                <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
                              </button>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <strong className="truncate text-white/90">{provider.title}</strong>
                                  <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] text-white/42">{provider.id}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-white/42">{provider.role}</p>
                              </div>
                              <StatusBadge ready={ready} enabled={provider.enabled} local={local} />
                              <span className="w-fit rounded-full border border-cyan-400/15 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                                {kindLabels[provider.kind]}
                              </span>
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={cn("truncate rounded-full border px-3 py-1 text-xs", local ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-white/72")}>
                                  {local ? "本机处理，无需 Key" : visibleKey ? provider.keyPreview || "未配置" : maskKey(provider.keyPreview)}
                                </span>
                                {!local ? (
                                  <button
                                    type="button"
                                    aria-label={visibleKey ? "隐藏密钥预览" : "显示密钥预览"}
                                    onClick={() => setVisibleKeys((current) => ({ ...current, [provider.id]: !visibleKey }))}
                                    data-testid={`admin-key-visibility-${provider.id}`}
                                    className="grid size-7 place-items-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
                                  >
                                    {visibleKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label="复制接口或路径"
                                  onClick={() => void copyValue(provider.apiUrl)}
                                  data-testid={`admin-copy-${provider.id}`}
                                  className="grid size-7 place-items-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
                                >
                                  <Copy className="size-4" />
                                </button>
                              </div>
                              <span className="truncate text-white/52">{provider.apiUrl || "自动检测"}</span>
                              <span className="truncate rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/68">{provider.model || "未填写"}</span>
                              <span className="w-fit rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/58">无限制</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => update(provider.id, { enabled: !provider.enabled })}
                                  data-testid={`admin-toggle-${provider.id}`}
                                  className={cn(
                                    "rounded-xl px-3 py-2 text-xs font-bold transition",
                                    provider.enabled ? "bg-white/[0.08] text-white/72 hover:text-white" : "bg-emerald-500/15 text-emerald-100",
                                  )}
                                >
                                  {provider.enabled ? "禁用" : "启用"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(open ? null : provider.id)}
                                  data-testid={`admin-edit-${provider.id}`}
                                  className="rounded-xl bg-white/[0.08] px-3 py-2 text-xs font-bold text-white/72 transition hover:text-white"
                                >
                                  编辑
                                </button>
                                {!local ? (
                                  <button
                                    type="button"
                                    onClick={() => clearProviderKey(provider)}
                                    data-testid={`admin-clear-key-${provider.id}`}
                                    className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-500/20"
                                  >
                                    清除
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {open ? (
                              <div className="grid gap-4 border-t border-white/10 px-4 py-4 xl:grid-cols-[1.1fr_.8fr_.9fr]">
                                <label className="admin-field">
                                  {local ? "可执行文件路径（留空自动检测）" : "接口地址"}
                                  <input
                                    type={local ? "text" : "url"}
                                    value={provider.apiUrl}
                                    onChange={(event) => update(provider.id, { apiUrl: event.target.value })}
                                    placeholder={local ? "留空时自动检测本机安装路径" : "https://..."}
                                    data-testid={`admin-url-${provider.id}`}
                                    className="admin-input"
                                  />
                                </label>
                                <label className="admin-field">
                                  模型
                                  <input
                                    value={provider.model}
                                    onChange={(event) => update(provider.id, { model: event.target.value })}
                                    data-testid={`admin-model-${provider.id}`}
                                    className="admin-input"
                                  />
                                </label>
                                <label className="admin-field">
                                  接口类型
                                  <select
                                    value={provider.endpointType}
                                    onChange={(event) => update(provider.id, { endpointType: event.target.value as EndpointType })}
                                    data-testid={`admin-endpoint-${provider.id}`}
                                    className="admin-input"
                                  >
                                    {endpointOptionsFor(provider).map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>

                                {local ? (
                                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200 xl:col-span-3">
                                    <KeyRound className="size-4 shrink-0" />
                                    本机工具直接在这台电脑处理，不需要 Key。路径留空时会自动检测。
                                  </div>
                                ) : (
                                  <div className="grid gap-4 xl:col-span-3 xl:grid-cols-[1fr_auto] xl:items-end">
                                    <label className="admin-field">
                                      <span className="flex items-center gap-2">
                                        <KeyRound className="size-4" />
                                        替换 Key
                                      </span>
                                      <input
                                        type="password"
                                        value={provider.newApiKey}
                                        disabled={provider.clearApiKey}
                                        onChange={(event) => update(provider.id, { newApiKey: event.target.value })}
                                        placeholder={provider.keyPreview ? `当前密钥：${provider.keyPreview}；留空保持不变` : "尚未配置密钥"}
                                        data-testid={`admin-key-${provider.id}`}
                                        className="admin-input"
                                      />
                                    </label>
                                    <label className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/55">
                                      <input
                                        type="checkbox"
                                        checked={provider.clearApiKey}
                                        onChange={(event) => update(provider.id, { clearApiKey: event.target.checked, newApiKey: "" })}
                                        data-testid={`admin-clear-${provider.id}`}
                                        className="size-4 accent-red-500"
                                      />
                                      保存时清除 Key
                                    </label>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </article>
                        );
                      }) : (
                        <div className="grid min-h-[360px] place-items-center px-4 py-12 text-center text-white/45">
                          <div>
                            <KeyRound className="mx-auto mb-3 size-8 text-cyan-300/70" />
                            <p className="text-lg font-black text-white/80">还没有读取配置</p>
                            <p className="mt-2 text-sm">点击“读取配置”，这里会显示详细管理表。</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section id="future-logs" className="grid gap-4 2xl:grid-cols-[1fr_0.8fr]">
                  <div className="admin-panel p-4 md:p-5">
                    <SectionHeading icon={ClipboardList} title="使用记录 / 任务记录" note="后续给客户用时，可以看每次生成、扣分、失败原因。" />
                    <div className="mt-4 space-y-3">
                      <TimelineRow title="生成记录" meta="待接入客户系统" status="会显示提示词、功能、模型和扣除积分" />
                      <TimelineRow title="任务记录" meta="待接入任务系统" status="会显示排队、生成中、完成、失败" />
                      <TimelineRow title="积分流水" meta="待接入支付系统" status="会显示充值、赠送、扣除和退款" />
                    </div>
                  </div>
                  <div className="admin-panel p-4 md:p-5">
                    <SectionHeading icon={HelpCircle} title="使用帮助" note="给自己和以后客户看的简短说明。" />
                    <div className="mt-4 space-y-3">
                      {helpItems.map((item) => (
                        <details key={item.title} className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                          <summary className="cursor-pointer list-none text-sm font-bold text-white/82">
                            {item.title}
                            <span className="float-right text-white/38 transition group-open:rotate-45">+</span>
                          </summary>
                          <p className="mt-3 text-sm leading-6 text-white/48">{item.body}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
                <section id="service-connection" className="admin-panel p-4">
                  <SectionHeading icon={ShieldCheck} title="服务连接" note="现在真实读取 Key 和本机工具状态。" />
                  <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-200" />
                      <p className="text-sm leading-6 text-cyan-50/76">{status}</p>
                    </div>
                  </div>
                  <label className="mt-4 grid gap-2 text-sm text-white/70">
                    管理密码
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="未设置 ADMIN_PASSWORD 时可留空"
                      data-testid="admin-password"
                      className="admin-input"
                    />
                  </label>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <AdminStat label="总数" value={stats.total} />
                    <AdminStat label="启用" value={stats.enabled} />
                    <AdminStat label="完整" value={stats.configured} />
                    <AdminStat label="远程" value={stats.remote} />
                  </div>
                </section>

                <section className="admin-panel p-4">
                  <SectionHeading icon={Gauge} title="当前服务状态" note="不留空，先显示每项能力是否可用。" />
                  <div className="mt-4 space-y-3">
                    {modelRows.map((row) => (
                      <div key={row.kind} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white/80">{row.title}</p>
                          <p className="truncate text-xs text-white/38">{row.model}</p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", row.ready ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/12 text-amber-200")}>
                          {row.ready ? "可用" : "待读取"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="admin-panel p-4">
                  <SectionHeading icon={Bell} title="后台通知" note="后续显示系统公告、版本提醒和客户事件。" />
                  <div className="mt-4 space-y-3">
                    <NoticeRow title="积分模块已预留" body="后面接客户账号后，可直接扩展余额、充值和扣费。" />
                    <NoticeRow title="模型价格已预留" body="可以按模型、尺寸、时长设置不同积分。" />
                    <NoticeRow title="Key 管理保持可用" body="当前读取、保存、显示、清除仍在本页完成。" />
                  </div>
                </section>

                <section className="admin-panel p-4">
                  <SectionHeading icon={Zap} title="快捷入口" note="常用动作放在右侧，减少来回找。" />
                  <div className="mt-4 grid gap-2">
                    <QuickButton label="读取配置" icon={RefreshCw} onClick={() => void load()} testId="admin-quick-load" />
                    <QuickButton label="查看 Key 管理" icon={KeyRound} onClick={() => jumpTo(navGroups[1].items[1])} testId="admin-quick-keys" />
                    <QuickButton label="查看模型价格" icon={Layers} onClick={() => jumpTo(navGroups[2].items[2])} testId="admin-quick-models" />
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SidebarButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`admin-nav-${item.id}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition",
        active ? "border border-cyan-400/20 bg-cyan-500/16 text-cyan-100" : "text-white/58 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span>{item.label}</span>
    </button>
  );
}

function SectionTitle({
  action,
  eyebrow,
  icon: Icon,
  title,
}: {
  action: string;
  eyebrow: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-white/[0.06] text-cyan-200">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-white/35">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-black">{title}</h2>
        </div>
      </div>
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/45">
        {action}
      </span>
    </div>
  );
}

function SectionHeading({ icon: Icon, note, title }: { icon: LucideIcon; note: string; title: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-cyan-200">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-black text-white/92">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-white/45">{note}</p>
      </div>
    </div>
  );
}

function OverviewCard({
  detail,
  icon: Icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone: "amber" | "cyan" | "emerald" | "violet";
  value: string;
}) {
  const toneClass = {
    amber: "bg-amber-500/15 text-amber-200 border-amber-300/20",
    cyan: "bg-cyan-500/15 text-cyan-200 border-cyan-300/20",
    emerald: "bg-emerald-500/15 text-emerald-200 border-emerald-300/20",
    violet: "bg-violet-500/15 text-violet-200 border-violet-300/20",
  }[tone];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/18">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white/58">{label}</p>
          <p className="mt-3 text-2xl font-black text-white">{value}</p>
        </div>
        <span className={cn("grid size-11 place-items-center rounded-2xl border", toneClass)}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-white/42">{detail}</p>
    </div>
  );
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[11px] text-white/42">{label}</p>
      <p className="mt-1 text-sm font-black text-white/88">{value}</p>
    </div>
  );
}

function ReservedMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs text-white/42">{label}</p>
      <p className="mt-2 text-lg font-black text-white/88">{value}</p>
    </div>
  );
}

function CreditBlock({ note, title, value }: { note: string; title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white/82">{title}</p>
        <span className="rounded-full bg-amber-500/12 px-3 py-1 text-xs text-amber-200">{value}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-white/44">{note}</p>
    </div>
  );
}

function PlaceholderRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2">
      <span>{left}</span>
      <span className="text-xs text-white/34">{right}</span>
    </div>
  );
}

function TimelineRow({ meta, status, title }: { meta: string; status: string; title: string }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:grid-cols-[160px_1fr_auto] md:items-center">
      <div>
        <p className="font-bold text-white/82">{title}</p>
        <p className="mt-1 text-xs text-white/38">{meta}</p>
      </div>
      <p className="text-sm leading-6 text-white/48">{status}</p>
      <span className="w-fit rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/45">预留</span>
    </div>
  );
}

function NoticeRow({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <p className="text-sm font-bold text-white/82">{title}</p>
      <p className="mt-1 text-xs leading-5 text-white/42">{body}</p>
    </div>
  );
}

function QuickButton({
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 text-sm text-white/66 transition hover:border-cyan-300/30 hover:text-white"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4" />
        {label}
      </span>
      <ChevronDown className="size-4 -rotate-90 text-white/32" />
    </button>
  );
}

function StatusBadge({ ready, enabled, local }: { ready: boolean; enabled: boolean; local: boolean }) {
  if (!enabled) {
    return <span className="w-fit rounded-full bg-white/[0.08] px-3 py-1 text-xs text-white/52">已禁用</span>;
  }
  if (ready) {
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200">
        <Check className="size-3" />
        {local ? "本机可用" : "已启用"}
      </span>
    );
  }
  return <span className="w-fit rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-200">缺少 Key</span>;
}
