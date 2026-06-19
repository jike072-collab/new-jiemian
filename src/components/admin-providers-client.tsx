"use client";

import { ArrowLeft, KeyRound, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import type { EndpointType, PublicProvider } from "@/lib/server/types";

type EditableProvider = PublicProvider & {
  newApiKey: string;
  clearApiKey: boolean;
};

type ProviderModelState = {
  loading: boolean;
  options: ModelOption[];
  error: string;
};

type ModelOption = {
  value: string;
  label: string;
  displayName: string;
};

const endpointOptions: Array<{ value: EndpointType; label: string }> = [
  { value: "images-generations", label: "OpenAI-compatible images/generations" },
  { value: "images-edits", label: "OpenAI-compatible images/edits (multipart)" },
  { value: "chat-completions", label: "OpenAI-compatible chat/completions" },
  { value: "videos-generations", label: "OpenAI-compatible videos/generations" },
  { value: "grok-videos", label: "Grok 视频 /v1/videos（异步）" },
  { value: "upscayl-cli", label: "本地 Upscayl CLI（图片高清）" },
  { value: "video2x-cli", label: "本地 Video2X CLI（视频高清）" },
];

const grokVideoModelOptions: ModelOption[] = [
  { value: "grok-video-1.0", label: "grok-video-1.0（文生视频 / 可选参考图）", displayName: "Grok 视频 1.0" },
  { value: "grok-video-1.5", label: "grok-video-1.5（必须 1 张参考图）", displayName: "Grok 视频 1.5" },
];

const promptOptimizerModelOptions: ModelOption[] = [
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash（DeepSeek 官方）", displayName: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "deepseek-v4-pro（DeepSeek 官方）", displayName: "DeepSeek V4 Pro" },
];

function endpointOptionsFor(provider: EditableProvider) {
  if (provider.kind === "image") return endpointOptions.filter((option) => option.value.startsWith("images-"));
  if (provider.kind === "video") return endpointOptions.filter((option) => option.value === "videos-generations" || option.value === "grok-videos");
  if (provider.kind === "prompt") return endpointOptions.filter((option) => option.value === "chat-completions");
  if (provider.kind === "image-upscale") return endpointOptions.filter((option) => option.value === "upscayl-cli");
  return endpointOptions.filter((option) => option.value === "video2x-cli");
}

function modelOptionsFor(provider: EditableProvider, fetched: ModelOption[] = []) {
  const defaults = provider.endpointType === "grok-videos"
    ? grokVideoModelOptions
    : provider.kind === "prompt" ? promptOptimizerModelOptions : [];
  const byValue = new Map([...defaults, ...fetched].map((option) => [option.value, option]));
  return Array.from(byValue.values());
}

function isLocalCli(endpointType: EndpointType) {
  return endpointType === "upscayl-cli" || endpointType === "video2x-cli";
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
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModelState>>({});
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("输入管理密码后读取配置；未设置密码时可直接读取。");
  const [loading, setLoading] = useState(false);

  function headers() {
    return {
      "Content-Type": "application/json",
      ...(password ? { "x-admin-password": password } : {}),
    };
  }

  async function load() {
    setLoading(true);
    setStatus("正在读取供应商配置...");
    try {
      const response = await fetch("/api/admin/providers", { headers: headers() });
      const data = await readJson(response);
      setProviders(data.providers.map((provider) => ({
        ...provider,
        newApiKey: "",
        clearApiKey: false,
      })));
      setStatus(`已读取 ${data.providers.length} 个供应商配置。`);
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
            displayName: provider.displayName,
            endpointType: provider.endpointType,
            enabled: provider.enabled,
            ...(provider.newApiKey ? { apiKey: provider.newApiKey } : {}),
            ...(provider.clearApiKey ? { clearApiKey: true } : {}),
          })),
        }),
      });
      const data = await readJson(response);
      setProviders(data.providers.map((provider) => ({
        ...provider,
        newApiKey: "",
        clearApiKey: false,
      })));
      setStatus("配置已保存。前台会自动只显示已启用且配置完整的模型。");
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

  function updateModel(provider: EditableProvider, model: string) {
    const options = modelOptionsFor(provider, providerModels[provider.id]?.options);
    const option = options.find((item) => item.value === model);
    const managedDisplayNames = new Set(options.map((item) => item.displayName));
    const shouldSyncDisplayName = Boolean(option)
      && (!provider.displayName || managedDisplayNames.has(provider.displayName));
    update(provider.id, {
      model,
      ...(shouldSyncDisplayName ? { displayName: option?.displayName } : {}),
    });
  }

  async function fetchModels(provider: EditableProvider) {
    if (isLocalCli(provider.endpointType)) return;
    setProviderModels((current) => ({
      ...current,
      [provider.id]: {
        loading: true,
        options: current[provider.id]?.options || [],
        error: "",
      },
    }));
    try {
      const response = await fetch("/api/admin/providers/models", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          id: provider.id,
          apiUrl: provider.apiUrl,
          apiKey: provider.newApiKey || undefined,
        }),
      });
      const data = await response.json().catch(() => ({})) as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "读取模型失败。");
      const options = Array.from(new Set(data.models || []))
        .filter(Boolean)
        .map((model) => ({ value: model, label: model, displayName: model }));
      setProviderModels((current) => ({
        ...current,
        [provider.id]: { loading: false, options, error: "" },
      }));
      setStatus(options.length ? `已读取 ${provider.title} 的 ${options.length} 个模型。` : `${provider.title} 没有返回可用模型。`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "读取模型失败。";
      setProviderModels((current) => ({
        ...current,
        [provider.id]: {
          loading: false,
          options: current[provider.id]?.options || [],
          error: text,
        },
      }));
      setStatus(text);
    }
  }

  return (
    <main className="min-h-screen bg-[#050507] px-4 py-6 text-white md:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(236,0,122,0.18),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1500px]">
        <header className="rounded-[2rem] border border-white/10 bg-[#101012]/95 p-6">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="flex items-center gap-4">
              <div className="grid size-13 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600">
                <BrandLogo className="size-8" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-fuchsia-300">奥皇 AI 管理后台</p>
                <h1 className="mt-1 text-3xl font-black">模型供应商配置</h1>
                <p className="mt-2 text-sm text-white/48">接口地址或本地可执行文件路径、模型和密钥只在这里维护，普通工作台不会显示真实密钥。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/" className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/65 hover:text-white">
                <ArrowLeft className="size-4" />
                返回工作台
              </Link>
              <button type="button" onClick={load} disabled={loading} className="admin-secondary">
                <RefreshCw className="size-4" />
                读取配置
              </button>
              <button type="button" onClick={save} disabled={loading || !providers.length} className="admin-primary">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存配置
              </button>
            </div>
          </div>
        </header>

        <section className="mt-4 grid gap-3 rounded-[1.5rem] border border-fuchsia-400/20 bg-fuchsia-500/8 p-4 md:grid-cols-[minmax(0,420px)_1fr] md:items-center">
          <label className="grid gap-2 text-sm text-white/70">
            管理密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="未设置 ADMIN_PASSWORD 时可留空"
              className="admin-input"
            />
          </label>
          <div className="flex items-start gap-3 text-sm text-white/55">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
            <p>{status}</p>
          </div>
        </section>

        <section className="mt-5 grid gap-4">
          {providers.map((provider) => {
            const modelState = providerModels[provider.id] || { loading: false, options: [], error: "" };
            const modelOptions = modelOptionsFor(provider, modelState.options);
            const canFetchModels = !isLocalCli(provider.endpointType);
            return (
            <article key={provider.id} className="rounded-[1.5rem] border border-white/10 bg-[#101012]/92 p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-black">{provider.title}</h2>
                    <span className={`rounded-full px-2 py-1 text-xs ${provider.configured || isLocalCli(provider.endpointType) ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
                      {isLocalCli(provider.endpointType) ? "无需密钥" : provider.configured ? "已配置" : "缺少密钥"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/45">{provider.role}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-white/65">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) => update(provider.id, { enabled: event.target.checked })}
                    className="size-4 accent-fuchsia-500"
                  />
                  前台启用
                </label>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_.7fr_.7fr_1fr]">
                <label className="admin-field">
                  {isLocalCli(provider.endpointType) ? "可执行文件路径（留空自动检测）" : "接口地址"}
                  <input
                    type={isLocalCli(provider.endpointType) ? "text" : "url"}
                    value={provider.apiUrl}
                    onChange={(event) => update(provider.id, { apiUrl: event.target.value })}
                    placeholder={isLocalCli(provider.endpointType) ? "留空时自动检测本机安装路径" : undefined}
                    className="admin-input"
                  />
                </label>
                <div className="admin-field">
                  模型
                  <div className="grid gap-2">
                    {modelOptions.length ? (
                      <select
                        value={provider.model}
                        onChange={(event) => updateModel(provider, event.target.value)}
                        className="admin-input"
                      >
                        {modelOptions.some((option) => option.value === provider.model) ? null : (
                          <option value={provider.model}>{provider.model || "当前模型"}</option>
                        )}
                        {modelOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : null}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <input
                        value={provider.model}
                        onChange={(event) => update(provider.id, { model: event.target.value })}
                        placeholder="手动填写模型 ID"
                        className="admin-input"
                      />
                      {canFetchModels ? (
                        <button
                          type="button"
                          onClick={() => void fetchModels(provider)}
                          disabled={modelState.loading || loading}
                          className="admin-secondary h-12 whitespace-nowrap px-3 py-0"
                        >
                          {modelState.loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                          读取模型
                        </button>
                      ) : null}
                    </div>
                    {modelState.error ? <p className="text-xs text-red-300">{modelState.error}</p> : null}
                  </div>
                </div>
                <label className="admin-field">
                  前台名称
                  <input
                    value={provider.displayName || ""}
                    onChange={(event) => update(provider.id, { displayName: event.target.value })}
                    placeholder="不填则显示模型 ID"
                    className="admin-input"
                  />
                </label>
                <label className="admin-field">
                  接口类型
                  <select
                    value={provider.endpointType}
                    onChange={(event) => update(provider.id, { endpointType: event.target.value as EndpointType })}
                    className="admin-input"
                  >
                    {endpointOptionsFor(provider).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {isLocalCli(provider.endpointType) ? (
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200">
                  <KeyRound className="size-4 shrink-0" />
                  本地 CLI 直接在本机运行，无需 API Key。
                </div>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                  <label className="admin-field">
                    <span className="flex items-center gap-2">
                      <KeyRound className="size-4" />
                      替换 API Key
                    </span>
                    <input
                      type="password"
                      value={provider.newApiKey}
                      disabled={provider.clearApiKey}
                      onChange={(event) => update(provider.id, { newApiKey: event.target.value })}
                      placeholder={provider.keyPreview ? `当前密钥：${provider.keyPreview}；留空保持不变` : "尚未配置密钥"}
                      className="admin-input"
                    />
                  </label>
                  <label className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 px-4 text-sm text-white/55">
                    <input
                      type="checkbox"
                      checked={provider.clearApiKey}
                      onChange={(event) => update(provider.id, { clearApiKey: event.target.checked, newApiKey: "" })}
                      className="size-4 accent-red-500"
                    />
                    清除密钥
                  </label>
                </div>
              )}
            </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
