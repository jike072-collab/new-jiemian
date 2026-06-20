"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type FormEvent, type PointerEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import { motionTokens } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";

const AuthShaderBackground = dynamic(() => import("@/components/auth-shader-background"), {
  ssr: false,
});

type AuthMode = "login" | "register";

type SessionProbe = {
  ok: true;
  user: unknown;
};

type CustomerLoginProps = {
  initialMode?: AuthMode;
};

const showcaseCards = [
  {
    title: "商品主图",
    subtitle: "清晰主体",
    className: "auth-showcase-card--left",
  },
  {
    title: "商品场景图",
    subtitle: "电商氛围",
    className: "auth-showcase-card--main",
  },
  {
    title: "视频封面",
    subtitle: "短视频素材",
    className: "auth-showcase-card--right",
  },
];

function friendlyAuthError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "请求失败，请稍后重试";
  }
  if (error.code === "AUTH_INVALID_CREDENTIALS") return "账号或密码不正确";
  if (error.code === "AUTH_DUPLICATE_ACCOUNT") return "该账号已存在";
  if (error.code === "AUTH_RATE_LIMITED") return "操作太频繁，请稍后再试";
  if (error.code === "AUTH_VALIDATION_ERROR") return "请检查账号和密码格式";
  if (error.code === "AUTH_SERVICE_UNAVAILABLE") return "注册暂时不可用，请稍后重试";
  return error.message || "请求失败，请稍后重试";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function CustomerLogin({ initialMode = "login" }: CustomerLoginProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const disabled = loading || success;
  const activeMode = initialMode === "register" ? "register" : mode;
  const isLogin = activeMode === "login";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchJson<SessionProbe>("/api/auth/session");
        if (!cancelled) router.replace("/");
      } catch {
        // Stay on auth pages when no active session exists.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function validateForm() {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password) {
      return "请填写账号和密码";
    }
    if (!isLogin && !isValidEmail(trimmedIdentifier)) {
      return "请填写有效邮箱";
    }
    if (!isLogin && password !== confirmPassword) {
      return "两次输入的密码不一致";
    }
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const validationMessage = validateForm();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      if (isLogin) {
        await fetchJsonWithCsrf("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier: identifier.trim(),
            password,
            redirectTo: "/",
          }),
        });
      } else {
        await fetchJsonWithCsrf("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: identifier.trim(),
            password,
            redirectTo: "/",
          }),
        });
      }
      setSuccess(true);
      window.setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, motionTokens.duration.slow);
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  function updateSpotlight(event: PointerEvent<HTMLFormElement>) {
    if (event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }

  return (
    <main className="auth-page">
      <AuthShaderBackground />
      <div className="auth-page__shade" aria-hidden="true" />
      <div className="auth-page__noise" aria-hidden="true" />

      <section className="auth-layout" aria-label={isLogin ? "登录" : "注册"}>
        <div className="auth-brand">
          <div className="auth-brand__mark">
            <BrandLogo className="auth-brand__logo" />
            <span>奥皇 AI</span>
          </div>
          <div className="auth-brand__copy">
            <h1>让商品图片与视频创作更简单</h1>
            <p>图片生成 · 视频生成 · 高清处理</p>
          </div>
          <div className="auth-showcase" aria-hidden="true">
            {showcaseCards.map((card) => (
              <div key={card.title} className={cn("auth-showcase-card", card.className)}>
                <div className="auth-showcase-card__image" />
                <div>
                  <strong>{card.title}</strong>
                  <span>{card.subtitle}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-form-shell">
          <div className="auth-mobile-logo">
            <BrandLogo className="auth-mobile-logo__mark" />
            <span>奥皇 AI</span>
          </div>

          <form
            className="auth-card"
            onPointerMove={updateSpotlight}
            onPointerLeave={(event) => {
              event.currentTarget.style.removeProperty("--spotlight-x");
              event.currentTarget.style.removeProperty("--spotlight-y");
            }}
            onSubmit={(event) => void submit(event)}
            aria-busy={loading}
          >
            <div className="auth-card__spotlight" aria-hidden="true" />
            <div className="auth-card__head">
              <BrandLogo className="auth-card__logo" />
              <div>
                <h2>{isLogin ? "欢迎回来" : "创建账号"}</h2>
                <p>{isLogin ? "登录后继续你的创作" : "开始你的创作"}</p>
              </div>
            </div>

            <label className="auth-field">
              <span>邮箱或账号</span>
              <input
                type={isLogin ? "text" : "email"}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete={isLogin ? "username" : "email"}
                disabled={disabled}
                aria-invalid={Boolean(message && !identifier.trim())}
              />
            </label>

            <label className="auth-field">
              <span>密码</span>
              <span className="auth-password">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  disabled={disabled}
                  aria-invalid={Boolean(message && !password)}
                />
                <button
                  type="button"
                  className="auth-password__toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={disabled}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>

            {!isLogin ? (
              <label className="auth-field">
                <span>确认密码</span>
                <span className="auth-password">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={disabled}
                    aria-invalid={Boolean(message && password !== confirmPassword)}
                  />
                  <button
                    type="button"
                    className="auth-password__toggle"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    disabled={disabled}
                    aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
            ) : null}

            {message ? (
              <p className="auth-error" role="alert">
                {message}
              </p>
            ) : null}

            <button type="submit" className="auth-submit" disabled={disabled}>
              <span className="auth-submit__shine" aria-hidden="true" />
              {loading ? <Loader2 className="size-4 animate-spin" /> : success ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
              {loading ? (isLogin ? "正在登录" : "正在注册") : success ? "已完成" : isLogin ? "登录" : "注册"}
            </button>

            <p className="auth-switch">
              {isLogin ? "还没有账号？" : "已有账号？"}
              <Link
                href={isLogin ? "/register" : "/login"}
                onClick={() => {
                  setMode(isLogin ? "register" : "login");
                  setMessage("");
                  setSuccess(false);
                }}
              >
                {isLogin ? "立即注册" : "返回登录"}
              </Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
