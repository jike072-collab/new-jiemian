"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, type PointerEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, ImageIcon, Loader2, LockKeyhole, Mail, Play, Sparkles, Video } from "lucide-react";

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

function AuthBrandLockup({ className = "" }: { className?: string }) {
  return (
    <div className={cn("auth-brand-lockup", className)}>
      <BrandLogo className="auth-brand-lockup__icon" />
      <span className="auth-brand-lockup__text">
        <strong>奥皇 AI</strong>
        <small>AI VISUAL STUDIO</small>
      </span>
    </div>
  );
}

const showcaseCards = [
  {
    title: "商品主图",
    subtitle: "一键生成精美主图",
    image: "/auth-showcase/product-main.png",
    className: "auth-showcase-card--left",
  },
  {
    title: "商品场景图",
    subtitle: "生成高质量场景图",
    image: "/auth-showcase/product-scene.png",
    className: "auth-showcase-card--main",
  },
  {
    title: "视频生成",
    subtitle: "快速生成商品视频",
    image: "/auth-showcase/video-cover.png",
    className: "auth-showcase-card--right",
    kind: "video",
  },
];

const authFeatures = [
  { label: "图片生成", icon: ImageIcon },
  { label: "视频生成", icon: Video },
  { label: "高清处理", icon: Sparkles },
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
  const isLogin = mode === "login";

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

  useEffect(() => {
    function handlePopState() {
      setMode(window.location.pathname === "/register" ? "register" : "login");
      setMessage("");
      setSuccess(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function switchMode(nextMode: AuthMode) {
    if (disabled) return;
    setMode(nextMode);
    setMessage("");
    setSuccess(false);

    const nextPath = nextMode === "login" ? "/login" : "/register";
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

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
          <AuthBrandLockup />
          <div className="auth-brand__copy">
            <h1>
              <span>让商品图片与视频</span>
              <span>
                创作<b>更简单</b>
              </span>
            </h1>
            <div className="auth-feature-list" aria-label="核心能力">
              {authFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <span key={feature.label} className="auth-feature-list__item">
                    {index > 0 ? <i aria-hidden="true" /> : null}
                    <Icon className="size-5" aria-hidden="true" />
                    {feature.label}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="auth-showcase" aria-hidden="true">
            {showcaseCards.map((card) => (
              <div key={card.title} className={cn("auth-showcase-card", card.className)}>
                <Image
                  src={card.image}
                  alt=""
                  fill
                  sizes="280px"
                  priority
                  className="auth-showcase-card__image"
                />
                {card.kind === "video" ? (
                  <span className="auth-showcase-card__play" aria-hidden="true">
                    <Play className="size-5" fill="currentColor" strokeWidth={2.2} />
                  </span>
                ) : null}
                <div className="auth-showcase-card__footer">
                  <strong>{card.title}</strong>
                  <span>{card.subtitle}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-form-shell">
          <AuthBrandLockup className="auth-mobile-logo" />

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
            <div key={mode} className="auth-form-content">
              <div className="auth-card__head">
                <h2>{isLogin ? "欢迎回来" : "创建账号"}</h2>
                <p>{isLogin ? "登录后继续你的创作之旅" : "开始你的创作之旅"}</p>
                <span aria-hidden="true" />
              </div>

              <label className="auth-field">
                <span>邮箱或账号</span>
                <span className="auth-input">
                  <Mail className="size-5" aria-hidden="true" />
                  <input
                    type={isLogin ? "text" : "email"}
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    autoComplete={isLogin ? "username" : "email"}
                    disabled={disabled}
                    aria-invalid={Boolean(message && !identifier.trim())}
                    placeholder={isLogin ? "请输入邮箱或账号" : "请输入邮箱"}
                  />
                </span>
              </label>

              <label className="auth-field">
                <span>密码</span>
                <span className="auth-input auth-password">
                  <LockKeyhole className="size-5" aria-hidden="true" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    disabled={disabled}
                    aria-invalid={Boolean(message && !password)}
                    placeholder="请输入密码"
                  />
                  <button
                    type="button"
                    className="auth-password__toggle"
                    onMouseDown={(event) => event.preventDefault()}
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
                  <span className="auth-input auth-password">
                    <LockKeyhole className="size-5" aria-hidden="true" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      disabled={disabled}
                      aria-invalid={Boolean(message && password !== confirmPassword)}
                      placeholder="请再次输入密码"
                    />
                    <button
                      type="button"
                      className="auth-password__toggle"
                      onMouseDown={(event) => event.preventDefault()}
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
                {loading ? (isLogin ? "正在登录" : "正在注册") : success ? "已完成" : isLogin ? "登录" : "注册"}
                {loading ? <Loader2 className="size-4 animate-spin" /> : success ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
              </button>

              <Link href="/?preview=1" className="auth-guest-link">
                免登录查看界面
              </Link>

              <p className="auth-switch">
                {isLogin ? "还没有账号？" : "已有账号？"}
                <Link
                  href={isLogin ? "/register" : "/login"}
                  onClick={(event) => {
                    event.preventDefault();
                    switchMode(isLogin ? "register" : "login");
                  }}
                >
                  {isLogin ? "立即注册" : "返回登录"}
                </Link>
              </p>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
