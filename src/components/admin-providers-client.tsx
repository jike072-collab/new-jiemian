"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import type { EndpointType, PublicProvider } from "@/lib/server/types";

type EditableProvider = PublicProvider & {
  newApiKey: string;
  clearApiKey: boolean;
};

const endpointOptions: Array<{ value: EndpointType; label: string; short: string }> = [
  { value: "images-generations", label: "OpenAI-compatible images/generations", short: "图片生成" },
  { value: "images-edits", label: "OpenAI-compatible images/edits", short: "图片编辑" },
  { value: "videos-generations", label: "OpenAI-compatible videos/generations", short: "视频生成" },
  { value: "upscayl-cli", label: "本机 Upscayl CLI", short: "图片放大" },
  { value: "video2x-cli", label: "本机 Video2X CLI", short: "视频放大" },
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

  const stats = useMemo(() => {
    const enabled = providers.filter((provider) => provider.enabled).length;
    const configured = providers.filter((provider) => provider.configured || isLocalCli(provider.endpointType)).length;
    const remote = providers.filter((provider) => !isLocalCli(provider.endpointType)).length;
    return { enabled, configured, remote, total: providers.length };
  }, [providers]);

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
    await navigator.clipboard.writeText(value);
    setStatus("已复制到剪贴板。");
  }

  function clearProviderKey(provider: EditableProvider) {
    update(provider.id, { clearApiKey: true, newApiKey: "" });
    setStatus(`${provider.title} 保存后会清除密钥。`);
  }

  return (
    <main className="min-h-screen bg-[#050507] px-3 py-3 text-white sm:px-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.16),transparent_25%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.08),transparent_28%)]" />
      <div className="relative mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1800px] grid-rows-[auto_auto_1fr] gap-3">
        <header className="rounded-[2rem] border border-white/10 bg-[#0d0d11]/94 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-5">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10">
                <BrandLogo className="size-8" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/75">Admin Console</p>
                <h1 className="mt-1 text-2xl font-black md:text-3xl">Key 管理台</h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-white/52">
                  像表格一样集中管理图片、视频和本机放大配置；真实密钥默认隐藏，只显示安全预览。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/" className="admin-secondary">
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
        </header>

        <section className="grid gap-3 xl:grid-cols-[minmax(300px,420px)_1fr]">
          <div className="rounded-[1.5rem] border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
            <label className="grid gap-2 text-sm text-white/70">
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
          </div>
          <div className="grid gap-3 rounded-[1.5rem] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3 text-sm text-fuchsia-50/75">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-fuchsia-200" />
              <p>{status}</p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <AdminStat label="总数" value={stats.total} />
              <AdminStat label="启用" value={stats.enabled} />
              <AdminStat label="完整" value={stats.configured} />
              <AdminStat label="远程" value={stats.remote} />
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d0d11]/94 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/38">Provider Table</p>
              <h2 className="mt-1 text-xl font-black">配置列表</h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">
              <SlidersHorizontal className="size-3.5" />
              展开一行即可编辑详细信息
            </div>
          </div>

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
                        className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/45 transition hover:border-fuchsia-400/40 hover:text-white"
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
                      <span className="w-fit rounded-full border border-fuchsia-400/15 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-100">
                        {provider.kind}
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
                    <KeyRound className="mx-auto mb-3 size-8 text-fuchsia-300/70" />
                    <p className="text-lg font-black text-white/80">还没有读取配置</p>
                    <p className="mt-2 text-sm">点击右上角“读取配置”，这里会显示详细管理表。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
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
