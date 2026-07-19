"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, type FormEvent, type PointerEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, ImageIcon, Loader2, LockKeyhole, Mail, Play, Sparkles, UserRound, Video } from "lucide-react";

import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import { motionTokens } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register" | "reset";
type LoginMethod = "password" | "verification_code";

type VerificationFeedback = {
  tone: "pending" | "success" | "error";
  text: string;
};

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
      <Image
        src="/brand/logo-mark.svg"
        alt=""
        width={58}
        height={58}
        priority
        unoptimized
        className="auth-brand-lockup__icon"
      />
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
    image: "/auth-showcase/product-main.webp",
    className: "auth-showcase-card--left",
  },
  {
    title: "商品场景图",
    subtitle: "生成高质量场景图",
    image: "/auth-showcase/product-scene.webp",
    className: "auth-showcase-card--main",
  },
  {
    title: "视频生成",
    subtitle: "快速生成商品视频",
    image: "/auth-showcase/video-cover.webp",
    className: "auth-showcase-card--right",
    kind: "video",
  },
];

const authFeatures = [
  { label: "图片生成", icon: ImageIcon },
  { label: "视频生成", icon: Video },
  { label: "高清处理", icon: Sparkles },
];

const AuthBrandPanel = memo(function AuthBrandPanel() {
  return (
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
        {showcaseCards.map((card, index) => (
          <div key={card.title} className={cn("auth-showcase-card", card.className)}>
            <Image
              src={card.image}
              alt=""
              fill
              sizes="280px"
              loading={index < 2 ? "eager" : "lazy"}
              decoding="async"
              unoptimized
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
  );
});

function friendlyAuthError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "请求失败，请稍后重试";
  }
  if (error.code === "AUTH_ACCOUNT_NOT_FOUND") return "该邮箱未注册";
  if (error.code === "AUTH_INVALID_CREDENTIALS") return "账号或密码不正确";
  if (error.code === "AUTH_DUPLICATE_ACCOUNT") return "邮箱或用户名已注册";
  if (error.code === "AUTH_VERIFICATION_CODE_INVALID") return "验证码不正确或已过期";
  if (error.code === "AUTH_VERIFICATION_SEND_UNAVAILABLE") return "验证码发送服务暂不可用";
  if (error.code === "AUTH_RATE_LIMITED") {
    return error.retryAfterSeconds
      ? `操作太频繁，请 ${error.retryAfterSeconds} 秒后再试`
      : "操作太频繁，请稍后再试";
  }
  if (error.code === "AUTH_CSRF_REQUIRED") return "页面已过期，请刷新后重试";
  if (error.code === "AUTH_INTERNAL_ACCESS_REQUIRED") return "此内部域名暂未授权此账号登录";
  if (error.code === "AUTH_VALIDATION_ERROR") return "请检查账号和密码格式";
  if (error.code === "AUTH_SERVICE_UNAVAILABLE") return "注册暂时不可用，请稍后重试";
  if (error.status >= 500) return "验证码发送失败，请稍后重试";
  return error.message || "请求失败，请稍后重试";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeUsernameInput(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 6);
}

function isValidUsername(value: string) {
  return /^[a-zA-Z0-9_.-]{3,6}$/.test(value);
}

function passwordRules(password: string) {
  return [
    { key: "lower", label: "包含小写字母", passed: /[a-z]/.test(password) },
    { key: "upper", label: "包含大写字母", passed: /[A-Z]/.test(password) },
    { key: "digit", label: "包含数字", passed: /[0-9]/.test(password) },
  ];
}

export function CustomerLogin({ initialMode = "login" }: CustomerLoginProps) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [rememberMe, setRememberMe] = useState(true);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [verificationFeedback, setVerificationFeedback] = useState<VerificationFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const disabled = !hydrated || loading || success || sendingCode;
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isReset = mode === "reset";
  const isCodeLogin = isLogin && loginMethod === "verification_code";
  const needsVerificationCode = isRegister || isReset || isCodeLogin;
  const needsPassword = !isCodeLogin;
  const needsPasswordPolicy = isRegister || isReset;
  const rules = passwordRules(password);
  const passwordMeetsRules = rules.every((rule) => rule.passed);
  const confirmMismatch = needsPasswordPolicy && confirmPassword.length > 0 && password !== confirmPassword;
  const positiveMessage = message === "密码已重置，请使用新密码登录";

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

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
      const nextMode = window.location.pathname === "/register" ? "register" : "login";
      setMode(nextMode);
      setLoginMethod("password");
      setMessage("");
      setVerificationFeedback(null);
      setSuccess(false);
      setVerificationCode("");
      if (nextMode !== "register") setUsername("");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function switchMode(nextMode: AuthMode) {
    if (disabled) return;
    setMode(nextMode);
    setMessage("");
    setVerificationFeedback(null);
    setSuccess(false);
    setVerificationCode("");
    setConfirmPassword("");
    if (nextMode !== "register") setUsername("");
    if (nextMode !== "login") setLoginMethod("password");

    const nextPath = nextMode === "register" ? "/register" : "/login";
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  function validateForm() {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      return isCodeLogin ? "请填写邮箱和验证码" : isLogin ? "请填写账号和密码" : "请填写邮箱、验证码和密码";
    }
    if (needsPassword && !password) {
      return isLogin ? "请填写账号和密码" : "请填写邮箱、验证码和密码";
    }
    if (needsVerificationCode && !isValidEmail(trimmedIdentifier)) {
      return "请填写有效邮箱";
    }
    if (isRegister && !username.trim()) {
      return "请填写用户名";
    }
    if (isRegister && !isValidUsername(username.trim())) {
      return "用户名需为 3-6 位英文、数字、下划线、点或短横线";
    }
    if (needsVerificationCode && !/^\d{6}$/.test(verificationCode.trim())) {
      return "请填写 6 位验证码";
    }
    if (needsPasswordPolicy && !passwordMeetsRules) {
      return "密码需要包含大小写字母和数字";
    }
    if (needsPasswordPolicy && password !== confirmPassword) {
      return "两次输入的密码不一致";
    }
    return "";
  }

  async function sendVerificationCode() {
    if (disabled || codeCooldown > 0) return;
    const trimmedIdentifier = identifier.trim();
    if (!isValidEmail(trimmedIdentifier)) {
      setVerificationFeedback({ tone: "error", text: "请先填写有效邮箱" });
      return;
    }

    setSendingCode(true);
    setMessage("");
    setVerificationFeedback({ tone: "pending", text: "正在发送验证码..." });
    try {
      await fetchJsonWithCsrf("/api/auth/verification-code", {
        method: "POST",
        body: JSON.stringify({
          identifier: trimmedIdentifier,
          purpose: isReset ? "password_reset" : isCodeLogin ? "login" : "register",
        }),
      });
      setCodeCooldown(60);
      setVerificationFeedback({ tone: "success", text: "验证码已发送，请检查收件箱和垃圾邮件" });
    } catch (error) {
      setVerificationFeedback({ tone: "error", text: friendlyAuthError(error) });
    } finally {
      setSendingCode(false);
    }
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
            password: isCodeLogin ? undefined : password,
            verificationCode: isCodeLogin ? verificationCode.trim() : undefined,
            loginMethod: isCodeLogin ? "verification_code" : "password",
            rememberMe,
            redirectTo: "/",
          }),
        });
      } else if (isRegister) {
        await fetchJsonWithCsrf("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            identifier: identifier.trim(),
            username: username.trim(),
            displayName: username.trim(),
            verificationCode: verificationCode.trim(),
            password,
            redirectTo: "/",
          }),
        });
      } else {
        await fetchJsonWithCsrf("/api/auth/password-reset", {
          method: "POST",
          body: JSON.stringify({
            identifier: identifier.trim(),
            verificationCode: verificationCode.trim(),
            password,
          }),
        });
        setSuccess(true);
        setMessage("密码已重置，请使用新密码登录");
        window.setTimeout(() => {
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          setVerificationCode("");
          setSuccess(false);
        }, motionTokens.duration.slow);
        return;
      }
      setSuccess(true);
      window.setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, motionTokens.duration.slow);
    } catch (error) {
      const text = friendlyAuthError(error);
      setMessage(isCodeLogin && text === "账号或密码不正确" ? "邮箱或验证码不正确" : text);
    } finally {
      setLoading(false);
    }
  }

  function updateSpotlight(event: PointerEvent<HTMLFormElement>) {
    if (event.pointerType !== "mouse") return;
    if (event.currentTarget.matches(":focus-within")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }

  return (
    <main className="auth-page">
      <div className="auth-page__shade" aria-hidden="true" />
      <div className="auth-page__noise" aria-hidden="true" />

      <section className="auth-layout" aria-label={isLogin ? "登录" : isReset ? "重置密码" : "注册"}>
        <AuthBrandPanel />

        <div className="auth-form-shell">
          <AuthBrandLockup className="auth-mobile-logo" />

          <form
            className="auth-card"
            onFocusCapture={(event) => {
              event.currentTarget.closest(".auth-page")?.setAttribute("data-input-active", "true");
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                event.currentTarget.closest(".auth-page")?.removeAttribute("data-input-active");
              }
            }}
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
                <h2>{isLogin ? "欢迎回来" : isReset ? "重置密码" : "创建账号"}</h2>
                <p>{isLogin ? "登录后继续你的创作之旅" : isReset ? "验证邮箱后设置新密码" : "开始你的创作之旅"}</p>
                <span aria-hidden="true" />
              </div>

              <label className="auth-field">
                <span>{isCodeLogin ? "邮箱" : isLogin ? "邮箱或账号" : "邮箱"}</span>
                <span className="auth-input">
                  <Mail className="size-5" aria-hidden="true" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(event) => {
                      setIdentifier(event.target.value);
                      setVerificationFeedback(null);
                    }}
                    autoComplete={isLogin && !isCodeLogin ? "username" : "email"}
                    disabled={disabled}
                    aria-invalid={Boolean(message && !identifier.trim())}
                    placeholder={isCodeLogin ? "请输入邮箱" : isLogin ? "请输入邮箱或账号" : "请输入邮箱"}
                  />
                </span>
              </label>

              {isRegister ? (
                <label className="auth-field">
                  <span>用户名</span>
                  <span className="auth-input">
                    <UserRound className="size-5" aria-hidden="true" />
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(normalizeUsernameInput(event.target.value))}
                      autoComplete="username"
                      maxLength={6}
                      disabled={disabled}
                      aria-invalid={Boolean(username.trim() && !isValidUsername(username.trim()))}
                      placeholder="3-6 位英文、数字、._-"
                    />
                  </span>
                </label>
              ) : null}

              {needsVerificationCode ? (
                <div className="auth-field">
                  <span className="auth-field__header" id="auth-code-label">
                    <span>验证码</span>
                    {isCodeLogin ? (
                      <button
                        type="button"
                        className="auth-inline-switch"
                        onClick={() => {
                          setLoginMethod("password");
                          setMessage("");
                          setVerificationFeedback(null);
                          setVerificationCode("");
                        }}
                        disabled={disabled}
                      >
                        密码登录
                      </button>
                    ) : null}
                  </span>
                  <span className="auth-code-row">
                    <span className="auth-input auth-code-input">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={verificationCode}
                        onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        autoComplete="one-time-code"
                        aria-labelledby="auth-code-label"
                        disabled={disabled}
                        aria-invalid={Boolean(message && !/^\d{6}$/.test(verificationCode.trim()))}
                        placeholder="6 位验证码"
                      />
                    </span>
                    <button
                      type="button"
                      className="auth-code-send"
                      onClick={() => void sendVerificationCode()}
                      disabled={disabled || codeCooldown > 0}
                    >
                      {sendingCode ? "发送中" : codeCooldown > 0 ? `${codeCooldown}s` : "获取验证码"}
                    </button>
                  </span>
                  {verificationFeedback ? (
                    <p
                      className="auth-code-feedback"
                      data-tone={verificationFeedback.tone}
                      role={verificationFeedback.tone === "error" ? "alert" : "status"}
                      aria-live="polite"
                    >
                      {verificationFeedback.text}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {needsPassword ? (
                <div className="auth-field">
                  <span className="auth-field__header" id="auth-password-label">
                    <span>{isReset ? "新密码" : "密码"}</span>
                    {isLogin ? (
                      <button
                        type="button"
                        className="auth-inline-switch"
                        onClick={() => {
                          setLoginMethod("verification_code");
                          setMessage("");
                          setVerificationFeedback(null);
                          setVerificationCode("");
                        }}
                        disabled={disabled}
                      >
                        验证码登录
                      </button>
                    ) : null}
                  </span>
                  <span className="auth-input auth-password">
                    <LockKeyhole className="size-5" aria-hidden="true" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      disabled={disabled}
                      aria-labelledby="auth-password-label"
                      aria-invalid={Boolean((message && !password) || (needsPasswordPolicy && password.length > 0 && !passwordMeetsRules))}
                      placeholder={isReset ? "请输入新密码" : "请输入密码"}
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
                </div>
              ) : null}

              {isLogin ? (
                <div className="auth-login-options">
                  <label className="auth-checkbox">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      disabled={disabled}
                    />
                    <span>自动登录</span>
                  </label>
                  <button type="button" onClick={() => switchMode("reset")} disabled={disabled}>
                    忘记密码
                  </button>
                </div>
              ) : null}

              {needsPasswordPolicy ? (
                <ul className="auth-password-rules" aria-label="密码要求">
                  {rules.map((rule) => (
                    <li key={rule.key} data-passed={rule.passed}>
                      <Check className="size-3.5" aria-hidden="true" />
                      {rule.label}
                    </li>
                  ))}
                </ul>
              ) : null}

              {!isLogin ? (
                <label className="auth-field">
                  <span>{isReset ? "确认新密码" : "确认密码"}</span>
                  <span className="auth-input auth-password">
                    <LockKeyhole className="size-5" aria-hidden="true" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      disabled={disabled}
                      aria-invalid={Boolean(confirmMismatch || (message && password !== confirmPassword))}
                      placeholder={isReset ? "请再次输入新密码" : "请再次输入密码"}
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

              {confirmMismatch ? (
                <p className="auth-field-help" role="status">
                  两次输入的密码不一致
                </p>
              ) : null}

              {message ? (
                <p className={cn("auth-error", positiveMessage && "auth-error--success")} role={positiveMessage ? "status" : "alert"}>
                  {message}
                </p>
              ) : null}

              <button type="submit" className="auth-submit" disabled={disabled}>
                <span className="auth-submit__shine" aria-hidden="true" />
                {loading
                  ? isLogin ? "正在登录" : isReset ? "正在重置" : "正在注册"
                  : success ? "已完成" : isLogin ? "登录" : isReset ? "重置密码" : "注册"}
                {loading ? (
                  <Loader2 className="auth-submit__icon size-4 animate-spin" />
                ) : success ? (
                  <Check className="auth-submit__icon size-4" />
                ) : (
                  <ArrowRight className="auth-submit__icon size-4" />
                )}
              </button>

              <p className="auth-switch">
                {isLogin ? "还没有账号？" : isReset ? "想起密码？" : "已有账号？"}
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
