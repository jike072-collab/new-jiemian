"use client";

import { ArrowLeft, Eye, EyeOff, Fingerprint, Loader2, Lock, Mail, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

type LoginMode = "account" | "phone";

export function CustomerLogin() {
  const [mode, setMode] = useState<LoginMode>("account");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("这里先放客户登录入口，后面再接真实账号系统。");

  function submit() {
    setLoading(true);
    setMessage("登录入口已预留，后续接入账号系统后会在这里完成进入。");
    window.setTimeout(() => setLoading(false), 900);
  }

  return (
    <main className="page-shell min-h-screen overflow-x-hidden bg-[#050507] text-white">
      <div className="grain-layer" />
      <span className="particle particle-fast left-[12%] top-[18%] size-2" />
      <span className="particle particle-slow left-[78%] top-[14%] size-3" />
      <span className="particle particle-fast left-[66%] top-[68%] size-2" />
      <span className="particle particle-slow left-[24%] top-[74%] size-1.5" />

      <div className="relative mx-auto flex min-h-screen max-w-[1680px] flex-col gap-4 p-3 sm:p-4">
        <header className="flex items-center justify-between rounded-[2rem] border border-white/10 bg-[#0d0e13]/92 px-4 py-3 backdrop-blur-xl">
          <Link href="/" className="flex items-center gap-3 clickable">
            <div className="grid size-10 place-items-center rounded-2xl bg-white/10">
              <BrandLogo className="size-7" />
            </div>
            <div>
              <p className="text-sm font-black">奥皇 AI</p>
              <p className="text-xs text-white/45">客户登录</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/admin/providers" className="hidden admin-secondary clickable sm:flex">
              后台
            </Link>
            <Link href="/" className="admin-secondary clickable">
              <ArrowLeft className="size-4" />
              返回工作台
            </Link>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_minmax(420px,520px)_1fr]">
          <div className="hidden rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 xl:block">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">客户入口</p>
            <h1 className="mt-2 text-3xl font-black">先把入口做出来</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/52">
              这里会给客户一个干净的登录面。后面接入账号、积分和使用记录后，就能直接从这里进去。
            </p>

            <div className="mt-6 grid gap-3">
              {[
                ["账号登录", "客户名、手机号或邮箱"],
                ["安全感", "先保留验证和记住登录"],
                ["后续扩展", "积分、套餐、历史记录都会接进来"],
              ].map(([title, detail]) => (
                <div key={title} className="soft-card rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-bold text-white/82">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-white/45">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-[520px] rounded-[2rem] border border-white/10 bg-[#0d0e13]/96 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/70">客户登录</p>
                  <h2 className="mt-2 text-2xl font-black">输入账号进入</h2>
                  <p className="mt-2 text-sm leading-6 text-white/50">先把输入框和按钮做好，后面再接真实登录。</p>
                </div>
                <span className="grid size-11 place-items-center rounded-2xl bg-white/10 text-cyan-200">
                  <Sparkles className="size-5" />
                </span>
              </div>

              <div className="mt-6 grid gap-3">
                <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.035] p-1">
                  <button
                    type="button"
                    onClick={() => setMode("account")}
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm font-bold clickable",
                      mode === "account" ? "bg-cyan-500/20 text-cyan-100" : "text-white/52",
                    )}
                  >
                    账号登录
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("phone")}
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm font-bold clickable",
                      mode === "phone" ? "bg-cyan-500/20 text-cyan-100" : "text-white/52",
                    )}
                  >
                    手机登录
                  </button>
                </div>

                <label className="grid gap-2 text-sm text-white/70">
                  {mode === "account" ? "账号" : "手机号"}
                  <div className="field-fade rounded-2xl border border-white/10 bg-black/25 p-2">
                    <div className="flex items-center gap-2 rounded-[1.1rem] border border-white/10 bg-black/35 px-4 py-3">
                      {mode === "account" ? <UserRound className="size-4 text-white/45" /> : <Mail className="size-4 text-white/45" />}
                      <input
                        className="w-full bg-transparent text-white outline-none placeholder:text-white/25"
                        placeholder={mode === "account" ? "请输入账号" : "请输入手机号"}
                      />
                    </div>
                  </div>
                </label>

                <label className="grid gap-2 text-sm text-white/70">
                  密码
                  <div className="field-fade rounded-2xl border border-white/10 bg-black/25 p-2">
                    <div className="flex items-center gap-2 rounded-[1.1rem] border border-white/10 bg-black/35 px-4 py-3">
                      <Lock className="size-4 text-white/45" />
                      <input
                        type={showPassword ? "text" : "password"}
                        className="w-full bg-transparent text-white outline-none placeholder:text-white/25"
                        placeholder="请输入密码"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="clickable text-white/45 transition hover:text-white"
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                </label>

                <label className="grid gap-2 text-sm text-white/70">
                  验证码
                  <div className="field-fade rounded-2xl border border-white/10 bg-black/25 p-2">
                    <div className="flex items-center gap-2 rounded-[1.1rem] border border-white/10 bg-black/35 px-4 py-3">
                      <Fingerprint className="size-4 text-white/45" />
                      <input
                        className="w-full bg-transparent text-white outline-none placeholder:text-white/25"
                        placeholder="先预留验证码位置"
                      />
                    </div>
                  </div>
                </label>

                <div className="flex items-center justify-between gap-3 text-sm text-white/48">
                  <label className="flex items-center gap-2 clickable">
                    <input type="checkbox" className="size-4 accent-cyan-500" />
                    记住登录
                  </label>
                  <button
                    type="button"
                    onClick={() => setMessage("找回密码入口已预留，后续可以接短信、邮箱或管理员重置。")}
                    className="clickable text-cyan-200"
                  >
                    忘记密码
                  </button>
                </div>

                <button
                  type="button"
                  onClick={submit}
                  disabled={loading}
                  className="admin-primary mt-1 justify-center clickable disabled:hover:translate-y-0"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
                  进入工作台
                </button>

                <p className="text-sm leading-6 text-white/45">{message}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
                  <button
                    type="button"
                    onClick={() => setMessage("申请开通入口已预留，后续可以接表单或自动创建客户账号。")}
                    className="clickable rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5"
                  >
                    申请开通
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessage("联系管理员入口已预留，后续可以接微信、邮箱或客服。")}
                    className="clickable rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5"
                  >
                    联系管理员
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 xl:block">
            <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-300/70">后续能力</p>
            <h3 className="mt-2 text-xl font-black">后面会接这些内容</h3>
            <div className="mt-5 space-y-3">
              {[
                "客户积分余额",
                "历史使用记录",
                "当前套餐状态",
                "登录后直达控制台",
              ].map((item) => (
                <div key={item} className="soft-card rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/72">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
