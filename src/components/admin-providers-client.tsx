"use client";

import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, KeyRound, Loader2, RefreshCw, Save, ServerCog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import type { EndpointType, ProviderKind, PublicProvider } from "@/lib/server/types";

type EditableProvider = PublicProvider & {
  newApiKey: string;
  clearApiKey: boolean;
};

type HealthMode = "static" | "connectivity" | "models";
type HealthStatus = "ok" | "warning" | "error" | "unknown";
type ModelKind = "image" | "imageEdit" | "video" | "imageUpscale" | "videoUpscale";

type HealthIssue = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  details?: string;
};

type ProviderHealthResult = {
  providerId: string;
  providerName: string;
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  configured: boolean;
  reachable: "unchecked" | "reachable" | "unreachable" | "skipped";
  authConfigured: boolean;
  modelsConfigured: boolean;
  supportedTools: string[];
  endpointType: EndpointType;
  endpoint: {
    configured: boolean;
    maskedHost: string;
    validUrl: boolean;
  };
  apiKey: {
    configured: boolean;
    masked: string;
  };
  models: Record<ModelKind, {
    configured: boolean;
    model: string;
    available: "unknown" | "yes" | "no";
  }>;
  status: HealthStatus;
  issues: HealthIssue[];
  warnings: HealthIssue[];
  errors: HealthIssue[];
  checkedAt: string;
  lastCheck: {
    status: HealthStatus;
    durationMs: number;
  };
};

type ModelHealthSummary = Record<ModelKind, {
  configured: number;
  missing: number;
  unavailable: number;
  unknown: number;
  providerIds: string[];
  missingProviderIds: string[];
  unavailableProviderIds: string[];
}>;

type ProviderHealthReport = {
  ok: boolean;
  checkedAt: string;
  mode: HealthMode;
  providers: ProviderHealthResult[];
  modelHealth: ModelHealthSummary;
  newApi: {
    configured: boolean;
    baseUrlConfigured: boolean;
    adminConfigured: boolean;
    reachable: "unchecked" | "reachable" | "unreachable" | "skipped";
    checked: boolean;
    skippedReason: string;
    warnings: HealthIssue[];
    errors: HealthIssue[];
  };
  summary: {
    total: number;
    ok: number;
    warning: number;
    error: number;
    unknown: number;
  };
  liveGenerationEnabled: false;
};

const endpointOptions: Array<{ value: EndpointType; label: string }> = [
  { value: "images-generations", label: "OpenAI-compatible images/generations" },
  { value: "images-edits", label: "OpenAI-compatible images/edits (multipart)" },
  { value: "chat-completions", label: "OpenAI-compatible chat/completions" },
  { value: "videos-generations", label: "OpenAI-compatible videos/generations" },
  { value: "volcengine-imagex-upscale", label: "火山 ImageX（图片高清）" },
  { value: "volcengine-vod-upscale", label: "火山 VOD（视频高清）" },
];

function endpointOptionsFor(provider: EditableProvider) {
  if (provider.kind === "image") return endpointOptions.filter((option) => option.value.startsWith("images-"));
  if (provider.kind === "video") return endpointOptions.filter((option) => option.value === "videos-generations");
  if (provider.kind === "image-upscale") return endpointOptions.filter((option) => option.value === "volcengine-imagex-upscale");
  if (provider.kind === "prompt") return endpointOptions.filter((option) => option.value === "chat-completions");
  return endpointOptions.filter((option) => option.value === "volcengine-vod-upscale");
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && ("error" in data || "message" in data)
        ? String((data as { error?: string; message?: string }).error || (data as { message?: string }).message)
        : "请求失败。",
    );
  }
  return data as { providers: PublicProvider[] };
}

async function readHealthJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && ("error" in data || "message" in data)
        ? String((data as { error?: string; message?: string }).error || (data as { message?: string }).message)
        : "检测失败。",
    );
  }
  return data as { report: ProviderHealthReport };
}

const healthModes: Array<{ mode: HealthMode; label: string; detail: string }> = [
  { mode: "static", label: "静态检测", detail: "只读本地配置" },
  { mode: "connectivity", label: "连接检测", detail: "HEAD/GET 网关" },
  { mode: "models", label: "模型列表检测", detail: "读取 /models" },
];

const modelLabels: Record<ModelKind, string> = {
  image: "图片生成",
  imageEdit: "图片编辑",
  video: "视频生成",
  imageUpscale: "图片高清",
  videoUpscale: "视频高清",
};

function healthStatusLabel(status: HealthStatus) {
  if (status === "ok") return "正常";
  if (status === "warning") return "警告";
  if (status === "error") return "错误";
  return "未检测";
}

function healthStatusClass(status: HealthStatus) {
  if (status === "ok") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (status === "warning") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  if (status === "error") return "border-red-400/30 bg-red-500/10 text-red-100";
  return "border-white/10 bg-white/5 text-white/55";
}

function healthStatusIcon(status: HealthStatus) {
  if (status === "ok") return <CheckCircle2 className="size-4" />;
  if (status === "warning") return <AlertTriangle className="size-4" />;
  if (status === "error") return <AlertTriangle className="size-4" />;
  return <CircleDashed className="size-4" />;
}

function modelAvailabilityLabel(value: "unknown" | "yes" | "no") {
  if (value === "yes") return "可用";
  if (value === "no") return "缺失";
  return "未知";
}

function reachabilityLabel(value: ProviderHealthResult["reachable"]) {
  if (value === "reachable") return "可连接";
  if (value === "unreachable") return "不可连接";
  if (value === "skipped") return "跳过检测";
  return "未检测";
}

export function AdminProvidersClient() {
  const [providers, setProviders] = useState<EditableProvider[]>([]);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("输入管理密码后读取配置；未设置密码时可直接读取。");
  const [loading, setLoading] = useState(false);
  const [healthReport, setHealthReport] = useState<ProviderHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState<HealthMode | null>(null);
  const [healthError, setHealthError] = useState("");

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

  async function checkHealth(mode: HealthMode) {
    setHealthLoading(mode);
    setHealthError("");
    setStatus(`${healthModes.find((item) => item.mode === mode)?.label || "检测"}正在执行，不会提交生成任务。`);
    try {
      const response = await fetch(`/api/admin/provider-health?mode=${mode}`, { headers: headers() });
      const data = await readHealthJson(response);
      setHealthReport(data.report);
      setStatus(`检测完成：正常 ${data.report.summary.ok}，警告 ${data.report.summary.warning}，错误 ${data.report.summary.error}。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "检测失败。";
      setHealthError(message);
      setStatus(message);
    } finally {
      setHealthLoading(null);
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

        <section data-stage4-provider-health className="mt-5 rounded-[1.5rem] border border-white/10 bg-[#101012]/92 p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <ServerCog className="size-5 text-fuchsia-300" />
                <h2 className="text-xl font-black">供应商连接检测</h2>
              </div>
              <p className="mt-2 text-sm text-white/48">检测只读配置、网关连通性和模型列表，不会调用生成接口，不会产生费用，不会提交图片、视频或高清生成任务。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {healthModes.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => checkHealth(item.mode)}
                  disabled={Boolean(healthLoading)}
                  className="admin-secondary"
                  title={`${item.label}：${item.detail}`}
                >
                  {healthLoading === item.mode ? <Loader2 className="size-4 animate-spin" /> : <Activity className="size-4" />}
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {healthError ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <span>{healthError}</span>
            </div>
          ) : null}

          {healthReport ? (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {[
                  ["总数", healthReport.summary.total],
                  ["正常", healthReport.summary.ok],
                  ["警告", healthReport.summary.warning],
                  ["错误", healthReport.summary.error],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs text-white/42">{label}</p>
                    <p className="mt-1 text-2xl font-black">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-[0.95fr_1.4fr]">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200">NewAPI</p>
                  <div className="mt-3 grid gap-2 text-sm text-white/58">
                    <span>配置状态：{healthReport.newApi.configured ? "已配置" : "未配置"}</span>
                    <span>基础连接：{healthReport.newApi.reachable === "skipped" ? "跳过检测" : reachabilityLabel(healthReport.newApi.reachable)}</span>
                    <span>管理员凭据：{healthReport.newApi.adminConfigured ? "已配置" : "未配置"}</span>
                    {healthReport.newApi.skippedReason ? (
                      <span className="text-white/42">{healthReport.newApi.skippedReason}</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200">模型可用性</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    {Object.entries(healthReport.modelHealth).map(([kind, summary]) => (
                      <div key={kind} className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-xs text-white/45">{modelLabels[kind as ModelKind]}</p>
                        <p className="mt-1 text-sm text-white/70">已配置 {summary.configured}</p>
                        <p className="text-xs text-white/38">缺失 {summary.missing} · 不可用 {summary.unavailable}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {healthReport.providers.length ? healthReport.providers.map((provider) => (
                  <article key={provider.id} className="rounded-2xl border border-white/10 bg-black/22 p-4">
                    <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-black">{provider.name}</h3>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${healthStatusClass(provider.status)}`}>
                            {healthStatusIcon(provider.status)}
                            {healthStatusLabel(provider.status)}
                          </span>
                          {!provider.enabled ? (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/45">已停用</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-white/38">{provider.id} · {provider.endpointType}</p>
                      </div>
                      <div className="grid gap-2 text-xs text-white/55 sm:grid-cols-3 xl:min-w-[520px]">
                        <span>Endpoint：{provider.endpoint.maskedHost || (provider.endpoint.configured ? "格式异常" : "未配置")}</span>
                        <span>API Key：{provider.apiKey.configured ? (provider.apiKey.masked || "configured") : "missing"}</span>
                        <span>连接：{reachabilityLabel(provider.reachable)} · 耗时：{provider.lastCheck.durationMs}ms</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(provider.models)
                        .filter(([, model]) => model.configured || model.model)
                        .map(([kind, model]) => (
                          <span
                            key={kind}
                            className={`rounded-full border px-3 py-1 text-xs ${model.available === "no" ? "border-red-400/25 bg-red-500/10 text-red-100" : "border-white/10 bg-white/5 text-white/58"}`}
                          >
                            {modelLabels[kind as ModelKind]}：{model.model || "missing"} · {modelAvailabilityLabel(model.available)}
                          </span>
                        ))}
                    </div>

                    {provider.issues.length ? (
                      <div className="mt-4 grid gap-2">
                        {provider.issues.map((item, index) => (
                          <p key={`${item.code}-${index}`} className="text-sm text-white/58">
                            <span className={item.severity === "error" ? "text-red-200" : item.severity === "warning" ? "text-amber-100" : "text-white/55"}>
                              {item.code}
                            </span>
                            ：{item.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
                    暂无供应商配置。
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
              尚未检测。可先执行静态检测，再按需执行连接检测或模型列表检测。
            </div>
          )}
        </section>

        <section className="mt-5 grid gap-4">
          {providers.map((provider) => (
            <article key={provider.id} className="rounded-[1.5rem] border border-white/10 bg-[#101012]/92 p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-black">{provider.title}</h2>
                    <span className={`rounded-full px-2 py-1 text-xs ${provider.configured ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
                      {provider.configured ? "已配置" : "缺少密钥"}
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

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_.75fr_.75fr_1fr]">
                <label className="admin-field">
                  接口地址
                  <input
                    type="url"
                    value={provider.apiUrl}
                    onChange={(event) => update(provider.id, { apiUrl: event.target.value })}
                    className="admin-input"
                  />
                </label>
                <label className="admin-field">
                  模型
                  <input
                    value={provider.model}
                    onChange={(event) => update(provider.id, { model: event.target.value })}
                    className="admin-input"
                  />
                </label>
                <label className="admin-field">
                  前台显示名称
                  <input
                    value={provider.displayName}
                    onChange={(event) => update(provider.id, { displayName: event.target.value })}
                    placeholder={provider.model}
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
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
