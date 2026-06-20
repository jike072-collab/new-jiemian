"use client";

import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { ApiError, fetchJsonWithCsrf } from "@/lib/client/api";

type AuthMode = "login" | "register";

export function CustomerAuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!account.trim()) {
      setError("请输入邮箱或账号。");
      return;
    }
    if (password.length < 10) {
      setError("密码至少需要 10 位，并包含大小写字母和数字。");
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await fetchJsonWithCsrf("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: account.trim(),
            password,
            redirectTo: "/",
          }),
        });
      } else {
        await fetchJsonWithCsrf("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier: account.trim(),
            password,
            redirectTo: "/",
          }),
        });
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof ApiError || error instanceof Error
        ? error.message
        : isRegister ? "注册失败，请稍后重试。" : "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="auth-brand__mark">
            <BrandLogo className="size-8" />
          </div>
          <span>奥皇 AI</span>
        </div>

        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="auth-form__head">
            <h1 id="auth-title">{isRegister ? "注册账号" : "登录账号"}</h1>
          </div>

          <label className="auth-field">
            <span>邮箱或账号</span>
            <input
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              autoComplete="username"
              placeholder="name@example.com"
            />
          </label>

          <label className="auth-field">
            <span>密码</span>
            <div className="auth-password">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={passwordVisible ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder="输入密码"
              />
              <button
                type="button"
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                onClick={() => setPasswordVisible((value) => !value)}
              >
                {passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          {isRegister ? (
            <label className="auth-field">
              <span>确认密码</span>
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type={passwordVisible ? "text" : "password"}
                autoComplete="new-password"
                placeholder="再次输入密码"
              />
            </label>
          ) : null}

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isRegister ? "注册" : "登录"}
          </button>

          <p className="auth-switch">
            {isRegister ? (
              <Link href="/login">返回登录</Link>
            ) : (
              <Link href="/register">前往注册</Link>
            )}
          </p>
        </form>
      </section>
    </main>
  );
}
