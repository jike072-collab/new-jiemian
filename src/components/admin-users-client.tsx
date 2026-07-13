"use client";

import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Search, Save, UserRound } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

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
  membership: MembershipStatusSnapshot;
};

type UsersResponse = {
  users: AdminUser[];
  membership_plans: MembershipPlan[];
  total: number;
};

type UserResponse = {
  user: AdminUser;
  quota_units: number | null;
  membership_plans: MembershipPlan[];
};

type QuotaResponse = {
  original_quota: number;
  target_quota: number;
};

type MembershipResponse = {
  membership_status: MembershipStatusSnapshot;
  credited_quota: number;
};

const cycles: Array<{ value: MembershipCycle; label: string }> = [
  { value: "monthly", label: "月套餐" },
  { value: "quarterly", label: "季套餐" },
  { value: "yearly", label: "年套餐" },
];

const entitlementLabels = {
  prompt_optimize: "提示词优化",
  image_generation: "图片生成",
  video_generation: "视频生成",
  image_edit: "图片编辑",
  image_upscale: "图片放大",
  video_upscale: "视频放大",
} as const;

function displayName(user: AdminUser) {
  return user.display_name || user.username || user.email || user.local_user_id;
}

function formatCredits(value: number | null) {
  if (value === null) return "暂不可用";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AdminUsersClient() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [selected, setSelected] = useState<UserResponse | null>(null);
  const [quotaDelta, setQuotaDelta] = useState("");
  const [quotaReason, setQuotaReason] = useState("");
  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState<MembershipCycle>("monthly");
  const [membershipReason, setMembershipReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"quota" | "membership" | null>(null);
  const [notice, setNotice] = useState("请从本站后台调整积分。直接修改 NewAPI 额度不会生成本站积分明细。");

  const loadUsers = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "20" });
      if (search.trim()) params.set("query", search.trim());
      const data = await fetchJson<UsersResponse>(`/api/admin/users?${params}`);
      setUsers(data.users);
      setPlans(data.membership_plans);
      setNotice(`已找到 ${data.total} 个用户。`);
    } catch (error) {
      setNotice(messageFrom(error, "用户读取失败。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers("");
  }, [loadUsers]);

  async function loadUser(userId: string) {
    setLoading(true);
    try {
      const data = await fetchJson<UserResponse>(`/api/admin/users/${encodeURIComponent(userId)}`);
      setSelected(data);
      setPlans(data.membership_plans);
      setPlanId(data.user.membership.active?.plan_id || data.membership_plans[0]?.id || "");
      setCycle(data.user.membership.active?.cycle || "monthly");
      setNotice(`正在管理 ${displayName(data.user)}。`);
    } catch (error) {
      setNotice(messageFrom(error, "用户详情读取失败。"));
    } finally {
      setLoading(false);
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    await loadUsers(query);
  }

  async function adjustQuota(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const delta = Number(quotaDelta);
    if (!Number.isInteger(delta) || delta === 0 || !quotaReason.trim()) {
      setNotice("请输入非零整数积分和操作原因。");
      return;
    }
    setSaving("quota");
    try {
      const data = await fetchJsonWithCsrf<QuotaResponse>(`/api/admin/users/${encodeURIComponent(selected.user.local_user_id)}/quota`, {
        method: "POST",
        body: JSON.stringify({
          quotaDelta: delta,
          reason: quotaReason.trim(),
          idempotencyKey: `admin-ui-quota-${selected.user.local_user_id}-${Date.now()}`,
        }),
      });
      setSelected((current) => current ? { ...current, quota_units: data.target_quota } : current);
      setQuotaDelta("");
      setQuotaReason("");
      setNotice(`积分调整成功：${formatCredits(data.original_quota)} -> ${formatCredits(data.target_quota)}。`);
    } catch (error) {
      setNotice(messageFrom(error, "积分调整失败。"));
    } finally {
      setSaving(null);
    }
  }

  async function grantMembership(event: FormEvent) {
    event.preventDefault();
    if (!selected || !planId || !membershipReason.trim()) {
      setNotice("请选择套餐并填写操作原因。");
      return;
    }
    setSaving("membership");
    try {
      const data = await fetchJsonWithCsrf<MembershipResponse>(`/api/admin/users/${encodeURIComponent(selected.user.local_user_id)}/membership`, {
        method: "POST",
        body: JSON.stringify({
          planId,
          cycle,
          reason: membershipReason.trim(),
          idempotencyKey: `admin-ui-membership-${selected.user.local_user_id}-${Date.now()}`,
        }),
      });
      setSelected((current) => current ? {
        ...current,
        quota_units: current.quota_units === null ? null : current.quota_units + data.credited_quota,
        user: { ...current.user, membership: data.membership_status },
      } : current);
      setMembershipReason("");
      setNotice(`会员开通成功，并到账 ${formatCredits(data.credited_quota)} 积分。`);
    } catch (error) {
      setNotice(messageFrom(error, "会员开通失败。"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      <header className="border-b border-white/10 bg-[#0d0d11]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div>
            <p className="text-xs text-fuchsia-300">奥皇 AI 管理后台</p>
            <h1 className="mt-1 text-2xl font-bold">用户与积分</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-white/70 hover:text-white">
              <ArrowLeft className="size-4" /> 返回工作台
            </Link>
            <a href="https://newapi.aohuang888.com/console/user" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-white/70 hover:text-white">
              <ExternalLink className="size-4" /> NewAPI 用户
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-8">
        <div role="status" className="border-l-2 border-fuchsia-400 bg-fuchsia-500/8 px-4 py-3 text-sm text-white/75">
          {notice}
        </div>

        <form onSubmit={submitSearch} className="mt-5 flex max-w-xl gap-2">
          <label className="sr-only" htmlFor="admin-user-search">搜索用户</label>
          <input id="admin-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="邮箱、用户名或昵称" className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#111116] px-3 text-sm outline-none focus:border-fuchsia-400/60" />
          <button type="submit" disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-lg bg-fuchsia-600 px-4 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} 搜索
          </button>
          <button type="button" title="刷新" onClick={() => void loadUsers(query)} disabled={loading} className="grid size-11 place-items-center rounded-lg border border-white/10 text-white/65 hover:text-white disabled:opacity-50">
            <RefreshCw className="size-4" />
          </button>
        </form>

        <section className="mt-5 overflow-x-auto border-y border-white/10">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-white/[0.03] text-white/50">
              <tr><th className="px-4 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">角色</th><th className="px-4 py-3 font-medium">当前会员</th><th className="px-4 py-3 font-medium">操作</th></tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((user) => (
                <tr key={user.local_user_id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><strong className="block font-semibold">{displayName(user)}</strong><span className="text-xs text-white/45">{user.email || user.local_user_id}</span></td>
                  <td className="px-4 py-3 text-white/70">{user.status === "active" ? "已启用" : user.status}</td>
                  <td className="px-4 py-3 text-white/70">{user.role === "admin" ? "管理员" : "普通用户"}</td>
                  <td className="px-4 py-3 text-white/70">{plans.find((plan) => plan.id === user.membership.active?.plan_id)?.name || "未开通"}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => void loadUser(user.local_user_id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm hover:border-fuchsia-400/50"><UserRound className="size-4" /> 管理</button></td>
                </tr>
              ))}
              {!users.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-white/45">{loading ? "正在读取..." : "没有匹配用户"}</td></tr> : null}
            </tbody>
          </table>
        </section>

        {selected ? (
          <section className="mt-6 border-t border-white/10 pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-sm text-white/45">当前管理用户</p><h2 className="mt-1 text-xl font-bold">{displayName(selected.user)}</h2></div>
              <div className="text-right"><p className="text-sm text-white/45">本站剩余积分</p><strong className="text-3xl text-fuchsia-300">{formatCredits(selected.quota_units)}</strong></div>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <form onSubmit={adjustQuota} className="border-t border-white/10 pt-4">
                <h3 className="font-semibold">手动调整积分</h3>
                <p className="mt-1 text-xs text-white/45">正数增加，负数扣减。成功后同步 NewAPI 并写入本站明细。</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-white/65">积分变动<input value={quotaDelta} onChange={(event) => setQuotaDelta(event.target.value)} inputMode="numeric" placeholder="例如 1000 或 -100" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#111116] px-3 text-white outline-none focus:border-fuchsia-400/60" /></label>
                  <label className="text-sm text-white/65">操作原因<input value={quotaReason} onChange={(event) => setQuotaReason(event.target.value)} placeholder="必填" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#111116] px-3 text-white outline-none focus:border-fuchsia-400/60" /></label>
                </div>
                <button type="submit" disabled={saving !== null} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-fuchsia-600 px-4 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50">{saving === "quota" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 保存积分调整</button>
              </form>

              <form onSubmit={grantMembership} className="border-t border-white/10 pt-4">
                <h3 className="font-semibold">手动开通会员</h3>
                <p className="mt-1 text-xs text-white/45">一次完成套餐积分、会员期限和全部赠送次数。</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="text-sm text-white/65">套餐<select value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#111116] px-3 text-white outline-none">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
                  <label className="text-sm text-white/65">周期<select value={cycle} onChange={(event) => setCycle(event.target.value as MembershipCycle)} className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#111116] px-3 text-white outline-none">{cycles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label className="text-sm text-white/65">操作原因<input value={membershipReason} onChange={(event) => setMembershipReason(event.target.value)} placeholder="必填" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#111116] px-3 text-white outline-none focus:border-fuchsia-400/60" /></label>
                </div>
                <button type="submit" disabled={saving !== null || !planId} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-fuchsia-600 px-4 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50">{saving === "membership" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 开通会员</button>
              </form>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <h3 className="font-semibold">会员赠送次数</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                {Object.entries(entitlementLabels).map(([kind, label]) => <div key={kind} className="border-l border-white/10 pl-3"><span className="block text-xs text-white/45">{label}</span><strong className="mt-1 block">{selected.user.membership.entitlements[kind as keyof typeof entitlementLabels]?.remaining || 0}</strong></div>)}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
