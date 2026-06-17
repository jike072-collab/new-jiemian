import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";

export function CustomerLogin() {
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
              <p>当前版本在本地默认开放，不做强制访问拦截。</p>
              <p>这里保留一个可直接进入的登录面，方便后续再接回真实账户流程。</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/35">Access</p>
                <p className="mt-2 text-sm font-semibold text-white/85">不需要额外开关即可进入</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/35">Mode</p>
                <p className="mt-2 text-sm font-semibold text-white/85">本地工作台直达</p>
              </div>
            </div>
          </div>

          <div className="flex items-center p-6 lg:p-8">
            <form action="/" className="grid w-full gap-4 rounded-[1.75rem] border border-white/10 bg-[#0d0d11] p-5">
              <div className="flex items-center gap-2 text-sm text-emerald-200">
                <ShieldCheck className="size-4" />
                本地访问默认放行
              </div>

              <label className="grid gap-2 text-sm text-white/70">
                账号
                <input
                  type="text"
                  defaultValue="local-user"
                  className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition focus:border-fuchsia-400"
                />
              </label>

              <label className="grid gap-2 text-sm text-white/70">
                密码
                <input
                  type="password"
                  defaultValue=""
                  placeholder="留空也可以直接进入"
                  className="h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition placeholder:text-white/28 focus:border-fuchsia-400"
                />
              </label>

              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 px-5 font-semibold text-white shadow-[0_16px_32px_rgba(168,85,247,0.24)] transition hover:-translate-y-0.5"
              >
                进入工作台
                <ArrowRight className="size-4" />
              </button>

              <div className="flex items-center gap-2 text-xs text-white/42">
                <LockKeyhole className="size-3.5" />
                这里不会做额外拦截
              </div>

              <Link
                href="/admin/providers"
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white/68 transition hover:border-fuchsia-400/40 hover:text-white"
              >
                打开后台设置
              </Link>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
