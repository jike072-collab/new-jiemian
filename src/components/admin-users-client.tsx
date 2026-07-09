"use client";

import { ArrowLeft, Loader2, RefreshCw, Save, ShieldCheck, UserX, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import type { MembershipCycle, MembershipPlan } from "@/lib/server/membership/plans";
import type { MembershipStatusSnapshot } from "@/lib/server/membership/types";

type AdminUser = {
  local_user_id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  status: string;
  role: string;
  created_at: string;
  membership: MembershipStatusSnapshot;
};

type AdminUsersResponse = {
  ok: true;
  users: AdminUser[];
  membership_plans: MembershipPlan[];
  total: number;
};

type MembershipGrantResponse = {
  ok: true;
  membership_status: MembershipStatusSnapshot;
  credited_quota: number;
};

type AdminUserStatusResponse = {
  ok: true;
  user: Omit<AdminUser, "membership">;
};

const cycleLabels: Record<MembershipCycle, string> = {
  monthly: "月套餐",
  quarterly: "季套餐",
  yearly: "年度套餐",
};

const entitlementLabels = {
  prompt_optimize: "提示词",
  image_generation: "生图",
  video_generation: "视频",
} as const;

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function userName(user: AdminUser) {
  return user.display_name || user.username || user.email || user.local_user_id;
}

function planName(plans: MembershipPlan[], planId: string | null | undefined) {
  return plans.find((plan) => plan.id === planId)?.name || "未开通";
}

function entitlementSummary(status: MembershipStatusSnapshot) {
  return (Object.entries(entitlementLabels) as Array<[keyof typeof entitlementLabels, string]>)
    .map(([kind, label]) => `${label} ${status.entitlements[kind]?.remaining || 0}`)
    .join(" / ");
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("后台用户套餐只管理主站会员权益，NewAPI 分组仍用于上游模型路由。");
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [selectedCycles, setSelectedCycles] = useState<Record<string, MembershipCycle>>({});

  const defaultPlanId = plans[0]?.id || "";
  const sortedUsers = useMemo(() => users.slice().sort((a, b) => Number(new Date(b.created_at)) - Number(new Date(a.created_at))), [users]);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<AdminUsersResponse>("/api/admin/users?pageSize=100");
      setUsers(data.users);
      setPlans(data.membership_plans);
      setMessage(`已读取 ${data.total} 个用户，可查看并手动开通当前套餐。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function grantMembership(user: AdminUser) {
    const planId = selectedPlans[user.local_user_id] || user.membership.active?.plan_id || defaultPlanId;
    const cycle = selectedCycles[user.local_user_id] || user.membership.active?.cycle || "monthly";
    if (!planId) {
      setMessage("请先选择套餐。");
      return;
    }
    setSavingUserId(user.local_user_id);
    try {
      const data = await fetchJsonWithCsrf<MembershipGrantResponse>(`/api/admin/users/${encodeURIComponent(user.local_user_id)}/membership`, {
        method: "POST",
        body: JSON.stringify({
          planId,
          cycle,
          idempotencyKey: `admin-membership-${user.local_user_id}-${Date.now()}`,
          reason: "后台手动开通套餐",
        }),
      });
      setUsers((current) => current.map((entry) => (
        entry.local_user_id === user.local_user_id
          ? { ...entry, membership: data.membership_status }
          : entry
      )));
      setMessage(`${userName(user)} 已开通 ${planName(plans, planId)}，到账 ${formatCredits(data.credited_quota)} 积分。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "套餐开通失败。");
    } finally {
      setSavingUserId(null);
    }
  }

  async function releaseUserEmail(user: AdminUser) {
    if (user.role === "admin") {
      setMessage("管理员账号不能在这里注销释放邮箱，请先保留至少一个可用管理员。");
      return;
    }
    const label = user.email || user.username || user.local_user_id;
    const confirmed = window.confirm(`确认注销 ${label} 并释放邮箱吗？该用户会被禁用，邮箱和用户名可重新注册。`);
    if (!confirmed) return;

    setSavingUserId(user.local_user_id);
    try {
      const data = await fetchJsonWithCsrf<AdminUserStatusResponse>(`/api/admin/users/${encodeURIComponent(user.local_user_id)}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: "disabled",
          reason: "admin release identity for re-registration",
          releaseIdentity: true,
        }),
      });
      setUsers((current) => current.map((entry) => (
        entry.local_user_id === user.local_user_id
          ? { ...entry, ...data.user }
          : entry
      )));
      setMessage(`${label} 已注销并释放邮箱，可重新注册。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "注销并释放邮箱失败。");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#050507] px-4 py-6 text-white md:px-8">
      <div className="relative mx-auto max-w-[1500px]">
        <header className="rounded-[2rem] border border-white/10 bg-[#101012]/95 p-6">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="flex items-center gap-4">
              <div className="grid size-13 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600">
                <BrandLogo className="size-8" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-fuchsia-300">奥皇 AI 管理后台</p>
                <h1 className="mt-1 text-3xl font-black">用户套餐管理</h1>
                <p className="mt-2 text-sm text-white/48">查看客户当前套餐，并手动开通套餐积分和会员权益。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/" className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/65 hover:text-white">
                <ArrowLeft className="size-4" />
                返回工作台
              </Link>
              <Link href="/admin/providers" className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/65 hover:text-white">
                模型配置
              </Link>
              <button type="button" onClick={load} disabled={loading} className="admin-secondary">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </button>
            </div>
          </div>
        </header>

        <section className="mt-4 flex items-start gap-3 rounded-[1.5rem] border border-fuchsia-400/20 bg-fuchsia-500/8 p-4 text-sm text-white/65">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
          <p>{message}</p>
        </section>

        <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#101012]/92">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <UsersRound className="size-5 text-fuchsia-300" />
              <h2 className="text-xl font-black">客户列表</h2>
            </div>
            <span className="text-sm text-white/45">{users.length} 个用户</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-white/[0.04] text-white/58">
                <tr>
                  <th className="px-5 py-4 font-semibold">用户</th>
                  <th className="px-5 py-4 font-semibold">状态</th>
                  <th className="px-5 py-4 font-semibold">当前套餐</th>
                  <th className="px-5 py-4 font-semibold">到期时间</th>
                  <th className="px-5 py-4 font-semibold">剩余权益</th>
                  <th className="px-5 py-4 font-semibold">手动开通</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {sortedUsers.map((user) => {
                  const active = user.membership.active;
                  const planId = selectedPlans[user.local_user_id] || active?.plan_id || defaultPlanId;
                  const cycle = selectedCycles[user.local_user_id] || active?.cycle || "monthly";
                  return (
                    <tr key={user.local_user_id} className="text-white/82">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white">{userName(user)}</div>
                        <div className="mt-1 text-xs text-white/42">{user.email || user.local_user_id}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                          {user.status === "active" ? "已启用" : user.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white">{planName(plans, active?.plan_id)}</div>
                        <div className="mt-1 text-xs text-white/42">{active ? cycleLabels[active.cycle] : "无当前套餐"}</div>
                      </td>
                      <td className="px-5 py-4 text-white/60">{formatDate(active?.ends_at)}</td>
                      <td className="px-5 py-4 text-white/60">{entitlementSummary(user.membership)}</td>
                      <td className="px-5 py-4">
                        <div className="flex min-w-[360px] flex-wrap gap-2">
                          <select
                            value={planId}
                            onChange={(event) => setSelectedPlans((current) => ({ ...current, [user.local_user_id]: event.target.value }))}
                            className="admin-input h-10 min-w-[128px]"
                          >
                            {plans.map((plan) => (
                              <option key={plan.id} value={plan.id}>{plan.name}</option>
                            ))}
                          </select>
                          <select
                            value={cycle}
                            onChange={(event) => setSelectedCycles((current) => ({ ...current, [user.local_user_id]: event.target.value as MembershipCycle }))}
                            className="admin-input h-10 min-w-[112px]"
                          >
                            {(Object.keys(cycleLabels) as MembershipCycle[]).map((item) => (
                              <option key={item} value={item}>{cycleLabels[item]}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => grantMembership(user)}
                            disabled={savingUserId === user.local_user_id || !planId}
                            className="admin-primary h-10"
                          >
                            {savingUserId === user.local_user_id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            开通
                          </button>
                          {user.role !== "admin" ? (
                            <button
                              type="button"
                              onClick={() => releaseUserEmail(user)}
                              disabled={savingUserId === user.local_user_id}
                              className="admin-secondary h-10 border-red-400/20 text-red-100 hover:border-red-300/40 hover:text-white"
                            >
                              {savingUserId === user.local_user_id ? <Loader2 className="size-4 animate-spin" /> : <UserX className="size-4" />}
                              注销释放邮箱
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!sortedUsers.length ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-white/45">
                      {loading ? "正在读取用户..." : "暂无用户。"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
