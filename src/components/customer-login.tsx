"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";

type AuthMode = "login" | "register";

type SessionProbe = {
  ok: true;
  user: unknown;
};

export function CustomerLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("使用真实账户登录或注册。");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchJson<SessionProbe>("/api/auth/session");
        if (!cancelled) router.replace("/");
      } catch {
        // 未登录时停留在当前页。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submit() {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      if (mode === "login") {
        await fetchJsonWithCsrf("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier,
            password,
            redirectTo: "/",
          }),
        });
      } else {
        await fetchJsonWithCsrf("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            username: username || undefined,
            displayName: displayName || undefined,
            password,
            redirectTo: "/",
          }),
        });
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      const text = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "请求失败。";
      setMessage(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050507] px-4 py-6 text-white md:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <section className="grid w-full gap-6 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-[0_24px_80px_rgba(0,0,0,0.34)] lg:grid-cols-[1.05fr_.95fr]">
          <div className="flex flex-col justify-between gap-8 border-b border-white/10 p-6 lg:border-b-0 lg:border-r lg:p-8">
            <div className="flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
                <BrandLogo className="size-9" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-fuchsia-300/75">
                  Aohuang AI
                </p>
                <h1 className="mt-1 text-3xl font-black">登录工作台</h1>
              </div>
            </div>

            <div className="grid gap-3 text-sm leading-7 text-white/60">
              <p>真实账户、Session、额度和充值记录都会从服务端读取。</p>
              <p>登录后可继续访问工作台、账户额度和充值入口，退出后会由服务端立即失效。</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/35">Session</p>
                <p className="mt-2 text-sm font-semibold text-white/85">HttpOnly Cookie + CSRF</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/35">Account</p>
                <p className="mt-2 text-sm font-semibold text-white/85">真实用户和映射账户</p>
              </div>
            </div>
          </div>

          <div className="flex items-center p-6 lg:p-8">
            <div className="grid w-full gap-4 rounded-[1.75rem] border border-white/10 bg-[#0d0d11] p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm text-emerald-200">
                  <ShieldCheck className="size-4" />
                  真实认证
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 ${mode === "login" ? "bg-fuchsia-500 text-white" : "text-white/55"}`}
                    onClick={() => setMode("login")}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 ${mode === "register" ? "bg-fuchsia-500 text-white" : "text-white/55"}`}
                    onClick={() => setMode("register")}
                  >
                    注册
                  </button>
                </div>
              </div>

              {mode === "login" ? (
                <>
                  <label className="grid gap-2 text-sm text-white/70">
                    用户名或邮箱
                    <input
                      type="text"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      autoComplete="username"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-white/70">
                    密码
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="grid gap-2 text-sm text-white/70">
                    邮箱
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-white/70">
                    用户名
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-white/70">
                    显示名称
                    <input
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      autoComplete="nickname"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                    />
                  </label>
                  <p className="text-xs leading-6 text-white/42">
                    注册后会由服务端安全创建账户、Session 和 New API 映射。
                  </p>
                  <label className="grid gap-2 text-sm text-white/70">
                    密码
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition placeholder:text-white/28 focus:border-fuchsia-400"
                    />
                  </label>
                </>
              )}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={loading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 px-5 font-semibold text-white shadow-[0_16px_32px_rgba(168,85,247,0.24)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                {mode === "login" ? "进入工作台" : "创建账户"}
              </button>

              <div className="flex items-center gap-2 text-xs text-white/42">
                <KeyRound className="size-3.5" />
                不会在浏览器保存长期敏感令牌
              </div>

              {message ? <p className="text-sm leading-6 text-rose-200">{message}</p> : null}

              <Link
                href="/admin/providers"
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white/68 transition hover:border-fuchsia-400/40 hover:text-white"
              >
                打开后台设置
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
